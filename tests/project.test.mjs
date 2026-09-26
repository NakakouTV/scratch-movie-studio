import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readSb3,blankProject,buildPlan,compareProjects,repairDependentFieldOrder} from '../server/project.mjs';

test('sensing property follows its object menu, before a dynamic object reporter',()=>{
  for(const dynamic of [false,true]){
    const p={targets:[{name:'Stage',isStage:true,blocks:{}},{name:'Sprite',blocks:{
      of:{opcode:'sensing_of',topLevel:true,fields:{PROPERTY:['x position',null]},inputs:{OBJECT:dynamic?[3,'join','menu']:[1,'menu']}},
      menu:{opcode:'sensing_of_object_menu',shadow:true,fields:{OBJECT:['Other',null]}},
      ...(dynamic?{join:{opcode:'operator_join',inputs:{STRING1:[1,[10,'Oth']],STRING2:[1,[10,'er']]}}}:{})
    }}]};
    const a=buildPlan(p).actions,object=a.findIndex(a=>a.field==='OBJECT'),property=a.findIndex(a=>a.field==='PROPERTY');
    assert.ok(object>=0&&object<property);
    if(dynamic)assert.ok(property<a.findIndex(a=>a.opcode==='operator_join'));
  }
});

test('old pending sensing field order is repaired without changing checkpoint prefix or action count',()=>{
  const property={type:'block.field',block:'b',field:'PROPERTY',value:'y position'},object={type:'block.field',block:'b',input:'OBJECT',field:'OBJECT',value:'Sprite3'};
  const actions=[property,object,property,object],fixed=repairDependentFieldOrder(actions,2);
  assert.deepEqual(fixed,[property,object,object,property]);assert.deepEqual(actions,[property,object,property,object]);
  assert.equal(repairDependentFieldOrder(fixed,2),fixed);
  assert.equal(repairDependentFieldOrder(actions,3),actions);
});

test('covered literals keep defaults while active constants and dependent menus are preserved',()=>{
  const p={targets:[{name:'Stage',isStage:true,variables:{v:['n',3]},blocks:{
    move:{opcode:'motion_movesteps',topLevel:true,inputs:{STEPS:[3,'sum',[4,'999']]}},
    sum:{opcode:'operator_add',parent:'move',inputs:{NUM1:[3,[12,'n','v'],[4,'888']],NUM2:[1,[4,'7']]}},
    say:{opcode:'looks_say',topLevel:true,inputs:{MESSAGE:[3,'join','textShadow']}},
    textShadow:{opcode:'text',shadow:true,fields:{TEXT:['隠れる値',null]}},
    join:{opcode:'operator_join',parent:'say',inputs:{STRING1:[1,[10,'表示']],STRING2:[1,[10,'する']]}}
  }}]};
  const actions=buildPlan(p).actions;
  assert.ok(!actions.some(a=>a.type==='block.input'&&['999','888'].includes(a.value)));
  assert.ok(!actions.some(a=>a.type==='block.field'&&a.value==='隠れる値'));
  assert.ok(actions.some(a=>a.type==='block.input'&&a.block==='sum'&&a.input==='NUM2'&&a.value==='7'));
  assert.ok(actions.some(a=>a.sourceId==='sum::NUM1'));
  const q=structuredClone(p);q.targets[0].blocks.move.inputs.STEPS[2][1]='10';q.targets[0].blocks.sum.inputs.NUM1[2][1]='';q.targets[0].blocks.textShadow.fields.TEXT[0]='こんにちは!';
  assert.equal(compareProjects(p,q).ok,true);
});

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
