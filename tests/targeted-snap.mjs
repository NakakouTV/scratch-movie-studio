import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {EditorController} from '../server/controller.mjs';
import {blankProject} from '../server/project.mjs';

const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:30,drag:750,type:2,pause:30}}).open();
try {
  const buffer=await fs.readFile('PEN動作確認.sb3');
  await c.load(buffer);await c.load(await blankProject(buffer));
  await c.selectTarget('ペン');
  await c.execute({type:'variable.create',name:'grid',kind:'list',scope:'global'});
  await c.execute({type:'block.add',sourceId:'xy',opcode:'motion_gotoxy',place:{x:300,y:220}});
  await c.execute({type:'block.add',sourceId:'item',opcode:'data_itemoflist',place:{parent:'xy',input:'X'}});
  await c.page.evaluate(()=>{
    const b=studio.workspace.getTopBlocks(false)[0];
    window.nativeCandidate=b.dragStrategy.getConnectionCandidate;
  });
  const restored=async()=>assert.equal(await c.page.evaluate(()=>!studio.targetedDrag&&studio.workspace.getTopBlocks(false).every(b=>b.dragStrategy.getConnectionCandidate===window.nativeCandidate)),true);
  for(const [i,drag] of [140,650,750].entries()){
    c.timing.drag=drag;
    await c.execute({type:'block.add',sourceId:`sum${i}`,opcode:'operator_add',place:{parent:'item',input:'INDEX'}});
    await restored();
    // Moving an existing reporter uses the same guard as a new palette clone.
    await c.execute({type:'block.move',block:`sum${i}`,place:{parent:'xy',input:'Y'}});
    await restored();
    await c.execute({type:'block.delete',block:`sum${i}`});
  }
  // An incompatible statement must never silently snap to a nearby statement socket.
  await assert.rejects(c.execute({type:'block.add',opcode:'motion_movesteps',place:{parent:'item',input:'INDEX'}}),/接続できません/);
  await restored();
  const move=c.move;
  c.move=async function(...args){
    if(await this.page.evaluate(()=>!!studio.targetedDrag))throw new Error('injected drag failure');
    return move.apply(this,args);
  };
  await assert.rejects(c.execute({type:'block.add',opcode:'operator_add',place:{parent:'item',input:'INDEX'}}),/injected drag failure/);
  c.move=move;
  await restored();
  await c.execute({type:'block.add',sourceId:'afterFailure',opcode:'operator_add',place:{parent:'item',input:'INDEX'}});
  await restored();
  const mutation={proccode:'確認 %s 条件 %b',argumentnames:'["値","条件"]',argumentids:'["value","condition"]',argumentdefaults:'["",false]',warp:'false'};
  await c.execute({type:'procedure.create',sourceId:'definition',prototypeId:'prototype',mutation,x:100,y:450});
  await c.execute({type:'block.add',sourceId:'if',opcode:'control_if',place:{after:'definition'}});
  await c.execute({type:'block.add',sourceId:'condition',opcode:'argument_reporter_boolean',fields:{VALUE:['条件',null]},place:{parent:'if',input:'CONDITION'}});
  await c.execute({type:'block.add',sourceId:'say',opcode:'looks_say',place:{parent:'if',input:'SUBSTACK'}});
  await c.execute({type:'block.add',sourceId:'value',opcode:'argument_reporter_string_number',fields:{VALUE:['値',null]},place:{parent:'say',input:'MESSAGE'}});
  await restored();
  assert.deepEqual(c.errors,[]);
  console.log('Targeted snap PASS: 3 speeds, existing-block move, incompatible drop, exception cleanup, subsequent drag, boolean/string argument clones');
}finally{await c.close();}
