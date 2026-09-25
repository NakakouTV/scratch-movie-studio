import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EditorController} from '../server/controller.mjs';
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:40,drag:150,type:5,pause:40}}).open();
try{
 await c.load(await fs.readFile('PEN動作確認.sb3'));await c.selectTarget('ペン');
 await c.execute({type:'block.add',sourceId:'colour-tab-test',opcode:'pen_setPenColorToColor',place:{x:500,y:300}});
 for(const tab of ['costumes','sounds']){
  await c.execute({type:'tab.select',tab});
  await c.execute({type:'block.input',block:'colour-tab-test',input:'COLOR',value:tab==='costumes'?'#2bff00':'#78da44'});
  assert.equal(await c.page.getByRole('tab').nth(0).getAttribute('aria-selected'),'true');
 }
 console.log('colour input after costume and sound tab switches PASS');
}finally{await c.close();}
