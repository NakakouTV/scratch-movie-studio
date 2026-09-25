import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {buildPlan,readSb3} from '../server/project.mjs';
import {normalizeScenes} from '../server/scenes.mjs';

test('auto scenes partition all actions, separate targets, definitions and nested scripts',async()=>{
  for(const file of (await fs.readdir('.')).filter(n=>n.endsWith('.sb3'))){
    const {project}=await readSb3(await fs.readFile(file));
    for(const assets of [true,false]){
      const plan=buildPlan(project,{assets}),scenes=normalizeScenes(plan);
      assert.deepEqual(scenes.flatMap(s=>Array.from({length:s.to-s.from+1},(_,i)=>s.from+i)),plan.actions.map((_,i)=>i+1));
      for(const s of plan.scenes){
        const actions=plan.actions.slice(s.from-1,s.to);
        assert.ok(actions.every(a=>a.type!=='target.select'||a.target===s.target));
        if(s.kind==='script')assert.ok(actions.every(a=>a.type!=='procedure.create'&&a.type!=='costume.add'));
        if(s.kind==='definition')assert.equal(actions[0].type,'procedure.create');
      }
    }
  }
});
test('custom scene ranges reject missing, overlapping, fractional and out of range actions',()=>{
  const plan={actions:[{}, {}, {}]};
  for(const scenes of [[],[{title:'a',from:2,to:3}],[{title:'a',from:1,to:4}],[{title:'a',from:1,to:1.5}],[{title:'a',from:1,to:2},{title:'b',from:2,to:3}],[{title:' ',from:1,to:3}]])assert.throws(()=>normalizeScenes(plan,scenes));
  const result=normalizeScenes(plan,[{id:'../../bad',title:'同名',from:1,to:1,enabled:false},{title:'同名',from:2,to:3}]);
  assert.equal(result[0].id,'scene-1');assert.equal(result[0].enabled,false);assert.equal(result[1].enabled,true);
  assert.equal(normalizeScenes(plan).length,1);assert.deepEqual(normalizeScenes({actions:[]}),[]);
});
