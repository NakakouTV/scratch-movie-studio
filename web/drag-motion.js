/* Scoped adapter for scratch-gui 15.1.1's native Dragger. Pointer deltas alone
 * do not account for a scrolling workspace. Keep the original grab point in
 * workspace units while native dragging still owns cloning, preview and drop. */
window.createStudioDragMotion=(studio,source)=>{
  const w=studio.workspace,prototype=studio.SB.dragging.Dragger.prototype;
  const descriptor=Object.getOwnPropertyDescriptor(prototype,'moveDraggable');
  if(!descriptor||!source.grip)throw new Error('ドラッグ座標の制御に対応していません。');
  let active=null,lastEvent=null,lastDelta=null;
  Object.defineProperty(prototype,'moveDraggable',{...descriptor,value:function(event,delta){
    if(this.workspace!==w)return descriptor.value.call(this,event,delta);
    active=this;lastEvent=event;lastDelta=delta;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(w.getCanvas().getScreenCTM().inverse());
    const adjusted=new studio.SB.utils.Coordinate((point.x-source.grip.x-this.startLoc.x)*w.scale,(point.y-source.grip.y-this.startLoc.y)*w.scale);
    return descriptor.value.call(this,event,adjusted);
  }});
  return {
    scrollTo(x,y){
      if(!active)throw new Error('ブロックのドラッグが開始されていません。');
      if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('スクロール座標が不正です。');
      // scroll() clamps to the old content bounds. During this live drag the
      // destination may be empty space beyond them; the native endDrag resizes
      // the scrollbars against the final content bounds after the drop.
      const m=w.getMetrics();w.scrollX=x;w.scrollY=y;w.translate(x+m.absoluteLeft,y+m.absoluteTop);
      active.onDrag(lastEvent,lastDelta);
    },
    get active(){return !!active;},
    restore(){Object.defineProperty(prototype,'moveDraggable',descriptor);}
  };
};
