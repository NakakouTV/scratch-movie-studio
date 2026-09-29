// Runtime demonstrations use named targets/variables and native pointer actions.
export const DEMO_OPERATIONS=['variable.set','script.run','sprite.drag','stage.view'];
export async function runDemoAction(c,a){
  if(a.type==='variable.set'){
    if(!['string','number'].includes(typeof a.value)||(typeof a.value==='number'&&!Number.isFinite(a.value)))throw new Error('変数の値は文字列または有限の数値です。');
    const duration=a.duration??0;if(!Number.isFinite(duration)||duration<0||duration>60000)throw new Error('変数変更の時間は0〜60000msです。');
    if(a.scope!==undefined&&!['global','local'].includes(a.scope))throw new Error('変数の範囲はglobal / localです。');
    return c.page.evaluate(async a=>{
      const rt=studio.vm.runtime,t=a.scope==='global'?rt.getTargetForStage():a.target?rt.targets.find(t=>t.isOriginal&&!t.isStage&&t.getName()===a.target):studio.vm.editingTarget;
      if(!t)throw new Error('変数の対象がありません。');
      if(a.scope!=='global'&&t.isStage)throw new Error('全体変数にはscope: globalを指定してください。');
      const candidates=Object.values(t.variables).filter(v=>v.type===''&&(a.id?v.id===a.id:v.name===a.name));
      if(candidates.length!==1)throw new Error('変数を一意に指定できません。scope・target・idまたはnameを確認してください。');
      const v=candidates[0],before=v.value;
      if(a.duration){
        if(typeof a.value!=='number'||!Number.isFinite(Number(before)))throw new Error('時間を指定した変化には数値が必要です。');
        const start=performance.now();await new Promise(resolve=>{const tick=()=>{const p=Math.min(1,(performance.now()-start)/a.duration);v.value=Number(before)+(a.value-Number(before))*p;if(p<1)requestAnimationFrame(tick);else resolve();};tick();});
      }else v.value=a.value;
      return {id:v.id,name:v.name,before,value:v.value};
    },{...a,id:a.id?(c.variableRefs.get(a.id)||a.id):undefined,duration});
  }
  if(a.type==='stage.view'){
    if(!['editor','fullscreen'].includes(a.mode))throw new Error('ステージ表示はeditor / fullscreenです。');
    const full=a.mode==='fullscreen';
    if(await c.page.evaluate(()=>studio.store.getState().scratchGui.mode.isFullScreen)!==full){
      await c.click(c.page.locator('img[class*="stage-header_stage-button-icon"][title]').last());
      await c.page.waitForFunction(full=>studio.store.getState().scratchGui.mode.isFullScreen===full,full);
      await c.pause(100);
    }
    return {mode:a.mode};
  }
  if(a.type==='script.run'){
    await runDemoAction(c,{type:'stage.view',mode:'editor'});
    if(a.target!==undefined)await c.selectTarget(a.target,a.isStage);
    await c.selectTab('code');
    const id=c.resolve(a.block);
    await c.page.evaluate(id=>{
      const b=studio.workspace.getBlockById(id);
      if(!b||b.getParent()||b.outputConnection)throw new Error('実行するスクリプトの先頭ブロックを指定してください。');
      if(studio.vm.runtime.threads.some(t=>t.topBlock===id&&t.target===studio.vm.editingTarget&&!t.updateMonitor))throw new Error('指定スクリプトは既に実行中です。');
    },id);
    await c.ensureVisible(id);const source=await c.prepareSource(id,false);
    await c.page.evaluate(id=>{
      if(studio.vm.runtime.threads.some(t=>t.topBlock===id&&t.target===studio.vm.editingTarget&&!t.updateMonitor))throw new Error('指定スクリプトは既に実行中です。');
    },id);
    await c.page.mouse.click(source.grab.x,source.grab.y);
    // Blockly dispatches click events asynchronously; let them reach the VM
    // before another script.run can mistake the script for an idle one.
    await c.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0))));
    return {block:id,requested:true};
  }
  if(a.type==='sprite.drag'){
    const duration=a.duration??1000;
    if(![a.x,a.y,duration].every(Number.isFinite)||duration<0||duration>60000)throw new Error('スプライトの座標と0〜60000msの時間を指定してください。');
    const locate=()=>c.page.evaluate(a=>{
      const vm=studio.vm,rt=vm.runtime,t=rt.targets.find(t=>t.isOriginal&&!t.isStage&&t.getName()===a.target),r=vm.renderer;
      if(!t||!t.visible)throw new Error('表示中のスプライトを指定してください。');
      const full=studio.store.getState().scratchGui.mode.isFullScreen;
      if(full&&!t.draggable)throw new Error('全画面で動かすにはScratchでドラッグできる設定にしてください。');
      const rect=r.canvas.getBoundingClientRect(),[width,height]=r.getNativeSize(),bounds=r.getBounds(t.drawableID);
      const left=Math.max(1,(bounds.left+width/2)*rect.width/width),right=Math.min(rect.width-1,(bounds.right+width/2)*rect.width/width);
      const top=Math.max(1,(height/2-bounds.top)*rect.height/height),bottom=Math.min(rect.height-1,(height/2-bounds.bottom)*rect.height/height);
      const ids=rt.targets.filter(v=>Number.isFinite(v.drawableID)&&(!full||v.draggable)).map(v=>v.drawableID);
      const points=[{x:(left+right)/2,y:(top+bottom)/2}],step=Math.max(2,Math.sqrt(Math.max(0,(right-left)*(bottom-top))/1600));
      for(let y=top;y<bottom;y+=step)for(let x=left;x<right;x+=step)points.push({x,y});
      const p=points.find(p=>document.elementFromPoint(rect.left+p.x,rect.top+p.y)===r.canvas&&r.pick(p.x,p.y,1,1,ids)===t.drawableID);
      if(!p)throw new Error('スプライトをつかめる場所がありません。重なりや画面外の配置を確認してください。');
      const end={x:rect.left+p.x+(a.x-t.x)*rect.width/width,y:rect.top+p.y-(a.y-t.y)*rect.height/height};
      if(end.x<=rect.left||end.x>=rect.right||end.y<=rect.top||end.y>=rect.bottom)throw new Error('ドラッグの終点がステージの外になります。');
      return {id:t.id,start:{x:rect.left+p.x,y:rect.top+p.y},end};
    },a);
    let point=await locate();await c.move(point.start.x,point.start.y);point=await locate();await c.move(point.start.x,point.start.y,0);
    await c.page.evaluate(()=>{
      const vm=studio.vm,original=vm.startDrag;studio.spriteDragProbe={original,started:null};
      vm.startDrag=function(id){studio.spriteDragProbe.started=id;return original.call(this,id);};
    });
    try{
      await c.page.mouse.down();await c.page.waitForFunction(id=>studio.spriteDragProbe.started===id,point.id,{timeout:2500});
      await c.move(point.end.x,point.end.y,duration);
    }finally{
      try{await c.page.mouse.up();}finally{await c.page.evaluate(()=>{const p=studio.spriteDragProbe;if(p){studio.vm.startDrag=p.original;delete studio.spriteDragProbe;}});}
      c.target=await c.page.evaluate(()=>studio.vm.editingTarget.getName());
    }
    await c.page.waitForFunction(({id,x,y})=>{const t=studio.vm.runtime.getTargetById(id);return Math.abs(t.x-x)<=1&&Math.abs(t.y-y)<=1;},{id:point.id,x:a.x,y:a.y},{timeout:2000});
    return {target:a.target,x:a.x,y:a.y};
  }
}
