import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base='http://127.0.0.1:8601';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(base);
  await page.locator('#samples').selectOption({label:'PEN動作確認.sb3'});
  await page.locator('#loadSample').click();await page.locator('#sceneList .scene-row').first().waitFor();
  const rows=page.locator('#sceneList .scene-row'),count=await rows.count();assert.ok(count>=4);
  for(let i=0;i<count-1;i++)await rows.nth(i).locator('input[type=checkbox]').uncheck();
  await rows.last().locator('input[type=text]').fill('説明用の組み立て');
  await page.locator('#outputMode').selectOption('scenes');
  await page.locator('#demoSeconds').selectOption('0');await page.locator('#speed').selectOption('4');
  const responsePromise=page.waitForResponse(r=>r.url()===base+'/api/jobs'&&r.request().method()==='POST');
  await page.locator('#build').click();const response=await responsePromise;
  assert.equal(response.status(),202,await response.text());const {id}=await response.json();
  await page.waitForFunction(()=>['完成','確認が必要'].includes(document.querySelector('#state').textContent),null,{timeout:240000});
  const job=await (await fetch(`${base}/api/jobs/${id}`)).json();assert.equal(job.status,'completed',job.error);assert.ok(job.verification.ok);
  assert.equal(job.artifacts.filter(a=>a.name.endsWith('.mp4')).length,1);
  assert.ok(!job.artifacts.some(a=>a.name==='movie.mp4'));
  await page.getByRole('link',{name:'↓ 説明用の組み立て',exact:true}).waitFor();
  assert.ok((await page.locator('#video').getAttribute('src')).includes('/scenes/'));
  await page.screenshot({path:'test-results/scenes-ui.png',fullPage:true});
  await fs.writeFile('test-results/scenes-ui.json',JSON.stringify({id,verification:job.verification,sceneMovies:job.artifacts.filter(a=>a.sceneId)},null,2));
  assert.deepEqual(errors,[]);console.log('PASS scene-only HTTP/UI: automatic scene list, rename, selection, output, playback, full project verification');
}finally{await browser.close();}
