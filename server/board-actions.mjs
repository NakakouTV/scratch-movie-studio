export const BOARD_OPERATIONS=['board.configure','board.click','list.set','list.replace','list.get','runtime.wait'];
const scalar=v=>typeof v==='string'||(typeof v==='number'&&Number.isFinite(v));
const comparable=v=>scalar(v)||typeof v==='boolean';
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
export function boardConfiguration(a={}){
 const rows=a.rows??8,columns=a.columns??8,cellWidth=a.cellWidth??24,cellHeight=a.cellHeight??24;
 if(!integer(rows,1,100)||!integer(columns,1,100)||![cellWidth,cellHeight].every(v=>Number.isFinite(v)&&v>0&&v<=480))throw new Error('盤面の行・列数は1〜100、マスの幅・高さは0より大きく480以下です。');
 const left=a.left??-columns*cellWidth/2,bottom=a.bottom??-rows*cellHeight/2;
 if(![left,bottom].every(Number.isFinite)||(a.target!==undefined&&(typeof a.target!=='string'||!a.target)))throw new Error('盤面の位置と対象名が不正です。');
 return {rows,columns,cellWidth,cellHeight,left,bottom,...(a.target===undefined?{}:{target:a.target})};
}
export function dataReference(a){
 if(a.scope!==undefined&&!['global','local'].includes(a.scope))throw new Error('データの範囲はglobal / localです。');
 if(a.target!==undefined&&(typeof a.target!=='string'||!a.target))throw new Error('対象名が不正です。');
 if(a.id!==undefined&&(typeof a.id!=='string'||!a.id))throw new Error('データのIDが不正です。');
 if(a.id===undefined&&(typeof a.name!=='string'||!a.name))throw new Error('データのnameまたはidを指定してください。');
 return {scope:a.scope??'local',target:a.target,id:a.id,name:a.name};
}
export function waitSpecification(a){
 const timeoutMs=a.timeoutMs??10000,stableMs=a.stableMs??Math.min(100,timeoutMs),mode=a.mode??'all';
 if(!integer(timeoutMs,0,60000)||!integer(stableMs,0,5000)||stableMs>timeoutMs||!['all','any'].includes(mode))throw new Error('待機時間は0〜60000ms、安定時間は0〜5000ms（待機時間以下）、modeはall / anyです。');
 if(!Array.isArray(a.conditions)||!a.conditions.length||a.conditions.length>100)throw new Error('待機条件は1〜100件です。');
 const conditions=a.conditions.map(s=>{
  if(!s||typeof s!=='object'||!['variable','list','running','cloneCount'].includes(s.type))throw new Error('待機条件はvariable / list / running / cloneCountです。');
  const op=s.op??'equals';if(!['equals','notEquals','contains','gt','gte','lt','lte'].includes(op))throw new Error('比較方法が不正です。');
  if(s.type==='running'){if(typeof s.value!=='boolean'||!['equals','notEquals'].includes(op))throw new Error('running条件はtrue / falseで比較してください。');return {type:s.type,value:s.value,op};}
  if(s.type==='cloneCount'){if(typeof s.target!=='string'||!s.target||!integer(s.value,0,300)||op==='contains')throw new Error('cloneCount条件の対象名・個数が不正です。');return {type:s.type,target:s.target,value:s.value,op};}
  const ref=dataReference(s);if(s.index!==undefined&&!integer(s.index,1,200000))throw new Error('リストの番号は1以上の整数です。');
  if(s.property!==undefined&&(s.type!=='list'||s.property!=='length'))throw new Error('リストのpropertyにはlengthを指定できます。');
  if(s.type==='variable'&&(s.index!==undefined||s.property!==undefined))throw new Error('変数条件にはindexやpropertyを指定できません。');
  if(s.index!==undefined&&s.property!==undefined)throw new Error('indexとpropertyは同時に指定できません。');
  const wholeList=s.type==='list'&&s.index===undefined&&s.property===undefined;
  if(wholeList){if(!Array.isArray(s.value)||s.value.length>10000||!s.value.every(comparable)||!['equals','notEquals'].includes(op))throw new Error('リスト全体の比較には値の配列とequals / notEqualsを指定してください。');}
  else if(!comparable(s.value))throw new Error('比較する値は文字列・有限の数値・true/falseです。');
  if(['gt','gte','lt','lte'].includes(op)&&!Number.isFinite(Number(s.value)))throw new Error('大小比較には数値を指定してください。');
  return {type:s.type,...ref,index:s.index,property:s.property,value:s.value,op};
 });
 return {timeoutMs,stableMs,mode,conditions};
}
const resolve=(c,s)=>({...s,id:s.id?(c.variableRefs.get(s.id)||s.id):undefined});
export async function runBoardAction(c,a){
 if(a.type==='board.configure'){c.board=boardConfiguration(a);return {...c.board};}
 if(a.type==='board.click'){
  const holdMs=a.holdMs??80;if(!integer(holdMs,0,1000))throw new Error('クリックの押下時間は0〜1000msです。');
  const board=boardConfiguration(c.board);if(!integer(a.row,1,board.rows)||!integer(a.column,1,board.columns))throw new Error('指定した行・列が盤面の範囲外です（1始まり）。');
  const x=board.left+(a.column-.5)*board.cellWidth,y=board.bottom+(a.row-.5)*board.cellHeight;
  const locate=()=>c.page.evaluate(({x,y,target})=>{
   const r=studio.vm.renderer,rect=r.canvas.getBoundingClientRect(),[width,height]=r.getNativeSize();
   if(!rect.width||!rect.height||x<=-width/2||x>=width/2||y<=-height/2||y>=height/2)throw new Error('マスの中心がステージの外です。');
   const point={x:rect.left+(x+width/2)*rect.width/width,y:rect.top+(height/2-y)*rect.height/height};
   if(document.elementFromPoint(point.x,point.y)!==r.canvas)throw new Error('マスがモニターや他の画面表示に隠れています。');
   const drawable=r.pick(point.x-rect.left,point.y-rect.top),picked=studio.vm.runtime.targets.find(t=>t.drawableID===drawable);
   if(target&&(!picked||picked.isStage||picked.getName()!==target))throw new Error('指定したスプライトのマスをクリックできません。重なり・クローンの表示を確認してください。');
   return {point,picked:picked&&!picked.isStage?{id:picked.id,name:picked.getName(),isClone:!picked.isOriginal}:null};
  },{x,y,target:board.target});
  let location=await locate();await c.move(location.point.x,location.point.y);location=await locate();await c.move(location.point.x,location.point.y,0);
  await c.page.mouse.click(location.point.x,location.point.y,{delay:holdMs});return {row:a.row,column:a.column,x,y,picked:location.picked};
 }
 if(a.type.startsWith('list.')){
  const ref=resolve(c,dataReference(a));if(a.index!==undefined&&!integer(a.index,1,200000))throw new Error('リストの番号は1以上の整数です。');
  if(a.type==='list.set'&&a.index!==undefined)throw new Error('list.setは全体設定です。要素の変更にはlist.replaceを使ってください。');
  if(a.type==='list.set'&&(!Array.isArray(a.values)||a.values.length>10000||!a.values.every(scalar)))throw new Error('リストの値は文字列・有限の数値の配列です（最大10000項目）。');
  if(a.type==='list.replace'&&(!scalar(a.value)||a.index===undefined))throw new Error('置き換えるリストの番号と文字列・有限の数値を指定してください。');
  return c.page.evaluate(({a,ref})=>{
   const {variable:v,target}=studio.runtimeData(ref,'list');if(a.index!==undefined&&a.index>v.value.length)throw new Error('リストの番号が範囲外です（1始まり）。');
   if(a.type==='list.set'){v.value=a.values.slice();v._monitorUpToDate=false;}
   if(a.type==='list.replace'){v.value[a.index-1]=a.value;v._monitorUpToDate=false;}
   return {id:v.id,name:v.name,scope:target.isStage?'global':'local',target:target.getName(),length:v.value.length,...(a.index===undefined?{values:v.value.slice()}:{index:a.index,value:v.value[a.index-1]})};
  },{a,ref});
 }
 const spec=waitSpecification(a);spec.conditions=spec.conditions.map(s=>resolve(c,s));
 const started=performance.now();let matchedSince=null,details;
 while(true){
  if(c.options.shouldCancel?.())throw new Error('撮影を中止しました。');
  details=await c.page.evaluate(conditions=>studio.runtimeCheck(conditions),spec.conditions);
  const now=performance.now(),matched=spec.mode==='all'?details.every(v=>v.matched):details.some(v=>v.matched);
  if(matched){matchedSince??=now;if(now-matchedSince>=spec.stableMs)return {matched:true,waitedMs:Math.round(now-started),details};}else matchedSince=null;
  if(now-started>=spec.timeoutMs)throw new Error(`条件待機がタイムアウトしました（${spec.timeoutMs}ms）。最後の状態: ${JSON.stringify(details).slice(0,3000)}`);
  await c.pause(Math.min(50,Math.max(1,spec.timeoutMs-(now-started))));
 }
}
