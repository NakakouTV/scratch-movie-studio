// Geometry adapter for scratch-paint 15.1.1. Actual drawing uses native mouse events.
window.installStudioPaint=studio=>{
  const scope=()=>{
    const p=studio.paintTool?._scope,state=studio.store.getState().scratchPaint;
    if(!p?.view||!p.view.element.isConnected||!state.format.startsWith('VECTOR'))throw new Error('ベクターのコスチューム編集画面を開いてください。');
    return p;
  };
  const items=()=>{
    const layer=scope().project.layers.find(l=>l.data.isPaintingLayer),result=[];
    const visit=item=>{if(item.guide||item.clipMask||item.locked)return;if(item.children&&item.className!=='CompoundPath')item.children.forEach(visit);else result.push(item);};
    layer.children.forEach(visit);return result;
  };
  const bounds=r=>({x:(r.x-480)/2,y:(360-r.y)/2,width:r.width/2,height:r.height/2});
  studio.paintPoint=(x,y)=>{
    const p=scope(),v=p.view.projectToView(new p.Point(480+x*2,360-y*2)),r=studio.box(p.view.element);
    return {x:r.x+v.x,y:r.y+v.y};
  };
  studio.paintInfo=()=>{
    const p=scope(),state=studio.store.getState().scratchPaint,t=studio.vm.editingTarget,costume=t.sprite.costumes[t.currentCostume];
    return {index:t.currentCostume,name:costume.name,format:state.format,scale:p.view.zoom*2,canvas:studio.box(p.view.element),
      items:items().map((item,index)=>({index,id:item.id,selected:item.selected,bounds:bounds(item.bounds),strokeBounds:bounds(item.strokeBounds),fill:item.fillColor?.toCSS(true)??null,stroke:item.strokeColor?.toCSS(true)??null,strokeWidth:item.strokeWidth})),style:{fillColor:state.color.fillColor,strokeColor:state.color.strokeColor,strokeWidth:state.color.strokeWidth}};
  };
  studio.paintFinishShape=(id,a)=>{
    const p=scope(),item=items().find(v=>v.id===id);if(!item)throw new Error('描画した図形がありません。');
    const r=studio.paintInfo().items.find(v=>v.id===id).bounds;
    // Browser pointer positions round to physical pixels. Correct only that
    // small discrepancy after a real drag; never synthesize a shape.
    const error=Math.max(Math.abs(r.x-a.x),Math.abs(r.y-a.y),Math.abs(r.width-a.width),Math.abs(r.height-a.height));
    if(error>2)throw new Error('描画した図形の位置・サイズが指定と一致しません。');
    if(error>1e-6){item.bounds=new p.Rectangle(480+a.x*2,360-a.y*2,a.width*2,a.height*2);studio.paintTool.onUpdateImage();}
    return studio.paintInfo().items.find(v=>v.id===id);
  };
  studio.paintPick=index=>{
    const p=scope(),item=items()[index];if(!item)throw new Error('図形の番号が不正です（0始まり）。');
    const r=item.bounds;
    for(const fy of [.5,.2,.8,.05,.95])for(const fx of [.5,.2,.8,.05,.95]){
      const q=new p.Point(r.x+r.width*fx,r.y+r.height*fy),hit=p.project.hitTest(q,{fill:true,stroke:true,segments:false,guide:false,tolerance:1/p.view.zoom});
      if(hit?.item!==item)continue;
      const point=studio.paintPoint((q.x-480)/2,(360-q.y)/2);
      if(document.elementFromPoint(point.x,point.y)===p.view.element)return {id:item.id,point};
    }
    throw new Error('図形をクリックできません。倍率・重なりを確認してください。');
  };
};
