import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {EditorController,editorZoom} from '../server/controller.mjs';
import {apiRouter} from '../server/api.mjs';
import {boardDemo} from './fixtures/board-demo.mjs';
import {runProcess} from '../server/recorder.mjs';
const root=path.resolve('test-results/stage-cursor-zoom',randomUUID());await fs.mkdir(root,{recursive:true});
const app=express(),server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}),base='http://127.0.0.1:'+server.address().port;
app.use(express.json({limit:'80mb'}));app.use('/api',await apiRouter(root,base));app.use('/outputs',express.static(path.join(root,'outputs')));app.use('/scratch',express.static(path.resolve('vendor/package/dist')));app.use('/deps',express.static(path.resolve('node_modules')));app.use(express.static(path.resolve('web')));app.use(express.static(path.resolve('vendor/package/dist')));app.use((e,req,res,next)=>res.status(400).json({error:e.message}));
const request=async(route,body)=>{const r=await fetch(base+'/api'+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw new Error(data.error);return data;};
let c;
try{
 assert.throws(()=>editorZoom(.9));assert.throws(()=>editorZoom(2.1));
 const buffer=await boardDemo();await fs.writeFile(path.join(root,'board.sb3'),buffer);
 c=await new EditorController(base,{timing:{move:40,drag:130,pause:20,type:1}}).open();await c.load(buffer);await c.selectTarget('マス');
 assert.equal(await c.page.evaluate(()=>studio.workspace.getAllBlocks(false).find(b=>b.type==='control_create_clone_of_menu').isShadow()),true,'fixture clone menu must use the native shadow shape');
 const visible=()=>c.page.locator('#movie-cursor').evaluate(e=>e.style.visibility==='visible');
 const labelSize=()=>c.page.evaluate(()=>parseFloat(getComputedStyle(document.querySelector('[role="tab"]')).fontSize)*devicePixelRatio);
 const normal=await labelSize();await c.execute({type:'view.configure',editorZoom:1.5});assert.ok(Math.abs((await labelSize())/normal-1.5)<.05);assert.equal((await c.state()).editorZoom,1.5);assert.equal((await c.state()).workspace.subtitleMargin,220);
 await c.execute({type:'block.add',sourceId:'test-move',opcode:'motion_movesteps',place:{x:300,y:250}});await c.execute({type:'block.input',block:'test-move',input:'STEPS',value:42});assert.equal(await visible(),false);
 const checkpoint=await c.checkpoint(),saved=await c.save();await c.execute({type:'view.configure',editorZoom:1});await c.restoreCheckpoint(saved,checkpoint);assert.equal((await c.state()).editorZoom,1.5);
 await c.execute({type:'board.configure',rows:4,columns:4,target:'マス'});await c.execute({type:'project.start'});await c.execute({type:'runtime.wait',conditions:[{type:'cloneCount',target:'マス',value:16}]});
 for(const [i,mode] of ['editor','fullscreen'].entries()){
  await c.execute({type:'stage.view',mode});assert.equal(await visible(),false);
  await c.execute({type:'board.click',row:1,column:i+1});assert.equal(await visible(),true);
  await c.execute({type:'runtime.wait',conditions:[{type:'list',scope:'global',name:'マスの状態',index:i+1,value:'黒マス'}]});assert.equal(await visible(),true);
  await c.execute({type:'wait',ms:150});assert.equal(await visible(),true);await c.execute({type:'keyboard.press',key:'ArrowLeft'});assert.equal(await visible(),true);
  const p=await c.page.evaluate(()=>{const r=studio.vm.renderer.canvas.getBoundingClientRect();return {x:(r.left+r.width*.8)*studio.editorZoom,y:(r.top+r.height*.8)*studio.editorZoom};});
  await c.execute({type:'mouse.click',...p});assert.equal(await visible(),true);await c.execute({type:'mouse.down'});await c.execute({type:'mouse.up'});assert.equal(await visible(),true);
  await c.execute({type:'wait',ms:100});await c.settleCursor(true);assert.equal(await visible(),true);
 }
 await c.page.screenshot({path:path.join(root,'zoom-fullscreen.png')});
 assert.equal(await c.page.evaluate(()=>devicePixelRatio),1.5,'screenshots must preserve whole-editor zoom');
 await c.execute({type:'stage.view',mode:'editor'});await c.execute({type:'monitor.show',kind:'list',scope:'global',name:'マスの状態'});assert.equal(await visible(),false);
 await c.execute({type:'monitor.layout',kind:'list',scope:'global',name:'マスの状態',x:12,y:48,width:150,height:140});
 await c.execute({type:'monitor.hide',kind:'list',scope:'global',name:'マスの状態'});await c.execute({type:'project.stop'});
 await c.execute({type:'view.configure',editorZoom:1.75});await c.execute({type:'block.input',block:'test-move',input:'STEPS',value:43});assert.equal(await visible(),false);await c.page.screenshot({path:path.join(root,'zoom-editor.png')});
 await c.execute({type:'stage.view',mode:'fullscreen'});await c.execute({type:'stage.view',mode:'editor'});
 const png=await c.page.screenshot();assert.equal(png.readUInt32BE(16),1920);assert.equal(png.readUInt32BE(20),1080);assert.deepEqual(c.errors,[]);await c.close();c=null;
 const upload=await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:buffer}),project=await upload.json();
 const cut=await request('/cuts',{projectId:project.id,title:'ゲーム中のカーソル・全体150%',editorZoom:1.5,speed:5,setup:[{type:'target.select',target:'マス'},{type:'project.start'},{type:'runtime.wait',conditions:[{type:'cloneCount',target:'マス',value:16}]},{type:'board.configure',rows:4,columns:4,target:'マス'},{type:'stage.view',mode:'fullscreen'}],actions:[{type:'board.click',row:1,column:1},{type:'runtime.wait',conditions:[{type:'list',scope:'global',name:'マスの状態',index:1,value:'黒マス'}]},{type:'wait',ms:100}],afterMs:300});
 let job;const deadline=Date.now()+60000;do{job=await request('/jobs/'+cut.id);if(!['running','encoding'].includes(job.status))break;assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,150));}while(true);assert.equal(job.status,'completed',job.error);
 const dir=path.join(root,'outputs',job.id);await runProcess('ffmpeg',['-y','-v','error','-sseof','-0.05','-i',path.join(dir,'movie.mp4'),'-frames:v','1',path.join(root,'last-frame.png')]);
 const meta=JSON.parse(await runProcess('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate','-of','json',path.join(dir,'movie.mp4')]));assert.equal(meta.streams[0].width,1920);assert.equal(meta.streams[0].height,1080);assert.equal(meta.streams[0].r_frame_rate,'30/1');
 console.log('PASS game cursor retained through click/wait/keys; editing hidden; whole UI 150%/175%, checkpoint, monitor, fullscreen and 1080p MP4: '+root);
}finally{await c?.close();await new Promise(resolve=>server.close(resolve));}
