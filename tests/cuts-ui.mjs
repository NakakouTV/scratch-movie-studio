import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {apiRouter} from '../server/api.mjs';
const root=path.resolve('test-results/cuts-ui',randomUUID());await fs.mkdir(root,{recursive:true});
const app=express(),server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}),base='http://127.0.0.1:'+server.address().port;
app.use(express.json({limit:'80mb'}));app.use('/api',await apiRouter(root,base));app.use('/outputs',express.static(path.join(root,'outputs')));app.use('/scratch',express.static(path.resolve('vendor/package/dist')));app.use('/deps',express.static(path.resolve('node_modules')));app.use(express.static(path.resolve('web')));app.use((e,req,res,next)=>res.status(400).json({error:e.message}));
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(base+'/cuts.html');await page.locator('#source').setInputFiles('PEN動作確認.sb3');await page.waitForFunction(()=>!document.getElementById('range').disabled);
 await page.locator('#from').fill('2');await page.locator('#to').fill('2');await page.locator('#range').click();
 const recipe=JSON.parse(await page.locator('#recipe').inputValue());assert.equal(recipe.setup.length,1);assert.equal(recipe.actions.length,1);recipe.speed=10;await page.locator('#recipe').fill(JSON.stringify(recipe,null,2));await page.locator('#before').fill('0.1');await page.locator('#after').fill('0.1');
 assert.equal(await page.locator('#subtitleMargin').inputValue(),'220');await page.locator('#subtitleMargin').selectOption('300');
 await page.locator('#render').click();await page.waitForFunction(()=>!document.getElementById('movie').hidden,null,{timeout:90000});assert.equal(await page.locator('#error').isVisible(),false);
 const jobs=await (await page.request.get(base+'/api/jobs')).json(),cut=jobs.find(j=>j.status==='completed');
 const savedRecipe=await (await page.request.get(base+cut.artifacts.find(a=>a.name==='cut.json').url)).json();assert.equal(savedRecipe.subtitleMargin,300);
 const url=await page.locator('#movie').getAttribute('src');assert.equal((await page.request.get(base+url)).status(),200);
 await page.locator('#movie').evaluate(async video=>{await video.play();});
 await page.waitForFunction(()=>document.getElementById('movie').currentTime>0.1);
 await page.locator('#movie').evaluate(video=>video.pause());
 await page.screenshot({path:path.join(root,'cuts-ui.png'),fullPage:true});
 await page.locator('#recipe').fill(JSON.stringify({start:'project',setup:[],actions:[{type:'wait',ms:3000}],speed:10}));await page.locator('#render').click();
 await page.waitForFunction(async()=>{const jobs=await(await fetch('/api/jobs')).json();return jobs.some(j=>j.status==='running'&&j.phase==='capture');},null,{timeout:60000});await page.locator('#cancel').click();
 await page.waitForFunction(()=>!document.getElementById('error').hidden&&document.getElementById('error').textContent.includes('中止'),null,{timeout:30000});assert.equal(await page.locator('#movie').isVisible(),false);
 assert.deepEqual(errors,[]);console.log('PASS cut UI upload/range/render/playback/history/cancel: '+root);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
