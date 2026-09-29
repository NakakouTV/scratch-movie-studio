import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EditorController} from '../server/controller.mjs';
import {blankProject} from '../server/project.mjs';
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:40,drag:150,type:1,pause:20}}).open();
try{
 const source=await fs.readFile('PEN動作確認.sb3');await c.load(await blankProject(source));await c.selectTarget('ペン');
 await c.execute({type:'variable.create',name:'HP',scope:'global',value:100});await c.execute({type:'variable.create',name:'HPローカル',scope:'local',value:7});
 // Existing sb3 files can contain duplicate names across variable scopes.
 await c.page.evaluate(()=>{Object.values(studio.vm.editingTarget.variables).find(v=>v.name==='HPローカル').name='HP';});
 await c.execute({type:'variable.set',name:'HP',scope:'global',value:0,duration:200});
 let s=await c.state();assert.equal(s.targets.find(t=>t.isStage).variables.find(v=>v.name==='HP').value,0);assert.equal(s.targets.find(t=>t.name==='ペン').variables.find(v=>v.name==='HP').value,7);
 await assert.rejects(c.execute({type:'variable.set',name:'missing',value:1}),/一意/);
 await c.execute({type:'target.select',target:'Stage',isStage:true});
 await assert.rejects(c.execute({type:'variable.set',name:'HP',scope:'local',value:999}),/scope: global/);
 await c.execute({type:'target.select',target:'ペン'});
 await c.execute({type:'block.add',sourceId:'set',opcode:'data_setvariableto',fields:{VARIABLE:['HP',s.targets.find(t=>t.isStage).variables.find(v=>v.name==='HP').id]},place:{x:220,y:200}});
 await c.execute({type:'block.input',block:'set',input:'VALUE',value:42});await c.execute({type:'script.run',block:'set'});
 await c.page.waitForFunction(()=>Object.values(studio.vm.runtime.getTargetForStage().variables).some(v=>v.name==='HP'&&v.value==42));
 await c.execute({type:'sprite.drag',target:'ペン',x:60,y:40,duration:200});s=await c.state();assert.ok(Math.abs(s.targets.find(t=>t.name==='ペン').x-60)<=1);
 await assert.rejects(c.execute({type:'sprite.drag',target:'ペン',x:9999,y:40}),/外/);
 assert.equal(await c.page.evaluate(()=>!!studio.spriteDragProbe),false);
 await c.execute({type:'stage.view',mode:'fullscreen'});assert.equal((await c.state()).stageMode,'fullscreen');
 await assert.rejects(c.execute({type:'sprite.drag',target:'ペン',x:0,y:0}),/ドラッグできる/);
 // Fixture configuration: runtime dragging must update the target continuously.
 await c.page.evaluate(()=>studio.vm.runtime.targets.find(t=>t.getName()==='ペン').setDraggable(true));
 await c.execute({type:'sprite.drag',target:'ペン',x:-50,y:-30,duration:200});
 await c.execute({type:'script.run',target:'ペン',block:'set'});assert.equal((await c.state()).stageMode,'editor');
 await c.execute({type:'block.add',sourceId:'loop',opcode:'control_forever',place:{after:'set'}});
 await c.execute({type:'script.run',block:'set'});
 await assert.rejects(c.execute({type:'script.run',block:'set'}),/既に実行中/);
 await assert.rejects(c.execute({type:'script.run',block:'loop'}),/先頭/);
 await c.execute({type:'project.stop'});
 assert.equal(await c.page.evaluate(()=>!!studio.spriteDragProbe),false);assert.deepEqual(c.errors,[]);
 console.log('PASS variable scopes/tween, native script click, editor/fullscreen sprite drag, state, rejected operations and cleanup');
}finally{await c.close();}
