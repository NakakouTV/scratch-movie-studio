import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EditorController} from '../server/controller.mjs';
import {blankProject} from '../server/project.mjs';
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:60,drag:375,type:1,pause:50}}).open();
try{
 const b=await fs.readFile('PEN動作確認.sb3');await c.load(b);await c.load(await blankProject(b));await c.selectTarget('ペン');
 const mutation={proccode:'線 %s %s %s %s %s %s',argumentnames:'["x","y","z","x2","y2","z2"]',argumentids:'["a","b","c","d","e","f"]',argumentdefaults:'["","","","","",""]',warp:'true'};
 await c.execute({type:'procedure.create',sourceId:'def',prototypeId:'proto',mutation,x:780,y:1460});
 await c.execute({type:'block.add',sourceId:'call',opcode:'procedures_call',mutation,place:{after:'def'}});
 for(const input of ['a','b','c','d','e'])await c.execute({type:'block.input',block:'call',input,value:'座標変換のとても長い式を想定した入力'.repeat(3)});
 let parent='call',input='f';
 for(let i=0;i<4;i++){const id='math'+i;await c.execute({type:'block.add',sourceId:id,opcode:i%2?'operator_multiply':'operator_add',place:{parent,input}});parent=id;input='NUM1';}
 let segments=0;const drag=c.dragWithSnap;
 c.dragWithSnap=async function(spec,place,move){
  segments++;
  return drag.call(this,spec,place,async()=>{
   await move();
   const area=await this.page.evaluate(()=>studio.codeArea());
   assert.ok(await this.page.evaluate(()=>studio.workspace.scale>=0.8-1e-6),'automatic zoom must remain readable');
   assert.ok(this.position.x>=area.left&&this.position.x<=area.right,`drop x outside code area: ${this.position.x}`);
   assert.ok(this.position.y>=area.top&&this.position.y<=area.bottom,`drop y outside code area: ${this.position.y}`);
  });
 };
 await c.execute({type:'block.add',sourceId:'arg',opcode:'argument_reporter_string_number',fields:{VALUE:['x2',null]},place:{parent:'math3',input:'NUM1'}});
 assert.equal(segments,1,'distant argument must use one uninterrupted drag');
 segments=0;
 await c.execute({type:'block.move',block:'arg',place:{x:800,y:18000}});
 assert.equal(segments,1,'long downward travel must not release the mouse');
 const location=await c.page.evaluate(id=>{const p=studio.workspace.getBlockById(id).getRelativeToSurfaceXY();return {x:p.x,y:p.y};},c.resolve('arg'));
 assert.ok(Math.abs(location.x-800)<2&&Math.abs(location.y-18000)<2);
 await c.execute({type:'block.move',block:'arg',place:{parent:'math3',input:'NUM1'}});
 await c.verifyConnection(c.resolve('arg'),{parent:'math3',input:'NUM1'});
 assert.deepEqual(c.errors,[]);
 console.log('far argument, vertical travel and return connection PASS; continuous drags and all drops inside code area');
}catch(e){await c.page.screenshot({path:'test-results/far-argument.png'});throw e;}finally{await c.close();}
