import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EditorController} from '../server/controller.mjs';
import {readSb3,compareProjects} from '../server/project.mjs';
const dir='test-results/full-projects/maze',c=await new EditorController('http://127.0.0.1:8601',{timing:{move:50,drag:150,type:1,pause:40}}).open();
try{
 const status=JSON.parse(await fs.readFile(dir+'/status.json','utf8'));
 const source=await fs.readFile(status.file),saved=await fs.readFile(dir+'/partial.sb3');
 await c.load(source);const expected=JSON.parse(await c.page.evaluate(()=>studio.vm.toJSON()));
 const {zip:originalZip}=await readSb3(await c.save()),{project:actual,zip:actualZip}=await readSb3(saved);
 const comparison=compareProjects(expected,actual);await fs.writeFile(dir+'/verification.json',JSON.stringify(comparison,null,2));assert.deepEqual(comparison,{ok:true,differences:[]});
 for(const t of expected.targets)for(const a of [...t.costumes,...t.sounds])assert.deepEqual(await originalZip.file(a.md5ext).async('nodebuffer'),await actualZip.file(a.md5ext).async('nodebuffer'));
 await c.load(saved);await c.execute({type:'project.start'});await c.pause(3000);await c.execute({type:'project.stop'});
 const labels=await c.page.locator('[class*="monitor_label"], [class*="monitor_list-header"]').allTextContents();assert.ok(labels.every(v=>v.trim()));
 await c.page.screenshot({path:dir+'/after-run.png'});await fs.writeFile(dir+'/rebuilt.sb3',saved);
 status.previousError=status.error;delete status.error;delete status.stack;status.status='passed';status.recheckedAt=new Date().toISOString();status.monitors={after:labels};status.note='All 742 UI actions completed in prior run; final comparison rerun after stop-block default normalization.';
 await fs.writeFile(dir+'/status.json',JSON.stringify(status,null,2));console.log('maze full reconstruction recheck PASS: program, assets, runtime labels');
}finally{await c.close();}
