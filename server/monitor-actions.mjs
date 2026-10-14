import {dataReference} from './board-actions.mjs';
export const MONITOR_OPERATIONS=['monitor.show','monitor.hide','monitor.layout','monitor.scroll'];
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
export function monitorSpecification(a){
 const ref=dataReference(a),kind=a.kind??'variable';
 if(!['variable','list'].includes(kind))throw new Error('モニターのkindはvariable / listです。');
 if(a.type==='monitor.layout'){
  if(a.mode!==undefined&&!['default','large','slider'].includes(a.mode))throw new Error('変数の表示形式はdefault / large / sliderです。');
  if(kind==='list'&&a.mode!==undefined)throw new Error('リストにはmodeを指定できません。');
  if(kind==='variable'&&(a.width!==undefined||a.height!==undefined))throw new Error('幅・高さの変更はリストのみです。変数はmodeで表示形式を変えてください。');
  for(const [key,max] of [['x',480],['y',360]])if(a[key]!==undefined&&!integer(a[key],0,max))throw new Error('モニターの位置はステージ左上基準の整数です（x:0〜480、y:0〜360）。');
  if((a.width!==undefined&&!integer(a.width,100,478))||(a.height!==undefined&&!integer(a.height,60,358)))throw new Error('リストの幅は100〜478、高さは60〜358です。');
 }
 if(a.type==='monitor.scroll'){
  if(kind!=='list'||!integer(a.index,1,200000))throw new Error('リストのモニターと1始まりの項目番号を指定してください。');
  if(a.align!==undefined&&!['start','center','end'].includes(a.align))throw new Error('スクロールのalignはstart / center / endです。');
  if(a.duration!==undefined&&!integer(a.duration,0,5000))throw new Error('スクロール時間は0〜5000msです。');
 }
 return {...ref,kind};
}
export async function runMonitorAction(c,a){
 const ref=monitorSpecification(a);if(ref.id)ref.id=c.variableRefs.get(ref.id)||ref.id;
 const resolved=await c.page.evaluate(ref=>{const {variable:v,target}=studio.runtimeData(ref,ref.kind);return {id:v.id,target:target.getName(),isStage:target.isStage,length:ref.kind==='list'?v.value.length:null};},ref),id=resolved.id;
 const info=()=>c.page.evaluate(id=>studio.monitorInfo(id),id);
 if(a.type==='monitor.scroll'){
  if(a.index>resolved.length)throw new Error('リストの番号が範囲外です（1始まり）。');
  let m=await info();if(!m?.visible||!m.scroll)throw new Error('リストが表示されていません。monitor.showを先に実行してください。');
  const point=await c.page.evaluate(id=>studio.monitorPoint(id,'scroll'),id);await c.move(point.x,point.y);
  const height=m.scroll.height,align=a.align??'center',offset=align==='start'?0:align==='end'?height-24:(height-24)/2;
  const target=Math.max(0,Math.min(m.scroll.total-height,(a.index-1)*24-offset)),duration=a.duration??600,steps=Math.max(1,Math.ceil(duration/50)),start=m.scroll.top;
  for(let i=1;i<=steps;i++){
   if(c.options.shouldCancel?.())throw new Error('撮影を中止しました。');
   await c.page.evaluate(id=>studio.monitorPoint(id,'scroll'),id);
   m=await info();if(a.index>m.value.length)throw new Error('スクロール中にリストの項目が削除されました。');
   await c.page.mouse.wheel(0,start+(target-start)*i/steps-m.scroll.top);await c.pause(Math.max(50,duration/steps));
  }
  // Chrome applies wheel input asynchronously. Correct any delayed last step.
  for(let n=0;n<8;n++){m=await info();if(Math.abs(m.scroll.top-target)<=1)break;await c.page.mouse.wheel(0,target-m.scroll.top);await c.pause(80);}
  m=await info();const top=(a.index-1)*24-m.scroll.top;
  if(top<-.5||top+24>m.scroll.height+.5)throw new Error('指定項目をリストの表示範囲内へスクロールできませんでした。');
  return m;
 }
 const full=await c.page.evaluate(()=>studio.store.getState().scratchGui.mode.isFullScreen);
 // Scratch disables monitor dragging and resizing in player mode.
 if(full)await c.execute({type:'stage.view',mode:'editor'});
 try{
  if(a.type==='monitor.show'||a.type==='monitor.hide'){
   const visible=a.type==='monitor.show',m=await info();if(!!m?.visible===visible)return m??{id,visible:false};
   if(!resolved.isStage)await c.selectTarget(resolved.target);
   await c.selectTab('code');
   await c.page.waitForFunction(()=>studio.workspace.getFlyout().scrollTarget===undefined);
   const spec={opcode:ref.kind==='list'?'data_listcontents':'data_variable',variableId:id};
   if(!await c.page.evaluate(s=>!!studio.flyBlock(s),spec))await c.category('variables');
   await c.page.evaluate(spec=>{const b=studio.flyBlock(spec);if(!b)throw new Error('モニターのチェックボックスがありません。');studio.revealPalette(b.id);},spec);
   await c.page.waitForFunction(()=>studio.workspace.getFlyout().scrollTarget===undefined);
   const checkbox=()=>c.page.evaluate(spec=>{
    const el=studio.flyBlock(spec)?.getIcon('checkbox')?.getBubble()?.getSvgRoot();
    if(!el)throw new Error('モニターのチェックボックスがありません。');
    const b=studio.box(el.querySelector('.blocklyFlyoutCheckbox')),p={x:b.x+b.width/2,y:b.y+b.height/2};
    if(!el.contains(document.elementFromPoint(p.x,p.y)))throw new Error('モニターのチェックボックスが隠れています。');return p;
   },spec);
   let p=await checkbox();await c.move(p.x,p.y);p=await checkbox();await c.page.mouse.click(p.x,p.y);
   await c.page.waitForFunction(({id,visible})=>!!studio.vm.runtime._monitorState.get(id)?.get('visible')===visible,{id,visible});
   if(visible)await c.page.waitForFunction(id=>!!studio.monitorInfo(id)?.box,id);
   return await info();
  }
  let m=await info();if(!m?.visible||!m.box)throw new Error('モニターが表示されていません。monitor.showを先に実行してください。');
  if(a.mode&&a.mode!==m.mode){
   const p=await c.page.evaluate(id=>studio.monitorPoint(id),id);await c.move(p.x,p.y);await c.page.mouse.click(p.x,p.y,{button:'right'});
   const label={default:'普通の表示',large:'大きな表示',slider:'スライダー'}[a.mode];
   try{await c.click(c.page.getByRole('menuitem',{name:label,exact:true}));}finally{await c.page.keyboard.press('Escape');}
   await c.page.waitForFunction(({id,mode})=>studio.monitorInfo(id)?.mode===mode,{id,mode:a.mode});m=await info();
  }
  const width=a.width??m.width??m.displayWidth,height=a.height??m.height??m.displayHeight;
  const outerWidth=ref.kind==='list'?width+2:m.displayWidth,outerHeight=ref.kind==='list'?height+2:m.displayHeight;
  const x=a.x??m.x,y=a.y??m.y;
  if(x+outerWidth>480||y+outerHeight>360)throw new Error('モニター全体がステージに収まる位置・サイズを指定してください。');
  const drag=async(part,dx,dy)=>{
   const p=await c.page.evaluate(({id,part})=>studio.monitorPoint(id,part),{id,part});await c.move(p.x,p.y);
   await c.page.mouse.down();try{await c.move(p.x+dx,p.y+dy,c.timing.drag);}finally{await c.page.mouse.up();}await c.pause(80);
  };
  // First shrink, then position, then grow; the handle remains on the stage.
  if(ref.kind==='list'&&(a.width!==undefined||a.height!==undefined)){
   await drag('resize',Math.min(width,m.width)-m.width,Math.min(height,m.height)-m.height);m=await info();
  }
  if(Math.abs(x-m.x)>.5||Math.abs(y-m.y)>.5){await drag('drag',x-m.x,y-m.y);m=await info();}
  if(ref.kind==='list'&&(a.width!==undefined||a.height!==undefined)){
   if(width!==m.width||height!==m.height){await drag('resize',width-m.width,height-m.height);m=await info();}
  }
  if(Math.abs(m.x-x)>1||Math.abs(m.y-y)>1||(a.width!==undefined&&m.width!==width)||(a.height!==undefined&&m.height!==height))throw new Error('モニターの配置結果が指定と一致しません。');
  return m;
 }finally{if(full)await c.execute({type:'stage.view',mode:'fullscreen'});}
}
