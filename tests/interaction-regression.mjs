import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {EditorController} from '../server/controller.mjs';
import {blankProject,readSb3,buildPlan} from '../server/project.mjs';
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:100,drag:240,type:5,pause:80}}).open();
try{
  const buffer=await fs.readFile('PEN動作確認.sb3');await c.load(buffer);await c.load(await blankProject(buffer));await c.selectTarget('ペン');
  await c.execute({type:'block.add',sourceId:'say',opcode:'looks_say',place:{x:200,y:200}});
  for(const area of ['palette','zoom','bottom','below']){
    await c.page.evaluate(({id,area})=>{
      const w=studio.workspace,b=w.getBlockById(id),r=studio.box(b.pathObject.svgPath),z=studio.box(w.getParentSvg().querySelector('.blocklyZoom'));
      const p=area==='palette'?{x:150,y:180}:area==='zoom'?{x:z.x,y:z.y}:{x:700,y:innerHeight+(area==='below'?600:-8)};
      b.moveBy((p.x-r.x)/w.scale,(p.y-r.y)/w.scale);
    },{id:c.resolve('say'),area});
    await c.pause(200);
    await c.page.evaluate(async({id,area})=>{
      const w=studio.workspace,r=studio.box(w.getBlockById(id).pathObject.svgPath),z=studio.box(w.getParentSvg().querySelector('.blocklyZoom'));
      const p=area==='palette'?{x:150,y:180}:area==='zoom'?{x:z.x,y:z.y}:{x:700,y:innerHeight+(area==='below'?600:-8)};await studio.pan(p.x-r.x,p.y-r.y,50);
    },{id:c.resolve('say'),area});
    await c.execute({type:'block.move',block:'say',place:{x:250,y:240}});
    assert.ok(await c.page.evaluate(id=>studio.dragSource(id).grab,c.resolve('say')));
    console.log('obstructed source PASS',area);
  }
  await c.execute({type:'block.add',sourceId:'low',opcode:'motion_movesteps',place:{x:400,y:2200}});
  await c.execute({type:'block.input',block:'low',input:'STEPS',value:'321'});
  await c.execute({type:'block.move',block:'low',place:{x:400,y:4500}});
  assert.ok(await c.page.evaluate(id=>studio.dragSource(id).grab,c.resolve('low')));
  // Stretch a C block below the viewport and add to its bottom connection.
  await c.execute({type:'block.add',sourceId:'tall',opcode:'control_repeat',place:{x:300,y:200}});
  await c.page.evaluate(id=>{
    const w=studio.workspace,parent=w.getBlockById(id);let connection=parent.getInput('SUBSTACK').connection;
    for(let i=0;i<40;i++){const b=w.newBlock('motion_movesteps');b.initSvg();b.render();connection.connect(b.previousConnection);connection=b.nextConnection;}
    w.setScale(1);
  },c.resolve('tall'));
  await c.ensureVisible(c.resolve('tall'));
  assert.ok(await c.page.evaluate(id=>studio.connectionPoint(studio.workspace.getBlockById(id).nextConnection).y>innerHeight,c.resolve('tall')));
  await c.execute({type:'block.add',sourceId:'after-tall',opcode:'looks_say',place:{after:'tall'}});
  await c.verifyConnection(c.resolve('after-tall'),{after:'tall'});
  assert.ok(await c.page.evaluate(id=>studio.dragSource(id).grab,c.resolve('after-tall')));
  console.log('bottom destination, offscreen input and tall stack connection PASS');
  // Force a palette scroll after the mouse has approached, before mouse-down.
  const move=c.move;let shifted=false;
  c.move=async function(...args){await move.apply(this,args);if(!shifted&&args[0]>65&&args[0]<300){shifted=true;await this.page.evaluate(()=>{const f=studio.workspace.getFlyout();f.scrollTo(1000);});await this.pause(600);}};
  await c.execute({type:'block.add',sourceId:'move',opcode:'motion_movesteps',place:{after:'say'}});c.move=move;
  assert.equal(shifted,true);console.log('palette scroll during approach PASS');
  // A long native dropdown: the requested entry initially lies below its scroll viewport.
  await c.page.evaluate(()=>{for(let i=0;i<80;i++)studio.workspace.createVariable(`項目${String(i).padStart(2,'0')}`,'',`test-var-${i}`);});
  await c.execute({type:'block.add',sourceId:'set',opcode:'data_setvariableto',place:{x:500,y:300}});
  await c.execute({type:'block.field',block:'set',field:'VARIABLE',value:'項目79'});
  assert.equal(await c.page.evaluate(id=>studio.workspace.getBlockById(id).getField('VARIABLE').getText(),c.resolve('set')),'項目79');
  console.log('long dropdown PASS');
  await c.execute({type:'block.add',sourceId:'receive',opcode:'event_whenbroadcastreceived',place:{x:400,y:400}});
  await c.execute({type:'block.field',block:'receive',field:'BROADCAST_OPTION',value:'実際のブロックで作成',referenceId:'source-message'});
  const message=c.variableRefs.get('source-message');assert.ok(message);
  await c.selectTarget('Stage',true);
  await c.execute({type:'block.add',sourceId:'send',opcode:'event_broadcast',place:{x:100,y:100}});
  await c.execute({type:'block.field',block:'send',input:'BROADCAST_INPUT',field:'BROADCAST_OPTION',value:'実際のブロックで作成',referenceId:'source-message'});
  assert.equal(await c.page.evaluate(id=>studio.field(id,'BROADCAST_INPUT','BROADCAST_OPTION').getValue(),c.resolve('send')),message);
  const saved=await c.save(),{project}=await readSb3(saved);
  assert.ok(!buildPlan(project).actions.some(a=>a.type==='broadcast.create'));
  assert.equal(project.targets.flatMap(t=>Object.values(t.blocks)).filter(b=>b.opcode==='event_broadcast').length,1);
  assert.ok(Object.values(project.targets[0].broadcasts).includes('実際のブロックで作成'));
  console.log('broadcast from real receive/send blocks across targets PASS');
  // Reproduce the definition placements from the two supplied failing job logs.
  const layouts=JSON.parse(await fs.readFile('tests/fixtures/definition-layouts.json','utf8'));
  for(const [i,actions] of layouts.entries()){
    await c.load(await blankProject(buffer));await c.selectTarget('ペン');
    for(const action of actions)await c.execute(action);
    console.log('real definition layout PASS',i+1);
  }
}catch(e){await c.page.screenshot({path:'test-results/interaction-failure.png'});throw e;}finally{await c.close();}
