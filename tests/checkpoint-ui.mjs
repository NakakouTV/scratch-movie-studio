import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const base='http://127.0.0.1:8601';
try{
  await page.goto(base);await page.locator('#history').waitFor();
  if(process.argv.includes('--resume')){
    const {id}=JSON.parse(await fs.readFile('test-results/checkpoint-ui.json','utf8'));
    await page.waitForFunction(id=>document.querySelector('#history').value===id,id);
    await page.locator('#resume').waitFor({state:'visible'});await page.locator('#resume').click();
    await page.waitForFunction(()=>['完成','確認が必要'].includes(document.querySelector('#state').textContent),null,{timeout:180000});
    assert.equal(await page.locator('#state').innerText(),'完成',await page.locator('#error').textContent());
    const job=await (await fetch(`${base}/api/jobs/${id}`)).json();assert.ok(job.verification.ok);assert.equal(job.status,'completed');
    await page.screenshot({path:'test-results/checkpoint-ui-completed.png',fullPage:true});
    console.log('PASS HTTP/UI: server restart restored history; resume without source upload; completed verification');
  }else{
    await page.locator('#samples').selectOption({label:'PEN動作確認.sb3'});await page.locator('#loadSample').click();
    await page.locator('#record').uncheck();await page.locator('#speed').selectOption('0.5');await page.locator('#demoSeconds').selectOption('0');
    await page.locator('#build').click();await page.locator('#pause').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#checkpoint').textContent.includes('保存済み'),null,{timeout:60000});
    await page.locator('#pause').click();
    await page.waitForFunction(()=>document.querySelector('#state').textContent==='一時停止',null,{timeout:60000});
    const jobs=await (await fetch(base+'/api/jobs')).json(),job=jobs.find(j=>j.status==='paused');assert.ok(job.resumable);
    await fs.writeFile('test-results/checkpoint-ui.json',JSON.stringify({id:job.id}));
    await page.screenshot({path:'test-results/checkpoint-ui-paused.png',fullPage:true});
    console.log('PASS HTTP/UI: settings, pause, checkpoint download, resume button; ready for server restart');
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();}
