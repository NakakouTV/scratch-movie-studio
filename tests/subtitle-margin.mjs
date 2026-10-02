import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EditorController,subtitleMargin} from '../server/controller.mjs';
import {blankProject} from '../server/project.mjs';
import {normalizeCut} from '../server/cuts.mjs';
import {OPERATIONS} from '../server/api.mjs';
assert.equal(subtitleMargin(),220);for(const bad of [-1,401,1.5,'220',NaN])assert.throws(()=>subtitleMargin(bad));
assert.equal(normalizeCut({},OPERATIONS).subtitleMargin,220);assert.equal(normalizeCut({subtitleMargin:0},OPERATIONS).subtitleMargin,0);
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:40,drag:180,type:1,pause:30}}).open();
try{
 const buffer=await fs.readFile('PEN動作確認.sb3');await c.load(await blankProject(buffer));await c.selectTarget('ペン');
 const area=()=>c.page.evaluate(()=>studio.codeArea());
 const box=()=>c.page.evaluate(id=>studio.box(studio.workspace.getBlockById(id).pathObject.svgPath),c.resolve('move'));
 assert.ok((await area()).bottom<=1080-220);
 await c.execute({type:'block.add',sourceId:'move',opcode:'motion_movesteps',place:{x:200,y:1100}});
 let r=await box(),a=await area();assert.ok(r.y+r.height<a.bottom);assert.ok(Math.abs(r.y+r.height/2-(a.top+a.bottom)/2)<100,'new downward placement must appear centrally');
 await c.execute({type:'block.move',block:'move',place:{x:200,y:16000}});
 r=await box();a=await area();assert.ok(r.y+r.height<a.bottom);assert.ok(Math.abs(r.y+r.height/2-(a.top+a.bottom)/2)<100,'held downward drag must end centrally');
 const position=await c.page.evaluate(id=>studio.workspace.getBlockById(id).getRelativeToSurfaceXY().y,c.resolve('move'));assert.ok(Math.abs(position-16000)<2,'scrolling must preserve requested project coordinates');
 // Simulate manual scrolling that leaves the next numeric field at the bottom.
 await c.page.evaluate(id=>{const b=studio.workspace.getBlockById(id),r=studio.box(b.pathObject.svgPath);const w=studio.workspace;w.scroll(w.scrollX,w.scrollY+950-r.y);},c.resolve('move'));
 await c.execute({type:'block.input',block:'move',input:'STEPS',value:'42'});r=await box();assert.ok(r.y+r.height<(await area()).bottom);
 // Growing a script must pan before its next socket reaches the subtitle area.
 let previous='move';const initialScroll=(await c.state()).workspace.scrollY;
 for(let i=0;i<16;i++){
  const id='next'+i;await c.execute({type:'block.add',sourceId:id,opcode:'motion_movesteps',place:{after:previous}});
  const added=await c.page.evaluate(id=>studio.box(studio.workspace.getBlockById(id).pathObject.svgPath),c.resolve(id));assert.ok(added.y+added.height<(await area()).bottom);previous=id;
 }
 assert.ok((await c.state()).workspace.scrollY<initialScroll,'a growing stack must scroll upward');
 // The direction reporter starts near the bottom of the motion palette.
 const drag=c.dragWithSnap;c.dragWithSnap=async function(spec,place,move){if(spec.flyout)assert.ok(spec.source.grab.y<1080-220);return drag.call(this,spec,place,move);};
 await c.execute({type:'block.add',sourceId:'direction',opcode:'motion_direction',place:{parent:previous,input:'STEPS'}});
 await c.verifyConnection(c.resolve('direction'),{parent:previous,input:'STEPS'});
 const saved=await c.checkpoint(),sb3=await c.save();assert.equal(saved.subtitleMargin,220);
 await c.execute({type:'view.configure',subtitleMargin:0});const noMargin=await area();assert.ok(noMargin.bottom>a.bottom+180);
 await c.restoreCheckpoint(sb3,saved);assert.equal((await c.state()).workspace.subtitleMargin,220);
 await c.execute({type:'view.configure',subtitleMargin:300});assert.ok((await area()).bottom<=780);
 await fs.mkdir('test-results',{recursive:true});await c.page.screenshot({path:'test-results/subtitle-margin.png'});
 assert.deepEqual(c.errors,[]);console.log('PASS subtitle margin: add, held far drag, field input, growing stack, palette source, disable, checkpoint restore, cut settings');
}finally{await c.close();}
