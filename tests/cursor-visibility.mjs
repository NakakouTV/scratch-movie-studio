import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {EditorController} from '../server/controller.mjs';
import {blankProject} from '../server/project.mjs';
import {Recorder,runProcess} from '../server/recorder.mjs';

const app=express();app.use('/scratch',express.static(path.resolve('vendor/package/dist')));app.use('/deps',express.static(path.resolve('node_modules')));app.use(express.static(path.resolve('web')));app.use(express.static(path.resolve('vendor/package/dist')));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const directory=path.resolve('test-results/cursor-visibility',randomUUID());await fs.mkdir(directory,{recursive:true});
let c,recorder;
try{
 c=await new EditorController('http://127.0.0.1:'+server.address().port,{timing:{move:50,drag:180,type:20,pause:30}}).open();
 const visible=()=>c.page.locator('#movie-cursor').evaluate(el=>getComputedStyle(el).visibility==='visible');
 assert.equal(await visible(),false,'initial cursor must be hidden');
 await c.load(await blankProject(await fs.readFile('PEN動作確認.sb3')));await c.execute({type:'target.select',target:'ペン'});assert.equal(await visible(),false);
 const move=c.move;let moves=0;
 c.move=async function(...args){await move.call(this,...args);assert.equal(await visible(),true,'cursor must follow mouse during the action');moves++;};
 await c.execute({type:'block.add',sourceId:'move',opcode:'motion_movesteps',place:{x:300,y:300}});assert.equal(await visible(),false);
 await c.execute({type:'block.move',block:'move',place:{x:400,y:14000}});assert.equal(await visible(),false);assert.ok(moves>5);
 recorder=new Recorder(c.page,directory);await recorder.start();
 await c.execute({type:'block.input',block:'move',input:'STEPS',value:'123'});assert.equal(await visible(),false);
 const field=await c.page.evaluate(id=>studio.field(id,'STEPS').getValue(),c.resolve('move'));assert.equal(field,'123');
 await c.execute({type:'wait',ms:800});assert.equal(await visible(),false);
 await c.page.screenshot({path:path.join(directory,'after-input.png')});
 await recorder.stop();await recorder.encode();
 await runProcess('ffmpeg',['-y','-v','error','-sseof','-0.1','-i',path.join(directory,'movie.mp4'),'-frames:v','1',path.join(directory,'last-frame.png')]);
 const immediate=path.join(directory,'immediate');recorder=new Recorder(c.page,immediate);await recorder.start();
 await c.execute({type:'block.input',block:'move',input:'STEPS',value:'124'});await recorder.stop();await recorder.encode();
 await runProcess('ffmpeg',['-y','-v','error','-i',path.join(immediate,'movie.mp4'),'-vf',`select=eq(n\\,${recorder.frameCount-1})`,'-frames:v','1',path.join(immediate,'last-frame.png')]);
 const clip={x:Math.floor(c.position.x),y:Math.floor(c.position.y),width:24,height:32};
 await c.page.screenshot({path:path.join(immediate,'expected-cursor-area.png'),clip});
 await c.page.evaluate(p=>studio.cursor(p.x,p.y),c.position);await c.page.screenshot({path:path.join(immediate,'visible-cursor-area.png'),clip});await c.hideCursor();
 const similarity=async name=>{const log=await runProcess('ffmpeg',['-v','info','-i',path.join(immediate,'last-frame.png'),'-i',path.join(immediate,name),'-filter_complex',`[0:v]crop=24:32:${clip.x}:${clip.y}:exact=1[crop];[crop][1:v]ssim`,'-f','null','-']);return Number(log.match(/All:([\d.]+)/)?.[1]);};
 // Allow lossy JPEG/H.264 edges, but distinguish the hidden cursor from a
 // visible cursor at precisely the same input field.
 const hidden=await similarity('expected-cursor-area.png'),shown=await similarity('visible-cursor-area.png');assert.ok(hidden>0.8&&hidden>shown+0.2,`final frame must match hidden cursor area: hidden=${hidden}, shown=${shown}`);
 // Mouse events at the same position must also restore visibility, not just moves.
 await c.page.mouse.down();assert.equal(await visible(),true);await c.page.mouse.up();await c.hideCursor();
 await c.page.mouse.wheel(0,10);assert.equal(await visible(),true);await c.hideCursor();
 await c.execute({type:'mouse.move',x:600,y:500,duration:30});assert.equal(await visible(),false);
 await c.execute({type:'project.start'});assert.equal(await visible(),false);await c.execute({type:'project.stop'});assert.equal(await visible(),false);
 await c.execute({type:'stage.view',mode:'fullscreen'});assert.equal(await visible(),false);await c.execute({type:'stage.view',mode:'editor'});assert.equal(await visible(),false);
 await c.move(600,500,0);await assert.rejects(()=>c.execute({type:'unknown'}),/未対応/);assert.equal(await visible(),false,'failed actions must also hide cursor');
 assert.deepEqual(c.errors,[]);console.log('PASS cursor visible during movement and dragging, hidden after edits/runtime/wait/errors; MP4: '+directory);
}finally{await recorder?.abort();await c?.close();await new Promise(resolve=>server.close(resolve));}
