import {EditorController} from '../server/controller.mjs';
import {readSb3,blankProject,buildPlan,compareProjects} from '../server/project.mjs';
import fs from 'node:fs/promises';
await fs.mkdir('test-results',{recursive:true});
const sample=process.argv[2]||(await fs.readdir('.')).find(n=>n.startsWith('Fast Rectangle Filler2 ')&&n.endsWith('.sb3'));
const buffer=await fs.readFile(sample);
const {project}=await readSb3(buffer);
const plan=buildPlan(project);
await fs.writeFile('test-results/plan.json',JSON.stringify(plan,null,2));
const controller=await new EditorController('http://127.0.0.1:8601',{timing:{move:10,drag:140,type:2,pause:30}}).open();
try {
  await controller.load(buffer);
  const normalized=JSON.parse(await controller.page.evaluate(()=>studio.vm.toJSON()));
  await controller.load(await blankProject(buffer));
  for(let i=0;i<plan.actions.length;i++) {
    const action=plan.actions[i];
    console.log(`${i+1}/${plan.actions.length} ${action.type} ${action.opcode||action.name||action.target||action.field||action.input||''}`);
    await controller.execute(action);
    if(action.type==='variable.create'||action.type==='procedure.create') await controller.page.screenshot({path:`test-results/step-${i+1}.png`});
  }
  const out=await controller.save();await fs.writeFile('test-results/rebuilt.sb3',out);
  const actual=JSON.parse(await controller.page.evaluate(()=>studio.vm.toJSON()));
  const result=compareProjects(normalized,actual);
  await fs.writeFile('test-results/verification.json',JSON.stringify(result,null,2));
  console.log('VERIFICATION',JSON.stringify(result));
  await controller.page.screenshot({path:'test-results/completed.png'});
  if(!result.ok) process.exitCode=1;
} catch(e) {
  console.error(e.stack);
  console.log('DEBUG',JSON.stringify(await controller.page.evaluate(()=>({body:document.body.innerText.slice(-1800),procedure:studio.procedureDialog?.mutationRoot?.mutationToDom()?.outerHTML,blocks:studio.state().blocks.slice(0,8)})),null,2));
  await controller.page.screenshot({path:'test-results/failure.png'});process.exitCode=1;
} finally {await controller.close();}
