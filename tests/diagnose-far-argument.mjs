import fs from 'node:fs/promises';
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
 const original=c.dragWithSnap;
 c.dragWithSnap=async function(spec,place,move){
  await original.call(this,spec,place,async()=>{await move();console.log('before drop',JSON.stringify(await this.page.evaluate(({spec,id})=>({scale:studio.workspace.scale,source:studio.dragSource(spec.sourceId),target:studio.connectionPoint(studio.workspace.getBlockById(id).getInput('NUM1').connection),drag:studio.workspace.isDragging()}),{spec,id:c.resolve('math3')})));});
  console.log('after drop',JSON.stringify(await this.page.evaluate(({id})=>({target:studio.workspace.getBlockById(id).getInputTargetBlock('NUM1')?.id}),{id:c.resolve('math3')})));
 };
 await c.execute({type:'block.add',sourceId:'arg',opcode:'argument_reporter_string_number',fields:{VALUE:['x2',null]},place:{parent:'math3',input:'NUM1'}});
 console.log('far argument PASS');
}catch(e){console.log(e.stack);await c.page.screenshot({path:'test-results/far-argument.png'});}finally{await c.close();}
