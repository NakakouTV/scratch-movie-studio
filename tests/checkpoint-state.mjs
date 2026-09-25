import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EditorController} from '../server/controller.mjs';
import {blankProject} from '../server/project.mjs';
const options={timing:{move:30,drag:150,type:1,pause:30}},base='http://127.0.0.1:8601';
let c=await new EditorController(base,options).open();
try{
  const buffer=await fs.readFile('PEN動作確認.sb3');await c.load(buffer);await c.load(await blankProject(buffer));await c.selectTarget('ペン');
  await c.execute({type:'variable.create',sourceId:'source-var',name:'保存する変数',scope:'global',value:7});
  const mutation={proccode:'テスト %s %b',argumentnames:'["数","条件"]',argumentids:'["source-number","source-bool"]',argumentdefaults:'["",false]',warp:'true'};
  await c.execute({type:'procedure.create',sourceId:'source-def',prototypeId:'source-proto',mutation,x:200,y:200});
  await c.execute({type:'block.add',sourceId:'source-call',opcode:'procedures_call',mutation,place:{after:'source-def'}});
  await c.execute({type:'broadcast.create',sourceId:'source-message',name:'再開メッセージ'});
  await c.execute({type:'view.configure',minScale:1});
  const state=await c.checkpoint(),snapshot=await c.save();assert.equal(state.minScale,1);
  for(const key of ['aliases','procedures','variableRefs','broadcastNames','callArgs'])assert.ok(state.maps[key].length,key);
  await c.close();c=await new EditorController(base,options).open();await c.restoreCheckpoint(snapshot,state);
  assert.equal(c.target,state.view.target);assert.equal(c.minScale,1);
  for(const key of Object.keys(state.maps))assert.deepEqual([...c[key]],state.maps[key],key);
  const restored=await c.checkpoint();assert.equal(restored.view.scale,state.view.scale);assert.ok(Math.abs(restored.view.x-state.view.x)<1&&Math.abs(restored.view.y-state.view.y)<1);
  assert.ok(state.view.extensions.includes('pen'));await c.category('pen');
  await c.execute({type:'block.input',block:'source-call',input:'source-number',value:'12345'});
  await c.execute({type:'block.add',sourceId:'source-argument',opcode:'argument_reporter_boolean',fields:{VALUE:['条件',null]},place:{parent:'source-call',input:'source-bool'}});
  await c.verifyConnection(c.resolve('source-argument'),{parent:'source-call',input:'source-bool'});
  await c.execute({type:'block.add',sourceId:'source-receive',opcode:'event_whenbroadcastreceived',place:{x:400,y:500}});
  await c.execute({type:'block.field',block:'source-receive',field:'BROADCAST_OPTION',referenceId:'source-message'});
  assert.deepEqual(c.errors,[]);await c.page.screenshot({path:'test-results/checkpoint-state.png'});
  console.log('PASS: all ID maps, view/target/zoom, saved procedure call inputs, cloned boolean argument, deferred broadcast');
}finally{await c.close();}
