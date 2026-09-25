import {EditorController} from '../server/controller.mjs';
import fs from 'node:fs/promises';
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:100,drag:500,type:10,pause:100}}).open();
try {
const file=(await fs.readdir('.')).find(n=>n.startsWith('Fast ')&&n.endsWith('.sb3'));await c.load(await fs.readFile(file));
await c.page.evaluate(()=>{const w=studio.workspace,b=w.getBlockById('=');for(const input of ['SUBSTACK','SUBSTACK2','CONDITION'])b.getInputTargetBlock(input)?.dispose(false);b.getNextBlock()?.dispose(false);w.scroll(w.scrollX,w.scrollY+250);});
await c.pause(500);
await c.execute({type:'block.add',sourceId:'test',opcode:'motion_pointindirection',place:{parent:'=',input:'SUBSTACK'}});
console.log('C-block socket regression PASS');
}catch(e){console.error(e);await c.page.screenshot({path:'test-results/socket-failure.png'});process.exitCode=1;}finally{await c.close();}
