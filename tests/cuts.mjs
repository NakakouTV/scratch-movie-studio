import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {apiRouter,OPERATIONS} from '../server/api.mjs';
import {normalizeCut} from '../server/cuts.mjs';
import {readSb3,compareProjects} from '../server/project.mjs';
import {runProcess} from '../server/recorder.mjs';
const root=path.resolve('test-results/cuts',randomUUID());let base;await fs.mkdir(root,{recursive:true});
for(const bad of [{start:'other'},{beforeMs:-1},{speed:0},{framing:{scale:10}},{actions:[{type:'unknown'}]}])assert.throws(()=>normalizeCut(bad,OPERATIONS));
assert.equal(normalizeCut({actions:[]},OPERATIONS).beforeMs,500);
let server;
async function serve(){const app=express();server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);});base='http://127.0.0.1:'+server.address().port;app.use(express.json({limit:'80mb'}));app.use('/api',await apiRouter(root,base));app.use('/scratch',express.static(path.resolve('vendor/package/dist')));app.use('/deps',express.static(path.resolve('node_modules')));app.use(express.static(path.resolve('web')));app.use((e,req,res,next)=>res.status(400).json({error:e.message}));}
async function request(url,body){const res=await fetch(base+'/api'+url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await res.json();if(!res.ok)throw new Error(data.error);return data;}
async function done(id){const deadline=Date.now()+120000;while(Date.now()<deadline){const j=await request('/jobs/'+id);if(!['running','encoding'].includes(j.status))return j;await new Promise(r=>setTimeout(r,300));}throw new Error('cut timed out');}
async function projectFile(id,name){return (await readSb3(await fs.readFile(path.join(root,'outputs',id,name)))).project;}
try{
 await serve();const buffer=await fs.readFile('PEN動作確認.sb3');
 const res=await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:buffer}),p=await res.json();
 const recipe={projectId:p.id,title:'独立カット検証',start:'blank',speed:10,beforeMs:150,afterMs:200,setup:[{type:'target.select',target:'ペン'},{type:'block.add',sourceId:'flag',opcode:'event_whenflagclicked',place:{x:150,y:150}}],framing:{target:'ペン',block:'flag',scale:1},actions:[{type:'block.add',sourceId:'move',opcode:'motion_movesteps',place:{after:'flag'}},{type:'block.input',block:'move',input:'STEPS',value:'30'}],endFraming:{block:'flag',scale:1}};
 const first=await request('/cuts',recipe);await assert.rejects(()=>request('/cuts',recipe),/制作中/);
 const j=await done(first.id);assert.equal(j.status,'completed',j.error);assert.equal(j.kind,'cut');
 const start=await projectFile(j.id,'start.sb3'),result=await projectFile(j.id,'result.sb3');
 assert.equal(Object.values(start.targets.find(t=>t.name==='ペン').blocks).filter(b=>b.opcode==='motion_movesteps').length,0);
 assert.equal(Object.values(result.targets.find(t=>t.name==='ペン').blocks).filter(b=>b.opcode==='motion_movesteps').length,1);
 const log=JSON.parse(await fs.readFile(path.join(root,'outputs',j.id,'log.json')));assert.deepEqual(log.map(l=>l.phase),['setup','setup','capture','capture']);
 const info=JSON.parse(await runProcess('ffprobe',['-v','error','-show_streams','-of','json',path.join(root,'outputs',j.id,'movie.mp4')]));assert.equal(info.streams[0].r_frame_rate,'30/1');
 await new Promise(resolve=>server.close(resolve));await serve();
 const retake=await request(`/cuts/${j.id}/retake`,{}),second=await done(retake.id);assert.equal(second.status,'completed',second.error);assert.equal(second.retakeOf,j.id);assert.notEqual(second.id,j.id);
 assert.equal(compareProjects(result,await projectFile(second.id,'result.sb3')).ok,true);
 const failed=await done((await request(`/cuts/${j.id}/retake`,{actions:[{type:'workspace.focus',block:'missing'}]})).id);assert.equal(failed.status,'failed');assert.ok(!failed.artifacts.some(a=>a.name==='movie.mp4'));
 const demo=await done((await request(`/cuts/${j.id}/retake`,{setup:[],start:'project',framing:null,endFraming:null,actions:[{type:'project.start'},{type:'wait',ms:200},{type:'project.stop'}]})).id);assert.equal(demo.status,'completed',demo.error);
 const runtime=await done((await request(`/cuts/${j.id}/retake`,{setup:[...recipe.setup,{type:'variable.create',name:'DemoValue',scope:'global',value:100}],actions:[{type:'variable.set',name:'DemoValue',scope:'global',value:0,duration:200},{type:'script.run',block:'flag'},{type:'stage.view',mode:'fullscreen'},{type:'stage.view',mode:'editor'},{type:'sprite.drag',target:'ペン',x:50,y:30,duration:200}]})).id);
 assert.equal(runtime.status,'completed',runtime.error);const runtimeProject=await projectFile(runtime.id,'result.sb3');assert.equal(Object.values(runtimeProject.targets.find(t=>t.isStage).variables).find(v=>v[0]==='DemoValue')[1],0);assert.ok(Math.abs(runtimeProject.targets.find(t=>t.name==='ペン').x-50)<=1);
 console.log(JSON.stringify({root,first:j.id,retake:second.id,demo:demo.id}));console.log('PASS cut preparation, captured edits, framing, MP4, restart/retake, failure isolation, runtime actions');
}finally{await new Promise(resolve=>server?.close(resolve));}
