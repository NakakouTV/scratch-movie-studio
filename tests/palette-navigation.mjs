import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EditorController} from '../server/controller.mjs';
import {blankProject,readSb3,buildPlan,compareProjects} from '../server/project.mjs';
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:40,drag:180,type:1,pause:35}}).open();
try{
  const buffer=await fs.readFile('PEN動作確認.sb3');await c.load(buffer);await c.load(await blankProject(buffer));await c.selectTarget('ペン');
  await c.page.evaluate(()=>{
    window.categoryClicks=[];
    for(const item of studio.workspace.getToolbox().getToolboxItems())item.getDiv().addEventListener('pointerdown',()=>categoryClicks.push(item.toolboxItemDef_?.toolboxitemid));
  });
  const clicks=()=>c.page.evaluate(()=>categoryClicks.splice(0));
  const scroll=()=>c.page.evaluate(()=>studio.workspace.getFlyout().getWorkspace().scrollY);
  const y=await scroll();
  for(let i=0;i<3;i++)await c.execute({type:'block.add',sourceId:`move${i}`,opcode:'motion_movesteps',place:{x:200,y:100+i*70}});
  assert.deepEqual(await clicks(),[]);assert.ok(Math.abs(await scroll()-y)<1,'visible blocks must not reset palette scroll');
  console.log('visible and repeated block: zero category clicks, no palette scroll');
  await c.page.evaluate(()=>{
    const f=studio.workspace.getFlyout(),w=f.getWorkspace(),b=studio.flyBlock({opcode:'looks_say'}),v=studio.box(w.getParentSvg());
    f.scrollTo(Math.max(0,b.getRelativeToSurfaceXY().y-(v.height+180)/w.scale));
  });
  await c.page.waitForFunction(()=>studio.workspace.getFlyout().scrollTarget===undefined);
  const near=await c.page.evaluate(()=>studio.palettePosition(studio.flyBlock({opcode:'looks_say'}).id));
  assert.equal(near.visible,false);assert.equal(near.near,true);assert.notEqual(near.category,'looks');
  await c.execute({type:'block.add',sourceId:'say',opcode:'looks_say',place:{x:400,y:300}});
  assert.deepEqual(await clicks(),[]);console.log('nearby block in another category: scroll only');
  await c.category('motion');await clicks();
  const far=await c.page.evaluate(()=>studio.palettePosition(studio.flyBlock({opcode:'pen_penDown'}).id));assert.equal(far.near,false);
  await c.execute({type:'block.add',sourceId:'pen',opcode:'pen_penDown',place:{x:500,y:200}});
  assert.deepEqual(await clicks(),['pen']);
  await c.execute({type:'block.add',sourceId:'pen2',opcode:'pen_penDown',place:{after:'pen'}});assert.deepEqual(await clicks(),[]);
  console.log('far category: one click; repeated block: zero clicks');
  // Rebuild a small expression whose old hidden literal is deliberately large.
  const {zip,project}=await readSb3(await blankProject(buffer));
  project.targets[1].blocks={
    move:{opcode:'motion_movesteps',topLevel:true,x:200,y:200,inputs:{STEPS:[3,'add',[4,'987654321']]},fields:{}},
    add:{opcode:'operator_add',parent:'move',inputs:{NUM1:[1,[4,'3']],NUM2:[1,[4,'4']]},fields:{}}
  };
  zip.file('project.json',JSON.stringify(project));const original=await zip.generateAsync({type:'nodebuffer'});
  await c.load(original);const expected=JSON.parse(await c.page.evaluate(()=>studio.vm.toJSON()));
  await c.load(await blankProject(original));const actions=buildPlan(project).actions;
  for(const a of actions)await c.execute(a);
  const actual=JSON.parse(await c.page.evaluate(()=>studio.vm.toJSON()));assert.equal(compareProjects(expected,actual).ok,true);
  const b=actual.targets[1].blocks[c.resolve('move')];assert.equal(b.inputs.STEPS[2][1],'10');
  assert.ok(!actions.some(a=>a.type==='block.input'&&a.block==='move'));
  assert.deepEqual(c.errors,[]);console.log('hidden literal stays at native default 10, active 3 + 4 and completed program match');
}catch(e){await c.page.screenshot({path:'test-results/palette-navigation-failure.png'});throw e;}finally{await c.close();}
