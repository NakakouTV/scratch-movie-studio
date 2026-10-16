import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {EditorController} from '../server/controller.mjs';
import {Recorder,runProcess} from '../server/recorder.mjs';
const root=path.resolve('test-results/freeze',randomUUID());await fs.mkdir(root,{recursive:true});
const app=express();app.use('/scratch',express.static(path.resolve('vendor/package/dist')));app.use('/deps',express.static(path.resolve('node_modules')));app.use(express.static(path.resolve('web')));app.use(express.static(path.resolve('vendor/package/dist')));
const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});let c,recorder;
try{
 c=await new EditorController('http://127.0.0.1:'+server.address().port).open();
 await c.page.evaluate(()=>{const el=document.createElement('div');el.id='ticker';Object.assign(el.style,{position:'fixed',inset:'0',zIndex:9999,background:'#ff0000'});document.body.append(el);window.freezeTicks=0;setInterval(()=>{freezeTicks++;el.style.background=`hsl(${freezeTicks*29%360},100%,50%)`;},60);});
 recorder=new Recorder(c.page,root);await recorder.start();await c.pause(250);await recorder.setFrozen(true);const at=Date.now()-recorder.origin*1000,ticks=await c.page.evaluate(()=>freezeTicks);assert.equal(await c.page.evaluate(()=>studioAudio.captureGain.gain.value),0);
 await c.pause(800);assert.ok(await c.page.evaluate(()=>freezeTicks)>ticks+5);await recorder.setFrozen(false);assert.equal(await c.page.evaluate(()=>studioAudio.captureGain.gain.value),1);await c.pause(250);await recorder.stop();await recorder.encode();
 const sample=path.join(root,'rgb.bin');await runProcess('ffmpeg',['-y','-v','error','-ss',String((at+150)/1000),'-i',path.join(root,'movie.mp4'),'-t','0.4','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo',sample]);
 const bytes=await fs.readFile(sample);assert.ok(bytes.length>=24);for(let ch=0;ch<3;ch++){const values=[];for(let i=ch;i<bytes.length;i+=3)values.push(bytes[i]);assert.ok(Math.max(...values)-Math.min(...values)<=2,'frozen movie frames must remain constant while live page changes');}
 console.log('PASS frozen video frames, muted capture, live runtime continues, capture resumes: '+root);
}finally{await recorder?.abort();await c?.close();await new Promise(r=>server.close(r));}
