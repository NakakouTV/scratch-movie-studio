import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {EditorController} from '../server/controller.mjs';
import {blankProject,readSb3,buildPlan,compareProjects} from '../server/project.mjs';
const file=process.argv[2];if(!file)throw Error('sb3 path required');
const key=process.argv[3]||path.basename(file,'.sb3'),dir=path.resolve('test-results/full-projects',key);await fs.mkdir(dir,{recursive:true});
const buffer=await fs.readFile(file),{project}=await readSb3(buffer),plan=buildPlan(project,{assets:true});
const status={file,total:plan.actions.length,step:0,status:'running',startedAt:new Date().toISOString(),warnings:plan.warnings};
async function report(){await fs.writeFile(path.join(dir,'status.json'),JSON.stringify(status,null,2));}
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:25,drag:150,type:1,pause:30}}).open();
try{
 await c.load(buffer);const expected=JSON.parse(await c.page.evaluate(()=>studio.vm.toJSON()));
 const normalized=await c.save();await c.setAssetSource(normalized);await c.load(await blankProject(buffer,{assets:true}));
 await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify(plan,null,2));await report();
 for(const [i,a] of plan.actions.entries()){
  status.step=i+1;status.action=a;await c.execute(a);
  if(i%25===0||i===plan.actions.length-1){await report();console.log(`${key} ${i+1}/${plan.actions.length} ${a.type}`);}
 }
 const actual=JSON.parse(await c.page.evaluate(()=>studio.vm.toJSON()));const comparison=compareProjects(expected,actual);
 await fs.writeFile(path.join(dir,'verification.json'),JSON.stringify(comparison,null,2));assert.deepEqual(comparison,{ok:true,differences:[]});
 const saved=await c.save();await fs.writeFile(path.join(dir,'rebuilt.sb3'),saved);
 const {zip:originalZip}=await readSb3(normalized),{zip:actualZip}=await readSb3(saved);
 for(const target of expected.targets)for(const asset of [...target.costumes,...target.sounds])assert.deepEqual(await actualZip.file(asset.md5ext).async('nodebuffer'),await originalZip.file(asset.md5ext).async('nodebuffer'));
 const labelsBefore=await c.page.locator('[class*="monitor_label"], [class*="monitor_list-header"]').allTextContents();
 assert.ok(labelsBefore.every(v=>v.trim()),'visible monitor label is empty');
 await c.page.screenshot({path:path.join(dir,'before-run.png')});
 await c.execute({type:'project.start'});await c.pause(3000);await c.execute({type:'project.stop'});
 const labelsAfter=await c.page.locator('[class*="monitor_label"], [class*="monitor_list-header"]').allTextContents();
 assert.ok(labelsAfter.every(v=>v.trim()),'runtime monitor label is empty');
 await c.page.screenshot({path:path.join(dir,'after-run.png')});
 assert.deepEqual(c.errors,[]);status.status='passed';status.monitors={before:labelsBefore,after:labelsAfter};
 console.log(`${key} FULL PASS ${plan.actions.length} actions, semantics, asset bytes, runtime labels`);
}catch(e){status.status='failed';status.error=e.message;status.stack=e.stack;await c.page.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(dir,'partial.sb3'),await c.save()).catch(()=>{});console.error(`${key} FAIL step ${status.step}: ${e.message}`);process.exitCode=1;}
finally{status.finishedAt=new Date().toISOString();await report();await c.close();}
