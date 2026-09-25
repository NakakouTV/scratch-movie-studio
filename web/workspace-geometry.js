// Screen-space geometry for the pinned official editor. A rendered SVG can be
// underneath the flyout, scrollbars or zoom controls; visibility alone is not a hit test.
window.installStudioGeometry=studio=>{
  studio.minScale=0.8;
  studio.ensureReadable=()=>{const w=studio.workspace;if(w&&w.scale<studio.minScale)w.setScale(studio.minScale);};
  studio.codeArea=()=>{
    const w=studio.workspace,r=studio.box(w.getParentSvg()),m=w.getMetrics();
    const area={left:Math.max(0,r.x+m.absoluteLeft)+24,top:Math.max(0,r.y+m.absoluteTop)+24,right:Math.min(innerWidth,r.x+r.width)-30,bottom:Math.min(innerHeight,r.y+r.height)-30};
    for(const el of w.getParentSvg().querySelectorAll('.blocklyZoom')){
      const z=studio.box(el);if(z.width&&z.height)area.right=Math.min(area.right,z.x-24);
    }
    return area;
  };
  studio.revealDestination=async(p,duration)=>{
    studio.ensureReadable();
    const w=studio.workspace,c=p.after?w.getBlockById(p.after)?.nextConnection:p.parent?w.getBlockById(p.parent)?.getInput(p.input)?.connection:null;
    if((p.after||p.parent)&&!c)throw new Error('接続先がありません。');
    const to=c?studio.connectionPoint(c):studio.point(w,p.x??120,p.y??120),a=studio.codeArea();
    // A tall C block's bottom connection can be far below its visible header.
    if(to.x<a.left+80||to.x>a.right-100||to.y<a.top+60||to.y>a.bottom-80)
      await studio.pan((a.left+a.right)/2-to.x,(a.top+a.bottom)/2-to.y,duration);
  };
  studio.pan=async(dx,dy,duration)=>{
    const w=studio.workspace,sx=w.scrollX,sy=w.scrollY,start=performance.now();
    await new Promise(resolve=>{function frame(){const t=Math.min(1,(performance.now()-start)/Math.max(1,duration)),e=t*t*(3-2*t);w.scroll(sx+dx*e,sy+dy*e);if(t<1)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
  };
  studio.reveal=async(id,input,fieldName,duration)=>{
    studio.ensureReadable();
    const w=studio.workspace,b=w.getBlockById(id);if(!b)throw new Error(`ブロックがありません: ${id}`);
    const target=input?b.getInputTargetBlock(input)||b:b;
    const el=fieldName?studio.field(id,input,fieldName).getSvgRoot():(target.pathObject?.svgPath||target.getSvgRoot());
    const r=studio.box(el),a=studio.codeArea(),width=Math.min(r.width,260),height=Math.min(r.height,60);
    if(r.x>=a.left&&r.x+width<=a.right&&r.y>=a.top&&r.y+height<=a.bottom)return;
    await studio.pan((a.left+a.right)/2-(r.x+width/2),(a.top+a.bottom)/2-(r.y+height/2),duration);
  };
  studio.dragSource=(id,flyout=false)=>{
    const w=flyout?studio.workspace.getFlyout().getWorkspace():studio.workspace,b=w.getBlockById(id);
    if(!b)throw new Error('ドラッグ元のブロックがありません。');
    const root=b.getSvgRoot(),r=studio.box(b.pathObject?.svgPath||root),scale=w.scale;
    const viewport=studio.box(w.getParentSvg()),a=flyout?{left:viewport.x+3,right:viewport.x+viewport.width-12,top:viewport.y+3,bottom:viewport.y+viewport.height-12}:studio.codeArea();
    let grab=null;
    const canGrab=p=>{
      if(p.x<a.left||p.x>a.right||p.y<a.top||p.y>a.bottom)return false;
      const hit=document.elementFromPoint(p.x,p.y);
      return root.contains(hit)&&hit.closest('[data-id]')===root&&!hit.closest('.blocklyEditableText');
    };
    search:for(const y of [14,24,32,8])for(const x of [18,28,42,64,10]){
      const p={x:r.x+Math.min(x*scale,r.width*.6),y:r.y+Math.min(y*scale,r.height*.65)};
      if(canGrab(p)){grab=p;break search;}
    }
    // Input-first blocks such as join can have no own surface in the left
    // sample area. Search the visible header's full width, still rejecting
    // child blocks, editable fields and overlays using the actual hit target.
    if(!grab){
      scan:for(const y of [14,24,32,8,3]){
        for(let x=Math.max(a.left+1,r.x+2);x<Math.min(a.right-1,r.x+r.width-2);x+=Math.max(2,4*scale)){
          const p={x,y:r.y+Math.min(y*scale,r.height*.65)};
          if(canGrab(p)){grab=p;break scan;}
        }
      }
    }
    const c=b.outputConnection||b.previousConnection;
    return {id,flyout,box:r,connection:c?studio.connectionPoint(c):null,grab};
  };
  studio.frameDrag=async(id,p,duration)=>{
    studio.ensureReadable();
    const w=studio.workspace,b=w.getBlockById(id);
    if(!b)throw new Error('移動するブロックがありません。');
    const connection=p.after?w.getBlockById(p.after)?.nextConnection:p.parent?w.getBlockById(p.parent)?.getInput(p.input)?.connection:null;
    if((p.after||p.parent)&&!connection)throw new Error('接続先がありません。');
    const bounds=()=>{
      const r=studio.box(b.pathObject?.svgPath||b.getSvgRoot()),to=connection?studio.connectionPoint(connection):studio.point(w,p.x??100,p.y??100);
      return {left:Math.min(r.x,to.x),right:Math.max(r.x+Math.min(r.width,100*w.scale),to.x+60*w.scale),top:Math.min(r.y,to.y),bottom:Math.max(r.y+40*w.scale,to.y+40*w.scale)};
    };
    let r=bounds(),a=studio.codeArea();
    const factor=Math.min(1,(a.right-a.left-60)/(r.right-r.left),(a.bottom-a.top-60)/(r.bottom-r.top));
    if(factor<1){w.setScale(Math.max(studio.minScale,w.scale*factor));r=bounds();a=studio.codeArea();}
    await studio.pan((a.left+a.right-r.left-r.right)/2,(a.top+a.bottom-r.top-r.bottom)/2,duration);
    // At the minimum zoom, travel in visible segments with panning between
    // drags. Releasing outside the browser can cancel Blockly's drop entirely.
    if(!studio.dragSource(id).grab)await studio.reveal(id,null,null,duration);
    const source=studio.dragSource(id);if(!source.grab)throw new Error('ブロックを操作可能な場所に表示できません。');
    a=studio.codeArea();
    const to=connection?studio.connectionPoint(connection):studio.point(w,p.x??100,p.y??100),anchor=connection&&source.connection?source.connection:source.box;
    const end={x:to.x+source.grab.x-anchor.x,y:to.y+source.grab.y-anchor.y};
    const safe={left:a.left+20,right:a.right-20,top:a.top+20,bottom:a.bottom-20};
    if(end.x>=safe.left&&end.x<=safe.right&&end.y>=safe.top&&end.y<=safe.bottom)return null;
    // Re-centre the source to leave room for the next segment in any direction.
    await studio.pan((a.left+a.right)/2-source.grab.x,(a.top+a.bottom)/2-source.grab.y,duration);
    const fresh=studio.dragSource(id),destination=connection?studio.connectionPoint(connection):studio.point(w,p.x??100,p.y??100);
    if(!fresh.grab)throw new Error('中継移動の開始位置を表示できません。');
    const localAnchor=connection&&fresh.connection?fresh.connection:fresh.box;
    const dx=destination.x-localAnchor.x,dy=destination.y-localAnchor.y;
    let fraction=1;
    if(dx>0)fraction=Math.min(fraction,(safe.right-fresh.grab.x)/dx);
    if(dx<0)fraction=Math.min(fraction,(safe.left-fresh.grab.x)/dx);
    if(dy>0)fraction=Math.min(fraction,(safe.bottom-fresh.grab.y)/dy);
    if(dy<0)fraction=Math.min(fraction,(safe.top-fresh.grab.y)/dy);
    if(fraction<=0||!Number.isFinite(fraction))throw new Error('画面内に移動経路を確保できません。');
    const waypoint=new DOMPoint(fresh.box.x+dx*fraction,fresh.box.y+dy*fraction).matrixTransform(w.getCanvas().getScreenCTM().inverse());
    return {x:waypoint.x,y:waypoint.y};
  };
};
