import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readSb3,blankProject,buildPlan,compareProjects} from '../server/project.mjs';

test('sample plan creates procedures before calls and types nested literals',async t=>{
  const file=(await fs.readdir('.')).find(n=>n.startsWith('Fast ')&&n.endsWith('.sb3'));
  if(!file){t.skip('外部の長方形描画sb3をローカルに配置した場合のみ実行します。');return;}
  const buffer=await fs.readFile(file),{project}=await readSb3(buffer),plan=buildPlan(project);
  const def=plan.actions.findIndex(a=>a.type==='procedure.create'),call=plan.actions.findIndex(a=>a.opcode==='procedures_call');
  assert.ok(def>=0&&def<call);assert.equal(plan.actions.filter(a=>a.type==='variable.create').length,5);
  assert.ok(plan.actions.some(a=>a.type==='block.input'&&a.value==='0.0019531846047'));
  const {project:blank,zip}=await readSb3(await blankProject(buffer));
  assert.ok(blank.targets.every(t=>Object.keys(t.blocks).length===0&&Object.keys(t.variables).length===0));
  assert.deepEqual(blank.targets[1].costumes,project.targets[1].costumes);
  for(const c of blank.targets[1].costumes)assert.ok(zip.file(c.md5ext));
});
test('semantic comparison ignores ids but detects wrong constants and missing branches',()=>{
  const p=id=>({targets:[{name:'s',isStage:false,blocks:{[id]:{opcode:'control_if',topLevel:true,inputs:{CONDITION:[2,id+'1'],SUBSTACK:[2,id+'2']},fields:{},next:null},[id+'1']:{opcode:'operator_equals',inputs:{OPERAND1:[1,[10,'abc']],OPERAND2:[1,[10,'def']]},fields:{},next:null},[id+'2']:{opcode:'motion_movesteps',inputs:{STEPS:[1,[4,10]]},fields:{},next:null}},variables:{},lists:{},costumes:[],sounds:[]}]});
  const a=p('a'),b=p('b');assert.equal(compareProjects(a,b).ok,true);
  b.targets[0].blocks.b2.inputs.STEPS[1][1]=11;assert.equal(compareProjects(a,b).ok,false);
  const c=p('c');delete c.targets[0].blocks.c.inputs.SUBSTACK;assert.equal(compareProjects(a,c).ok,false);
});
test('corrupt sb3 fails explicitly',async()=>{await assert.rejects(()=>readSb3(Buffer.from('not a zip')));});
test('comparison distinguishes local and global variables with identical names',()=>{
  const p={targets:[{name:'Stage',isStage:true,variables:{global:['x',1]},blocks:{}},{name:'Sprite',variables:{local:['x',1]},blocks:{b:{opcode:'looks_say',topLevel:true,fields:{},inputs:{MESSAGE:[3,[12,'x','global'],[10,'']]}}}}]};
  const q=structuredClone(p);q.targets[1].blocks.b.inputs.MESSAGE[1][2]='local';
  assert.equal(compareProjects(p,q).ok,false);
});
test('cyclic or duplicate input graph is rejected',()=>{
  const p={targets:[{name:'s',blocks:{a:{opcode:'control_forever',topLevel:true,inputs:{SUBSTACK:[2,'a']}}}}]};
  assert.throws(()=>buildPlan(p),/循環/);
});
test('standalone variable reporter is included in reconstruction',()=>{
  const p={targets:[{name:'Stage',isStage:true,variables:{v:['x',2]},blocks:{reporter:[12,'x','v',120,240]}}]};
  const a=buildPlan(p).actions.find(a=>a.type==='block.add');
  assert.equal(a.opcode,'data_variable');assert.deepEqual(a.place,{x:120,y:240});
});
test('asset animation starts empty and restores asset order and selection',async()=>{
  const buffer=await fs.readFile('PEN動作確認.sb3'),{project}=await readSb3(buffer);
  project.targets[1].costumes.push({...project.targets[1].costumes[0],name:'2枚目'});project.targets[1].currentCostume=1;
  const actions=buildPlan(project,{assets:true}).actions;
  assert.equal(actions.filter(a=>a.type==='costume.add').length,3);
  assert.ok(actions.some(a=>a.type==='costume.select'&&a.index===1));
  assert.ok(actions.findIndex(a=>a.type==='sound.add')<actions.findIndex(a=>a.type==='block.add'));
  const {project:blank}=await readSb3(await blankProject(buffer,{assets:true}));
  assert.ok(blank.targets.every(t=>t.costumes.length===1&&t.sounds.length===0&&t.currentCostume===0));
});
test('broadcast names are assigned on retained message blocks, never temporary blocks',()=>{
  const p={targets:[{name:'Stage',isStage:true,broadcasts:{message:'開始'},blocks:{receiver:{opcode:'event_whenbroadcastreceived',topLevel:true,inputs:{},fields:{BROADCAST_OPTION:['開始','message']}}}}]};
  const actions=buildPlan(p).actions;
  assert.ok(!actions.some(a=>a.type==='broadcast.create'||a.type==='block.delete'));
  assert.equal(actions.find(a=>a.type==='block.field').block,'receiver');
});

test('compact broadcast literals use the native dropdown for active and fallback shadows',()=>{
  const p={targets:[{name:'Stage',isStage:true,broadcasts:{m:'開始'},blocks:{
    send:{opcode:'event_broadcast',topLevel:true,inputs:{BROADCAST_INPUT:[1,[11,'開始','m']]},fields:{}},
    wait:{opcode:'event_broadcastandwait',topLevel:true,inputs:{BROADCAST_INPUT:[3,'join',[11,'開始','m']]},fields:{}},
    join:{opcode:'operator_join',inputs:{STRING1:[1,[10,'開']],STRING2:[1,[10,'始']]},fields:{}}
  }}]};
  const actions=buildPlan(p).actions;
  assert.equal(actions.filter(a=>a.type==='block.field'&&a.field==='BROADCAST_OPTION').length,2);
  assert.ok(!actions.some(a=>a.type==='block.input'&&a.input==='BROADCAST_INPUT'));
  assert.ok(actions.findIndex(a=>a.type==='block.field'&&a.block==='wait')<actions.findIndex(a=>a.sourceId==='join'));
  assert.ok(actions.filter(a=>a.field==='BROADCAST_OPTION').every(a=>a.referenceId==='m'));
});

test('stop block default hasnext=false is equivalent to omission, but true differs',()=>{
 const p={targets:[{name:'s',blocks:{b:{opcode:'control_stop',topLevel:true,fields:{STOP_OPTION:['all',null]},inputs:{},mutation:{tagName:'mutation',children:[],hasnext:'false'}}}}]};
 const q=structuredClone(p);delete q.targets[0].blocks.b.mutation;
 assert.equal(compareProjects(p,q).ok,true);
 q.targets[0].blocks.b.mutation={hasnext:'true'};assert.equal(compareProjects(p,q).ok,false);
 q.targets[0].blocks.b.mutation={hasnext:'false',unknown:'keep'};assert.equal(compareProjects(p,q).ok,false);
});
