import {EMPTY_COSTUME} from './project.mjs';
export const PAINT_OPERATIONS=['costume.create','costume.duplicate','costume.rename','paint.shape','paint.style','paint.select','paint.view'];
const name=value=>{if(typeof value!=='string'||!value.trim()||value.length>100)throw new Error('コスチューム名は1〜100文字です。');return value.trim();};
const color=value=>{if(value!==null&&(typeof value!=='string'||!/^#[\da-f]{6}$/i.test(value)))throw new Error('色は#rrggbbまたはnull（透明）で指定してください。');};
function style(a){for(const key of ['fill','stroke'])if(a[key]!==undefined)color(a[key]);if(a.strokeWidth!==undefined&&(!Number.isFinite(a.strokeWidth)||a.strokeWidth<0||a.strokeWidth>100))throw new Error('枠線の幅は0〜100です。');if(a.stroke===null&&a.strokeWidth>0)throw new Error('透明な枠線には幅0を指定してください。');}
const hsv=hex=>{
 const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
 const h=!d?0:max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4;
 return [h/6*100,max?d/max*100:0,max*100];
};
async function ready(c,vector=true){await c.selectTab('costumes');await c.page.waitForFunction(()=>studio.paintCanvas&&!studio.paintCanvas.queuedImport&&!studio.paintCanvas.queuedImageToLoad&&studio.paintTool?._scope?.view);if(vector)return c.page.evaluate(()=>studio.paintInfo());}
async function snapshot(c){return c.page.evaluate(()=>{const t=studio.vm.editingTarget;return {index:t.currentCostume,asset:t.sprite.costumes[t.currentCostume].assetId};});}
async function saved(c,before){await c.page.waitForFunction(v=>{const t=studio.vm.editingTarget;return t.currentCostume===v.index&&t.sprite.costumes[v.index].assetId!==v.asset;},before);}
async function rename(c,value){
 const expected=name(value);
 if(await c.page.evaluate(n=>studio.vm.editingTarget.sprite.costumes.some((v,i)=>v.name===n&&i!==studio.vm.editingTarget.currentCostume),expected))throw new Error('同じコスチューム名が既にあります。');
 await c.click(c.page.locator('input[class*="fixed-tools_costume-input"]'));await c.type(expected);await c.page.keyboard.press('Enter');
 await c.page.waitForFunction(n=>{const t=studio.vm.editingTarget;return t.sprite.costumes[t.currentCostume].name===n;},expected);
}
async function popupClick(c,locator){
 // react-popover repositions its body while opening; scrolling that body can
 // unmount it. Measure again after moving the real pointer instead.
 await locator.waitFor({state:'visible'});
 for(let attempt=0;attempt<4;attempt++){
  const box=await locator.boundingBox();if(!box)continue;await c.move(box.x+box.width/2,box.y+box.height/2);
  const hit=await locator.evaluate(el=>el.contains(document.elementFromPoint(el.getBoundingClientRect().x+el.getBoundingClientRect().width/2,el.getBoundingClientRect().y+el.getBoundingClientRect().height/2)));
  const current=await locator.boundingBox();if(hit&&current&&Math.abs(current.x-box.x)<1&&Math.abs(current.y-box.y)<1){await c.page.mouse.click(c.position.x,c.position.y);await c.pause();return;}
  await c.pause(80);
 }
 throw new Error('ペイントの選択ボタンの位置が安定しませんでした。');
}
async function setStyle(c,a){
 style(a);
 for(const [kind,label] of [['fill','塗りつぶし'],['stroke','枠線']]){
  if(a[kind]===undefined)continue;
  await c.click(c.page.getByText(label,{exact:true}).locator('..').locator('[class*="color-button_color-button_"]'));await c.page.waitForFunction(()=>!!studio.paintColorIndicator);
  await c.page.locator('[class*="slider_container_"]:visible').nth(2).waitFor({state:'visible'});
  try{
   if(a[kind]===null)await popupClick(c,c.page.locator('[class*="color-picker_swatch_"]').first());
   else{
    if(await c.page.evaluate(()=>studio.paintColorIndicator.props.gradientType!=='SOLID'))await popupClick(c,c.page.locator('[class*="color-picker_gradient-picker-row"] img').first());
    const values=hsv(a[kind]);
    for(let i=0;i<3;i++){
     const bar=c.page.locator('[class*="slider_container_"]:visible').nth(i);await bar.locator('[class*="slider_handle_"]').waitFor({state:'visible'});
     const box=await bar.boundingBox(),handle=await bar.locator('[class*="slider_handle_"]').boundingBox();if(!box||!handle)throw new Error('色スライダーの表示を確認できませんでした。');
     await c.move(handle.x+handle.width/2,handle.y+handle.height/2);await c.page.mouse.down();
     try{await c.move(box.x+handle.width/2+(box.width-handle.width)*values[i]/100,box.y+box.height/2,Math.min(c.timing.drag,350));}finally{await c.page.mouse.up();}
    }
    // Retain exact RGB through the native callback after operating HSV sliders.
    await c.page.evaluate(value=>studio.paintColorIndicator.handleChangeColor(value),a[kind].toLowerCase());
   }
  }finally{await c.click(c.page.locator('input[class*="fixed-tools_costume-input"]'));await c.page.locator('[class*="slider_container_"]:visible').first().waitFor({state:'hidden'});}
 }
 if(a.strokeWidth!==undefined){await c.click(c.page.locator('input[class*="input-small-range"]'));await c.type(a.strokeWidth);await c.page.keyboard.press('Enter');await c.click(c.page.getByText('枠線',{exact:true}));}
 await c.page.waitForFunction(a=>{const s=studio.store.getState().scratchPaint.color;return (a.fill===undefined||s.fillColor.primary===a.fill)&&(a.stroke===undefined||s.strokeWidth===0||s.strokeColor.primary===a.stroke)&&(a.strokeWidth===undefined||s.strokeWidth===a.strokeWidth);},{...a,fill:typeof a.fill==='string'?a.fill.toLowerCase():a.fill,stroke:typeof a.stroke==='string'?a.stroke.toLowerCase():a.stroke});
}
export async function runPaintAction(c,a){
 if(a.type==='costume.rename'||a.type==='costume.duplicate'){
  if(a.name!==undefined)name(a.name);if(a.type==='costume.rename')name(a.name);
  if(a.type==='costume.duplicate'&&a.name!==undefined&&await c.page.evaluate(n=>studio.vm.editingTarget.sprite.costumes.some(v=>v.name===n),name(a.name)))throw new Error('同じコスチューム名が既にあります。');
  if(a.index!==undefined)await c.selectCostume(a.index);else await c.selectTab('costumes');
  if(a.type==='costume.duplicate'){
   const before=await c.page.evaluate(()=>({index:studio.vm.editingTarget.currentCostume,count:studio.vm.editingTarget.sprite.costumes.length}));
   const item=c.assetItems().nth(before.index);await item.evaluate(el=>el.scrollIntoView({block:'center'}));const box=await item.boundingBox();await c.move(box.x+box.width/2,box.y+box.height/2);await c.page.mouse.click(c.position.x,c.position.y,{button:'right'});
   await c.click(c.page.getByRole('menuitem',{name:'複製',exact:true}));await c.page.waitForFunction(n=>studio.vm.editingTarget.sprite.costumes.length===n,before.count+1);await ready(c,false);
  }
  if(a.name!==undefined)await rename(c,a.name);return c.page.evaluate(()=>({index:studio.vm.editingTarget.currentCostume,name:studio.vm.editingTarget.sprite.costumes[studio.vm.editingTarget.currentCostume].name}));
 }
 if(a.type==='costume.create'){
  if(a.name!==undefined){name(a.name);if(await c.page.evaluate(n=>studio.vm.editingTarget.sprite.costumes.some(v=>v.name===n),name(a.name)))throw new Error('同じコスチューム名が既にあります。');}await c.selectTab('costumes');
  const before=await c.page.evaluate(()=>({count:studio.vm.editingTarget.sprite.costumes.length,stage:studio.vm.editingTarget.isStage})),noun=before.stage?'背景':'コスチューム',panel=c.page.locator('[class*="asset-panel_wrapper"]:visible');
  const button=await panel.getByRole('button',{name:noun+'を選ぶ',exact:true}).first().boundingBox();await c.move(button.x+button.width/2,button.y+button.height/2);await c.pause(350);
  await c.click(panel.getByRole('button',{name:'描く',exact:true}));await c.page.waitForFunction(n=>studio.vm.editingTarget.sprite.costumes.length===n,before.count+1);await ready(c);
  const placeholder=await c.page.evaluate(empty=>{const t=studio.vm.editingTarget;return t.sprite.costumes.length===2&&t.sprite.costumes[0].name===empty.name&&t.sprite.costumes[0].assetId===empty.assetId;},EMPTY_COSTUME);
  if(placeholder){await c.selectCostume(0);await c.click(c.assetItems().nth(0).locator('[class*="sprite-selector-item_delete-button"]'));await c.page.waitForFunction(()=>studio.vm.editingTarget.sprite.costumes.length===1);await ready(c);}
  if(a.name!==undefined)await rename(c,a.name);return c.page.evaluate(()=>studio.paintInfo());
 }
 if(a.type==='paint.shape'){
  if(!['rectangle','ellipse'].includes(a.shape)||![a.x,a.y,a.width,a.height].every(Number.isFinite)||a.width<=0||a.height<=0||a.width>720||a.height>540)throw new Error('図形はrectangle / ellipse、座標は数値、幅・高さは正の数（最大720×540）です。');style(a);
 }
 if(a.type==='paint.style')style(a);
 if(a.type==='paint.select'&&(!Number.isInteger(a.index)||a.index<0))throw new Error('図形の番号は0以上の整数です。');
 if(a.type==='paint.view'&&(!Number.isInteger(a.scale)||a.scale<1||a.scale>8))throw new Error('ペイント倍率は1〜8の整数です（1が100%）。');
 await ready(c);
 if(a.type==='paint.view'){await c.click(c.page.locator('img[alt="Zoom Reset"]'));for(let i=1;i<a.scale;i++)await c.click(c.page.locator('img[alt="Zoom In"]'));return c.page.evaluate(()=>studio.paintInfo());}
 if(a.type==='paint.select'){
  await c.click(c.page.locator('img[alt="選択"][class*="tool-select"]'));
  const selected=await c.page.evaluate(i=>studio.paintPick(i),a.index);await c.move(selected.point.x,selected.point.y);await c.page.mouse.click(c.position.x,c.position.y);
  await c.page.waitForFunction(id=>studio.paintInfo().items.some(v=>v.id===id&&v.selected),selected.id);return c.page.evaluate(()=>studio.paintInfo());
 }
 if(a.type==='paint.style'){
  const before=await snapshot(c),old=await c.page.evaluate(()=>studio.paintInfo().items);await setStyle(c,a);
  const current=await c.page.evaluate(()=>studio.paintInfo());if(old.some(v=>v.selected)&&JSON.stringify(old)!==JSON.stringify(current.items))await saved(c,before);return current;
 }
 await c.click(c.page.locator('img[alt="'+(a.shape==='rectangle'?'四角形':'円')+'"]'));
 // Clear a previous bounding-box selection using a real empty-canvas click.
 const empty=await c.page.evaluate(()=>{const s=studio.paintInfo(),p=studio.paintTool._scope;for(const fx of [.1,.9,.3,.7])for(const fy of [.1,.9,.3,.7]){const q={x:s.canvas.x+s.canvas.width*fx,y:s.canvas.y+s.canvas.height*fy},r=p.view.viewToProject(new p.Point(q.x-s.canvas.x,q.y-s.canvas.y));if(!p.project.hitTest(r,{fill:true,stroke:true,guide:false,tolerance:2}))return q;}throw new Error('選択を解除する空き領域がありません。');});
 await c.move(empty.x,empty.y);await c.page.mouse.click(empty.x,empty.y);await setStyle(c,a);
 const points=await c.page.evaluate(a=>({start:studio.paintPoint(a.x,a.y),end:studio.paintPoint(a.x+a.width,a.y-a.height),info:studio.paintInfo()}),a);
 const padding=points.info.style.strokeWidth*points.info.scale/4;
 for(const point of [points.start,points.end]){const r=points.info.canvas;if(point.x<r.x+3+padding||point.x>r.x+r.width-3-padding||point.y<r.y+3+padding||point.y>Math.min(r.y+r.height-3,1080-c.subtitleMargin-12)-padding)throw new Error('図形の描画範囲が画面に収まりません。ペイント倍率を下げるか位置を調整してください。');}
 const before=await snapshot(c),ids=points.info.items.map(v=>v.id);await c.move(points.start.x,points.start.y);await c.page.mouse.down();
 try{await c.move(points.end.x,points.end.y,c.timing.drag);}finally{await c.page.mouse.up();}
 await c.page.waitForFunction(ids=>studio.paintInfo().items.some(v=>!ids.includes(v.id)),ids);
 const item=await c.page.evaluate(({ids,a})=>{const created=studio.paintInfo().items.filter(v=>!ids.includes(v.id));if(created.length!==1)throw new Error('作成した図形を一意に確認できません。');return studio.paintFinishShape(created[0].id,a);},{ids,a});
 await saved(c,before);return item;
}
