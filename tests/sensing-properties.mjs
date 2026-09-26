import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {EditorController} from '../server/controller.mjs';
import {blankProject,readSb3,compareProjects,repairDependentFieldOrder} from '../server/project.mjs';
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:30,drag:150,type:1,pause:30}}).open();
await fs.mkdir('test-results/sensing-properties',{recursive:true});
try{
  if(process.argv[2]){
    // Reproduce a local saved job without changing its history or recordings.
    const directory=path.resolve(process.argv[2]),read=async f=>JSON.parse(await fs.readFile(path.join(directory,f),'utf8'));
    const saved=await read('checkpoint.json'),plan=await read('plan.json'),expected=await read('expected.json');
    await c.setAssetSource(await fs.readFile(path.join(directory,'assets.sb3')));
    await c.restoreCheckpoint(await fs.readFile(path.join(directory,saved.folder,'project.sb3')),await read(saved.folder+'/state.json'));
    const actions=repairDependentFieldOrder(plan.actions,saved.nextIndex);
    for(let i=saved.nextIndex;i<actions.length;i++){
      await c.execute(actions[i]);
      if(i<30||(i+1)%10===0)console.log(`${i+1}/${actions.length} ${actions[i].type} ${actions[i].field||actions[i].opcode||''}`);
    }
    const actual=JSON.parse(await c.page.evaluate(()=>studio.vm.toJSON())),result=compareProjects(expected,actual);
    await fs.writeFile('test-results/sensing-properties/verification.json',JSON.stringify(result,null,2));
    await fs.writeFile('test-results/sensing-properties/rebuilt.sb3',await c.save());
    assert.equal(result.ok,true,JSON.stringify(result));console.log('PASS: original saved job completed; reconstructed project matches');
  }else{
    const buffer=await blankProject(await fs.readFile('PEN動作確認.sb3')),{zip,project}=await readSb3(buffer);
    const other=structuredClone(project.targets[1]);other.name='他のスプライト';other.layerOrder=2;project.targets.push(other);
    zip.file('project.json',JSON.stringify(project));await c.load(await zip.generateAsync({type:'nodebuffer'}));await c.selectTarget('ペン');
    await c.execute({type:'block.add',sourceId:'of',opcode:'sensing_of',place:{x:300,y:200}});
    const info=()=>c.page.evaluate(id=>studio.fieldInfo(id,null,'PROPERTY'),c.resolve('of'));
    assert.ok(!(await info()).options.some(o=>o.value==='x position'));
    await c.execute({type:'block.field',block:'of',input:'OBJECT',field:'OBJECT',value:'他のスプライト'});
    for(const value of ['x position','y position','direction','costume #','costume name','size','volume']){
      const label=(await info()).options.find(o=>o.value===value)?.label;assert.ok(label,value);
      await c.execute({type:'block.field',block:'of',field:'PROPERTY',value});assert.equal((await info()).value,value);
      // Select a different value, then use the Japanese display label as input.
      await c.execute({type:'block.field',block:'of',field:'PROPERTY',value:value==='volume'?'size':'volume'});
      await c.execute({type:'block.field',block:'of',field:'PROPERTY',value:label});assert.equal((await info()).value,value);
      console.log(`${value} / ${label} PASS`);
    }
    await c.execute({type:'block.field',block:'of',input:'OBJECT',field:'OBJECT',value:'_stage_'});
    for(const value of ['backdrop #','backdrop name','volume']){
      await c.execute({type:'block.field',block:'of',field:'PROPERTY',value});assert.equal((await info()).value,value);
    }
    assert.ok(!(await info()).options.some(o=>o.value==='y position'));
    console.log('PASS: stage/sprite dependent properties and Japanese/internal value selection');
  }
  assert.deepEqual(c.errors,[]);
}catch(e){await c.page.screenshot({path:'test-results/sensing-properties/failure.png'});throw e;}finally{await c.close();}
