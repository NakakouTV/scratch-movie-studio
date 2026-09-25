import fs from 'node:fs/promises';
import {EditorController} from '../server/controller.mjs';
import {blankProject} from '../server/project.mjs';
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:40,drag:200,type:5,pause:40}}).open();
try{
 const b=await fs.readFile('PEN動作確認.sb3');await c.load(b);await c.load(await blankProject(b));await c.selectTarget('ペン');
 await c.execute({type:'block.add',opcode:'operator_join',sourceId:'join',place:{x:300,y:300}});
 console.log('join PASS');
}catch(e){
 console.log(e.message);
 console.log(JSON.stringify(await c.page.evaluate(()=>{
 const b=studio.flyBlock({opcode:'operator_join'}),w=b.workspace,r=studio.box(b.pathObject.svgPath),root=b.getSvgRoot();
 return {source:studio.dragSource(b.id,true),scale:w.scale,points:[8,14,24,32].flatMap(y=>[10,18,28,42,64,80,100,120,150].map(x=>{const p={x:r.x+x*w.scale,y:r.y+y*w.scale},hit=document.elementFromPoint(p.x,p.y);return {x,y,tag:hit?.tagName,cls:hit?.getAttribute('class'),id:hit?.closest('[data-id]')?.getAttribute('data-id'),own:hit?.closest('[data-id]')===root,editable:!!hit?.closest('.blocklyEditableText')};}))};
 }),null,2));
}finally{await c.close();}
