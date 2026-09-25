import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {projectStructure} from '../server/structure.mjs';
import {readSb3,buildPlan} from '../server/project.mjs';

test('structure preserves connections, source IDs, literal fallbacks and variable scopes',()=>{
  const project={targets:[
    {name:'Stage',isStage:true,variables:{global:['x',7]},broadcasts:{message:'開始'},blocks:{}},
    {name:'Sprite',variables:{local:['x',9]},lists:{list:['一覧',[]]},blocks:{
      flag:{opcode:'event_whenflagclicked',topLevel:true,next:'move',x:100,y:200},
      move:{opcode:'motion_movesteps',parent:'flag',next:'say',inputs:{STEPS:[3,[12,'x','global'],[4,10]]}},
      say:{opcode:'looks_say',parent:'move',inputs:{MESSAGE:[3,[13,'一覧','list'],[10,'']]},fields:{}},
      reporter:[12,'x','local',300,400],
      send:{opcode:'event_broadcast',topLevel:true,inputs:{BROADCAST_INPUT:[1,[11,'開始','message']]}}
    }}]};
  const before=structuredClone(project),structure=projectStructure(project),target=structure.targets[1];
  const blocks=new Map(target.blocks.map(b=>[b.id,b]));
  assert.equal(blocks.get('move').parent,'flag');assert.equal(blocks.get('move').next,'say');
  assert.equal(blocks.get('move').inputs.STEPS.value.id,'move::STEPS');
  assert.deepEqual(blocks.get('move').inputs.STEPS.fallback,{kind:'literal',type:'number',value:10});
  assert.equal(blocks.get('move::STEPS').fields.VARIABLE.reference.scope,'global');
  assert.equal(blocks.get('reporter').fields.VARIABLE.reference.scope,'local');
  assert.equal(blocks.get('say::MESSAGE').opcode,'data_listcontents');
  assert.equal(blocks.get('send').inputs.BROADCAST_INPUT.value.reference.id,'message');
  assert.deepEqual(target.scripts.map(s=>s.id),['flag','reporter','send']);
  for(const action of buildPlan(project).actions.filter(a=>a.type==='block.add'))assert.ok(blocks.has(action.sourceId));
  assert.deepEqual(project,before);assert.deepEqual(projectStructure(project),structure);
});

test('procedure definitions keep source argument IDs and identify calls per target',()=>{
  const mutation={proccode:'処理 %s',argumentids:'["number"]',argumentnames:'["数"]',warp:'true'};
  const project={targets:[{name:'Sprite',blocks:{
    def:{opcode:'procedures_definition',topLevel:true,inputs:{custom_block:[1,'proto']}},
    proto:{opcode:'procedures_prototype',parent:'def',shadow:true,mutation},
    call:{opcode:'procedures_call',topLevel:true,mutation,inputs:{number:[1,[10,'123']]}}
  }}]};
  const t=projectStructure(project).targets[0];
  assert.deepEqual(t.procedures,[{id:'def',prototypeId:'proto',proccode:'処理 %s',argumentIds:['number'],argumentNames:['数'],warp:true,callBlockIds:['call']}]);
  assert.equal(t.blocks.find(b=>b.id==='call').inputs.number.value.value,'123');
});

test('PEN plan source IDs are all present in structure',async()=>{
  const {project}=await readSb3(await fs.readFile('PEN動作確認.sb3'));
  const structure=projectStructure(project);let target;
  for(const a of buildPlan(project).actions){
    if(a.type==='target.select')target=structure.targets.find(t=>t.name===a.target);
    if(a.type==='block.add'||a.type==='procedure.create')assert.ok(target.blocks.some(b=>b.id===a.sourceId),a.sourceId);
  }
  assert.ok(structure.extensions.includes('pen'));
});
