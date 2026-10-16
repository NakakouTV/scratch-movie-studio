import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {apiRouter} from '../server/api.mjs';
import {readSb3} from '../server/project.mjs';
import {runProcess} from '../server/recorder.mjs';
import {boardDemo} from './fixtures/board-demo.mjs';
const root=path.resolve('test-results/presentation',randomUUID());await fs.mkdir(root,{recursive:true});
const app=express(),server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));}),base='http://127.0.0.1:'+server.address().port;
app.use(express.json({limit:'80mb'}));app.use('/api',await apiRouter(root,base));app.use('/outputs',express.static(path.join(root,'outputs')));app.use('/scratch',express.static(path.resolve('vendor/package/dist')));app.use('/deps',express.static(path.resolve('node_modules')));app.use(express.static(path.resolve('web')));app.use(express.static(path.resolve('vendor/package/dist')));app.use((e,req,res,next)=>res.status(400).json({error:e.message}));
const api=async(url,body)=>{const res=await fetch(base+'/api'+url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await res.json();if(!res.ok)throw new Error(data.error);return data;};
const done=async id=>{const end=Date.now()+120000;while(Date.now()<end){const job=await api('/jobs/'+id);if(!['running','encoding'].includes(job.status))return job;await new Promise(r=>setTimeout(r,150));}throw new Error('presentation timeout');};
const data=async(job,file)=>JSON.parse(await fs.readFile(path.join(root,'outputs',job.id,file),'utf8'));
try{
 const source=await fs.readFile('PEN動作確認.sb3'),res=await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:source}),project=await res.json();
 const recipe={projectId:project.id,title:'説明の節目・変数と4の入力',start:'blank',speed:10,setupSpeed:10,beforeMs:0,afterMs:100,editorZoom:1.25,narration:{markers:[{id:'four',atMs:15000,text:'4にします'}]},beats:[
  {id:'create',text:'クローンIDという変数を作ります',before:[{type:'variables',scope:'local',target:'ペン',names:[]}],actions:[{type:'target.select',target:'ペン'},{type:'variable.create',name:'クローンID',scope:'local',monitor:{visible:false},cues:{'dialog.opened':{holdMs:100},'name.entered':{framing:{kind:'variableName'},holdMs:150},'scope.selected':{framing:{kind:'variableScope'},holdMs:250}}}],after:[{type:'variables',scope:'local',target:'ペン',names:['クローンID']},{type:'variable',scope:'local',target:'ペン',name:'位置',exists:false}],afterMs:300},
  {id:'number',text:'この値を4にします',actions:[{type:'block.add',sourceId:'move',opcode:'motion_movesteps',place:{x:250,y:260}},{type:'block.input',block:'move',input:'STEPS',value:'4',cues:{'target.visible':{framing:{kind:'input',block:'move',input:'STEPS',scale:1.2}},'value.before':{at:'four'},'value.entered':{holdMs:300,mode:'freeze'}}}],afterMs:300}
 ]};
 const job=await done((await api('/cuts',recipe)).id);assert.equal(job.status,'completed',job.error);const timeline=await data(job,'timeline.json'),marker=timeline.events.find(e=>e.type==='marker');assert.ok(Math.abs(marker.atMs-15000)<180);assert.ok(timeline.events.some(e=>e.type==='hold-start'&&e.mode==='freeze'));assert.ok(timeline.events.some(e=>e.target?.kind==='variableScope'));assert.ok(timeline.events.filter(e=>e.type==='assert').length>=2);assert.ok((await fs.readFile(path.join(root,'outputs',job.id,'timeline.csv'),'utf8')).includes('クローンID'));
 const saved=await readSb3(await fs.readFile(path.join(root,'outputs',job.id,'result.sb3')));assert.equal(Object.values(saved.project.targets.find(t=>t.name==='ペン').variables).filter(v=>v[0]==='クローンID').length,1);
 const retake=await done((await api('/cuts/'+job.id+'/retake',{})).id);assert.equal(retake.status,'completed',retake.error);
 const wrong=await done((await api('/cuts',{...recipe,narration:{markers:[]},beats:[{id:'assert',before:[{type:'variable',scope:'local',target:'ペン',name:'まだない',exists:true}],actions:[]}]})).id);assert.equal(wrong.status,'failed');assert.ok(!wrong.artifacts.some(a=>a.name==='movie.mp4'));
 const late=await done((await api('/cuts',{...recipe,beats:[{actions:[{type:'wait',ms:250},{type:'wait',ms:0,cues:{before:{atMs:0}}}]}]})).id);assert.equal(late.status,'failed');assert.match(late.error,/目印に間に合いません/);
 const freeze=timeline.events.find(e=>e.type==='hold-start'&&e.mode==='freeze');await runProcess('ffmpeg',['-y','-v','error','-ss',String((freeze.atMs+100)/1000),'-i',path.join(root,'outputs',job.id,'movie.mp4'),'-frames:v','1',path.join(root,'confirmation.png')]);
 const session=await api('/sessions',{projectId:project.id,blank:true,timing:{move:20,drag:120,type:1,pause:20}});
 try{
  await api('/sessions/'+session.id+'/actions',[{type:'target.select',target:'ペン'},{type:'procedure.create',sourceId:'explain-definition',prototypeId:'explain-prototype',mutation:{proccode:'説明用 %s',argumentnames:'["値"]',argumentids:'["arg"]',warp:'true'},x:300,y:240},{type:'view.focus',subject:{kind:'definition',block:'explain-definition',scale:1.1,minTextPx:12}},{type:'state.assert',checks:[{type:'block',target:'ペン',block:'explain-definition',exists:true,opcode:'procedures_definition'}]}]);
  const state=await api('/sessions/'+session.id+'/state');assert.equal(state.selectedTab,'code');
 }finally{await fetch(base+'/api/sessions/'+session.id,{method:'DELETE'});}
 const {chromium}=await import('playwright'),browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const fixture=path.join(root,'board.sb3');await fs.writeFile(fixture,await boardDemo());const page=await browser.newPage();await page.goto(base+'/cuts.html');await page.locator('#source').setInputFiles(fixture);await page.waitForFunction(()=>!document.getElementById('presentationSample').disabled);
  await page.getByText('説明の節目・音声の目印',{exact:true}).click();await page.locator('#presentationSample').click();const settings=JSON.parse(await page.locator('#recipe').inputValue());assert.equal(settings.beats[0].actions[0].name,'クローンID');
  const markers=path.join(root,'markers.json');await fs.writeFile(markers,JSON.stringify([{id:'four',atMs:16000,text:'4にします'}]));await page.locator('#markerFile').setInputFiles(markers);await page.waitForFunction(()=>JSON.parse(document.getElementById('recipe').value).narration.markers[0].atMs===16000);
  await page.locator('#comparisonSample').click();const comparison=JSON.parse(await page.locator('#recipe').inputValue());assert.equal(comparison.beats.length,2);comparison.speed=10;await page.locator('#recipe').fill(JSON.stringify(comparison));await page.locator('#before').fill('0');await page.locator('#after').fill('0');await page.locator('#render').click();
  await page.waitForFunction(()=>!document.getElementById('movie').hidden||!document.getElementById('error').hidden,null,{timeout:60000});assert.equal(await page.locator('#error').isVisible(),false,await page.locator('#error').textContent());await page.waitForFunction(()=>!document.getElementById('timingDetails').hidden);
  await page.screenshot({path:path.join(root,'presentation-ui.png'),fullPage:true});
 }finally{await browser.close();}
 console.log('PASS semantic cue timing, dialog/name/scope framing, freeze hold, state assertions, timeline/CSV/quality, retake and failure isolation: '+root);
}finally{await new Promise(r=>server.close(r));}
