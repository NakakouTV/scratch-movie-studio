import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {EditorController} from '../server/controller.mjs';
import {readSb3,blankProject,buildPlan,compareProjects} from '../server/project.mjs';
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:60,drag:220,type:5,pause:50}}).open();
try{
 const {project,zip}=await readSb3(await blankProject(await fs.readFile('PEN動作確認.sb3')));
 const stage=project.targets[0],sprite=project.targets[1];stage.broadcasts={m1:'迷路開始',m2:'迷路完成'};
 sprite.blocks={
  send:{opcode:'event_broadcast',topLevel:true,x:100,y:100,next:null,parent:null,shadow:false,fields:{},inputs:{BROADCAST_INPUT:[1,[11,'迷路開始','m1']]}},
  wait:{opcode:'event_broadcastandwait',topLevel:true,x:100,y:200,next:null,parent:null,shadow:false,fields:{},inputs:{BROADCAST_INPUT:[1,[11,'迷路完成','m2']]}},
  dynamic:{opcode:'event_broadcast',topLevel:true,x:100,y:300,next:null,parent:null,shadow:false,fields:{},inputs:{BROADCAST_INPUT:[3,'join',[11,'迷路開始','m1']]}},
  join:{opcode:'operator_join',next:null,parent:'dynamic',shadow:false,fields:{},inputs:{STRING1:[1,[10,'迷路']],STRING2:[1,[10,'完成']]}},
  receive:{opcode:'event_whenbroadcastreceived',topLevel:true,x:400,y:100,next:null,parent:null,shadow:false,inputs:{},fields:{BROADCAST_OPTION:['迷路完成','m2']}}
 };
 zip.file('project.json',JSON.stringify(project));const buffer=await zip.generateAsync({type:'nodebuffer'});
 await c.load(buffer);const expected=JSON.parse(await c.page.evaluate(()=>studio.vm.toJSON()));
 await c.load(await blankProject(buffer));
 for(const a of buildPlan(project).actions)await c.execute(a);
 const result=compareProjects(expected,JSON.parse(await c.page.evaluate(()=>studio.vm.toJSON())));assert.deepEqual(result,{ok:true,differences:[]});
 console.log('compact message literals, send/wait/receive, reporter fallback and semantic comparison PASS');
 // Compatibility with the exact old operation that timed out at step 114.
 await c.execute({type:'block.add',sourceId:'legacy',opcode:'event_broadcast',place:{x:400,y:400}});
 for(const value of ['メッセージ1','迷路開始','旧手順の新しい名前']){
  await c.execute({type:'block.input',block:'legacy',input:'BROADCAST_INPUT',value});
  assert.equal(await c.page.evaluate(id=>studio.field(id,'BROADCAST_INPUT','BROADCAST_OPTION').getText(),c.resolve('legacy')),value);
 }
 assert.equal(await c.page.locator('input.blocklyHtmlInput:visible').count(),0);
 assert.deepEqual(c.errors,[]);
 console.log('legacy block.input selects existing names and creates missing names PASS');
}catch(e){await c.page.screenshot({path:'test-results/broadcast-timeout-failure.png'});throw e;}finally{await c.close();}
