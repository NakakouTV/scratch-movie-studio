import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {EditorController} from '../server/controller.mjs';
import {blankProject} from '../server/project.mjs';
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:50,drag:220,type:1,pause:40}}).open();
try{
 const buffer=await fs.readFile('PEN動作確認.sb3');await c.load(buffer);await c.load(await blankProject(buffer));await c.selectTarget('ペン');
 for(const scale of [1,.35]){
  await c.execute({type:'workspace.zoom',scale});
  const suffix=String(scale),set='set'+suffix,join='join'+suffix;
  await c.execute({type:'variable.create',name:'結合先'+suffix,sourceId:'v'+suffix,scope:'local',value:0});
  await c.execute({type:'block.add',sourceId:set,opcode:'data_setvariableto',place:{x:300,y:300}});
  await c.execute({type:'block.add',sourceId:join,opcode:'operator_join',place:{parent:set,input:'VALUE'}});
  await c.execute({type:'block.input',block:join,input:'STRING1',value:'左側を長い入力欄が占めていてもブロック本体をつかむ'});
  await c.execute({type:'block.input',block:join,input:'STRING2',value:'確認'});
  await c.execute({type:'block.move',block:join,place:{x:400,y:600}});
  await c.execute({type:'block.move',block:join,place:{parent:set,input:'VALUE'}});
  const nested='nested'+suffix;
  await c.execute({type:'block.add',sourceId:nested,opcode:'operator_join',place:{parent:join,input:'STRING2'}});
  for(const [opcode,input] of [['operator_letter_of','STRING1'],['operator_length','STRING2'],['operator_contains','STRING1']]){
   await c.execute({type:'block.add',sourceId:opcode+suffix,opcode,place:{parent:nested,input}});
  }
  await c.verifyConnection(c.resolve(join),{parent:set,input:'VALUE'});
  console.log('input-first reporters, nested join and long-input move PASS scale',scale);
 }
 assert.deepEqual(c.errors,[]);
}catch(e){await c.page.screenshot({path:'test-results/input-first-failure.png'});throw e;}finally{await c.close();}
