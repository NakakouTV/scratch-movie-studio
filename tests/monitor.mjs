import {EditorController} from '../server/controller.mjs';
import {blankProject,readSb3,buildPlan} from '../server/project.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:30,drag:100,type:5,pause:60}}).open();
try{const file=(await fs.readdir('.')).find(n=>n.startsWith('Fast ')&&n.endsWith('.sb3')),buffer=await fs.readFile(file);const plan=buildPlan((await readSb3(buffer)).project);await c.load(await blankProject(buffer));await c.execute(plan.actions[0]);await c.execute(plan.actions[1]);await c.pause(700);const monitors=await c.page.evaluate(()=>studio.vm.runtime._monitorState.toJS());const m=Object.values(monitors)[0];assert.equal(m.mode,'slider');assert.equal(m.sliderMin,-100);assert.equal(m.y,4);console.log('Monitor restoration PASS');}finally{await c.close();}
