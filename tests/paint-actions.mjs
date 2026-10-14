import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {EditorController} from '../server/controller.mjs';
import {blankProject,readSb3} from '../server/project.mjs';
import {Recorder,runProcess} from '../server/recorder.mjs';
import {apiRouter,OPERATIONS} from '../server/api.mjs';
import {normalizeCut} from '../server/cuts.mjs';
const app=express();
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const output=path.resolve('test-results/paint',randomUUID());await fs.mkdir(output,{recursive:true});let c,recorder;
const base='http://127.0.0.1:'+server.address().port;app.use(express.json({limit:'80mb'}));app.use('/api',await apiRouter(output,base));app.use('/outputs',express.static(path.join(output,'outputs')));app.use('/scratch',express.static(path.resolve('vendor/package/dist')));app.use('/deps',express.static(path.resolve('node_modules')));app.use(express.static(path.resolve('web')));app.use(express.static(path.resolve('vendor/package/dist')));app.use((e,req,res,next)=>res.status(400).json({error:e.message}));
assert.throws(()=>normalizeCut({clearAssets:true},OPERATIONS));assert.equal(normalizeCut({start:'blank',clearAssets:true},OPERATIONS).clearAssets,true);
try{
 if(!process.argv.includes('--ui-only')){
 c=await new EditorController('http://127.0.0.1:'+server.address().port,{timing:{move:40,drag:220,type:8,pause:40}}).open();
 await c.load(await blankProject(await fs.readFile('PEN動作確認.sb3'),{assets:true}));await c.selectTarget('ペン');
 recorder=new Recorder(c.page,output);await recorder.start();
 const act=async a=>{console.log(a.type);const r=await c.execute(a);assert.equal(await c.page.locator('#movie-cursor').evaluate(el=>getComputedStyle(el).visibility),'hidden');return r;};
 const empty=await act({type:'costume.create',name:'空マス'});assert.equal(empty.name,'空マス');assert.equal(empty.items.length,0);
 await act({type:'paint.view',scale:4});
 const square=await act({type:'paint.shape',shape:'rectangle',x:-12,y:12,width:24,height:24,fill:'#008000',stroke:'#000000',strokeWidth:0});
 assert.deepEqual(square.bounds,{x:-12,y:12,width:24,height:24});assert.equal(square.fill,'#008000');
 const outlined=await act({type:'paint.style',strokeWidth:4});assert.equal(outlined.items[0].strokeBounds.width,26);assert.equal(outlined.items[0].strokeBounds.height,26);
 const white=await act({type:'costume.duplicate',name:'白マス'});assert.notEqual(white.index,empty.index);
 await act({type:'paint.view',scale:4});
 const circle=await act({type:'paint.shape',shape:'ellipse',x:-10,y:10,width:20,height:20,fill:'#ffffff',stroke:null,strokeWidth:0});assert.equal(circle.fill,'#ffffff');
 await act({type:'costume.duplicate',name:'黒マス'});await act({type:'paint.select',index:1});
 const black=await act({type:'paint.style',fill:'#000000'});assert.equal(black.items.length,2);assert.equal(black.items[1].fill,'#000000');assert.equal(black.items[0].fill,'#008000');
 await act({type:'wait',ms:400});await c.page.screenshot({path:path.join(output,'complete.png')});await recorder.stop();await recorder.encode();
 const result=await c.save();await fs.writeFile(path.join(output,'result.sb3'),result);const project=await readSb3(result),costumes=project.project.targets.find(t=>t.name==='ペン').costumes;
 assert.deepEqual(costumes.slice(-3).map(v=>v.name),['空マス','白マス','黒マス']);
 assert.equal(costumes.length,3,'temporary empty costume must be removed');
 for(const costume of costumes){const svg=await project.zip.file(costume.md5ext).async('string');assert.ok(svg.includes('#008000'));assert.ok(svg.includes('width="26" height="26"'));assert.equal(costume.rotationCenterX,13);assert.equal(costume.rotationCenterY,13);if(costume.name==='白マス')assert.ok(svg.includes('#ffffff'));}
 await c.load(result);await c.selectTarget('ペン');await c.selectCostume(costumes.length-1);await c.execute({type:'paint.select',index:1});assert.equal((await c.page.evaluate(()=>studio.paintInfo())).items[1].fill,'#000000');
 await assert.rejects(c.execute({type:'paint.shape',shape:'rectangle',x:0,y:0,width:-1,height:20}),/図形/);await assert.rejects(c.execute({type:'paint.style',fill:'green'}),/色は/);
 await assert.rejects(c.execute({type:'costume.rename',name:'空マス'}),/既に/);
 await assert.rejects(c.execute({type:'paint.shape',shape:'rectangle',x:9999,y:0,width:10,height:10}),/画面に/);
 await c.click(c.page.getByText('ビットマップに変換',{exact:true}));await c.page.waitForFunction(()=>studio.store.getState().scratchPaint.format.startsWith('BITMAP'));
 await c.execute({type:'costume.duplicate',name:'黒マス（ビットマップ）'});assert.equal((await c.state()).paint,null);await assert.rejects(c.execute({type:'paint.style',fill:'#ffffff'}),/ベクター/);
 const video=JSON.parse(await runProcess('ffprobe',['-v','error','-show_streams','-of','json',path.join(output,'movie.mp4')]));assert.ok(video.streams.some(v=>v.width===1920&&v.height===1080&&v.avg_frame_rate==='30/1'));
 assert.deepEqual(c.errors,[]);await c.close();c=null;
 }
 // Exercise the actual cut UI sample and the HTTP operation allowlist.
 const {chromium}=await import('playwright'),browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1080}});await page.goto(base+'/cuts.html');await page.locator('#source').setInputFiles('PEN動作確認.sb3');await page.waitForFunction(()=>!document.getElementById('paintSample').disabled);
  assert.equal(await page.locator('#paintTarget').inputValue(),'ペン');await page.getByText('コスチューム作画のサンプル',{exact:true}).click();await page.locator('#paintSample').click();
  const recipe=JSON.parse(await page.locator('#recipe').inputValue());assert.equal(recipe.clearAssets,true);recipe.speed=10;await page.locator('#recipe').fill(JSON.stringify(recipe));await page.locator('#before').fill('0');await page.locator('#after').fill('0.1');
  await page.locator('#render').click();await page.waitForFunction(()=>!document.getElementById('movie').hidden||!document.getElementById('error').hidden,null,{timeout:120000});assert.equal(await page.locator('#error').isVisible(),false,await page.locator('#error').textContent());
  const jobs=await (await page.request.get(base+'/api/jobs')).json(),job=jobs.find(j=>j.status==='completed');assert.ok(job);
  const saved=await readSb3(await fs.readFile(path.join(output,'outputs',job.id,'result.sb3')));assert.deepEqual(saved.project.targets.find(t=>t.name==='ペン').costumes.map(v=>v.name),['空マス','白マス','黒マス']);
  await page.screenshot({path:path.join(output,'cut-ui.png'),fullPage:true});
 }finally{await browser.close();}
 console.log('PASS official paint, 24x24 / 26x26, duplicate/name, ellipse recolor, saved SVG/reload, bitmap duplicate, cut UI and MP4: '+output);
}catch(e){if(c?.page&&!c.page.isClosed()){console.log(JSON.stringify(await c.page.evaluate(()=>studio.paintInfo()).catch(()=>null)));await c.page.screenshot({path:path.join(output,'failure.png')});}throw e;}finally{await recorder?.abort();await c?.close();await new Promise(resolve=>server.close(resolve));}
