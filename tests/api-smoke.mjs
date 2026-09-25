import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const base='http://127.0.0.1:8601';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
const page=await browser.newPage({viewport:{width:1440,height:1080}});
try {
  await page.goto(base);
  await page.locator('#samples option').nth(1).waitFor({state:'attached'});
  await page.selectOption('#samples','PEN動作確認.sb3');await page.click('#loadSample');
  await page.waitForFunction(()=>!document.getElementById('build').disabled);
  await page.selectOption('#speed','4');await page.click('#build');
  await page.waitForTimeout(2000);
  await page.screenshot({path:'test-results/dashboard.png'});
  let previous='';
  for(let i=0;i<300;i++) {
    const state=await page.locator('#state').textContent(),current=await page.locator('#current').textContent();
    if(current!==previous){console.log(state,current);previous=current;}
    if(state==='完成'||state==='確認が必要'||state==='中止')break;
    await page.waitForTimeout(1000);
  }
  await page.screenshot({path:'test-results/dashboard-finished.png'});
  const jobs=await (await fetch(base+'/api/jobs')).json();
  await fs.writeFile('test-results/api-job.json',JSON.stringify(jobs[0],null,2));
  console.log('JOB',JSON.stringify(jobs[0],null,2));
  if(jobs[0]?.status!=='completed')process.exitCode=1;
} finally {await browser.close();}
