import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EditorController} from '../server/controller.mjs';
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:80,drag:150,type:1,pause:50}}).open();
try{
 await c.load(await fs.readFile('test-results/full-projects/snowman/partial.sb3'));await c.selectTarget('材料');await c.selectTab('costumes');
 const panel=c.page.locator('[class*="asset-panel_wrapper"]:visible');
 const main=panel.getByRole('button',{name:'コスチュームを選ぶ',exact:true}).first(),r=await main.boundingBox();
 await c.move(r.x+r.width/2,r.y+r.height/2);await c.pause(400);
 await panel.getByRole('button',{name:/^コスチュームをアップロード/}).waitFor({state:'visible'});
 await c.selectCostume(8);assert.equal(await c.page.evaluate(()=>studio.vm.editingTarget.currentCostume),8);
 const count=await c.page.evaluate(()=>studio.vm.editingTarget.sprite.costumes.length);
 await c.selectCostume(count-1);await c.selectCostume(0);
 assert.equal(await c.page.evaluate(()=>studio.vm.editingTarget.currentCostume),0);
 console.log('snowman costume popup obstruction, last and first thumbnails PASS');
}catch(e){await c.page.screenshot({path:'test-results/costume-obstruction-failure.png'});throw e;}finally{await c.close();}
