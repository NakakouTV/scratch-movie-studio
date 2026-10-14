// Read native monitor geometry; all interactions remain in the official GUI.
window.installStudioMonitors=studio=>{
 studio.monitorInfo=id=>{
  const data=studio.vm.runtime._monitorState.get(id);if(!data)return null;
  const result={...data.toObject()},component=studio.monitorComponent(id),el=component?.element;
  if(el?.isConnected){
   result.box=studio.box(el);result.displayWidth=el.offsetWidth;result.displayHeight=el.offsetHeight;
   const list=el.querySelector('[class*="monitor_list-monitor"]');if(list){result.width=list.offsetWidth;result.height=list.offsetHeight;}
   const header=el.querySelector('[class*="monitor_list-header"],[class*="monitor_label"]');
   result.label=header?.textContent??null;
   const scroller=el.querySelector('.ReactVirtualized__Grid');
   if(scroller){
    result.scroll={top:scroller.scrollTop,height:scroller.clientHeight,total:scroller.scrollHeight,box:studio.box(scroller),first:Math.floor(scroller.scrollTop/24)+1,last:Math.min(result.value.length,Math.ceil((scroller.scrollTop+scroller.clientHeight)/24))};
   }
  }
  return result;
 };
 studio.monitorPoint=(id,part='drag')=>{
  const component=studio.monitorComponent(id),el=component?.element;
  if(!el?.isConnected)throw new Error('モニターが表示されていません。monitor.showを先に実行してください。');
  let point;
  if(part==='scroll'){
   const s=el.querySelector('.ReactVirtualized__Grid');if(!s)throw new Error('リストのモニターを指定してください。');
   const r=s.getBoundingClientRect();point={x:r.left+r.width/2,y:r.top+r.height/2};
  }else{
   if(!component.props.draggable)throw new Error('モニターの配置変更はエディタ表示で行ってください。');
   const node=part==='resize'?el.querySelector('[class*="monitor_resize-handle"]'):el.querySelector('[class*="monitor_list-header"],[class*="monitor_label"]')||el;
   if(!node)throw new Error('リストのサイズ変更ハンドルがありません。');
   const r=node.getBoundingClientRect();point={x:r.left+r.width/2,y:r.top+r.height/2};
  }
  const hit=document.elementFromPoint(point.x,point.y);
  if(!el.contains(hit))throw new Error('操作するモニターが他の表示に隠れています。');
  return point;
 };
};
