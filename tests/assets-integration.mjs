import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {EditorController} from '../server/controller.mjs';
import {readSb3,blankProject,buildPlan,compareProjects} from '../server/project.mjs';
const buffer=await fs.readFile(process.argv[2]||'PEN動作確認.sb3');
const {project}=await readSb3(buffer),plan=buildPlan(project,{assets:true});
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:120,drag:180,type:5,pause:80}}).open();
try{
  await c.load(buffer);
  const expected=JSON.parse(await c.page.evaluate(()=>studio.vm.toJSON()));
  const sourceBuffer=await c.save();await c.setAssetSource(sourceBuffer);
  await c.load(await blankProject(buffer,{assets:true}));
  for(const [i,a] of plan.actions.entries()){
    console.log(`${i+1}/${plan.actions.length} ${a.type} ${a.name||a.opcode||''}`);
    await c.execute(a);
    if(a.type==='costume.add'||a.type==='sound.add')await c.page.screenshot({path:`test-results/asset-step-${i+1}.png`});
  }
  const actual=JSON.parse(await c.page.evaluate(()=>studio.vm.toJSON())),result=compareProjects(expected,actual);
  await fs.writeFile('test-results/assets-verification.json',JSON.stringify(result,null,2));
  const saved=await c.save();await fs.writeFile('test-results/assets-rebuilt.sb3',saved);
  console.log(JSON.stringify(result));assert.equal(result.ok,true);
  const {zip:original}=await readSb3(sourceBuffer),{zip:rebuilt}=await readSb3(saved);
  for(const t of expected.targets)for(const a of [...t.costumes,...t.sounds])assert.deepEqual(await rebuilt.file(a.md5ext).async('nodebuffer'),await original.file(a.md5ext).async('nodebuffer'));
  assert.equal(await c.page.evaluate(()=>studio.assetImport),null);
}catch(error){
  await c.page.screenshot({path:'test-results/asset-failure.png'});
  console.log(await c.page.locator('body').innerText());throw error;
}finally{await c.close();}
