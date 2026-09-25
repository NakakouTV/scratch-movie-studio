/* Adapter for the BlockDragStrategy bundled with scratch-gui 15.1.1.
 * Only the named API drag is constrained. Native preview, connection checks,
 * drop, events and undo remain owned by Blockly. No vendor files are patched. */
window.createScratchSnapGuard = (studio, spec) => {
  const workspace=studio.workspace;
  const sourceWorkspace=spec.flyout?workspace.getFlyout().getWorkspace():workspace;
  const source=sourceWorkspace.getBlockById(spec.sourceId);
  if(!source?.dragStrategy)throw new Error('ドラッグの接続制御に対応していないエディタです。');
  // Definition arguments start with Scratch's duplicate-on-drag wrapper; their
  // clone switches to the standard strategy. Find that shared strategy too.
  const blocks=[source,...workspace.getTopBlocks(false),...workspace.getFlyout().getWorkspace().getTopBlocks(false)];
  let prototype=null;
  for(const block of blocks){
    let p=block.dragStrategy&&Object.getPrototypeOf(block.dragStrategy);
    while(p&&!Object.hasOwn(p,'getConnectionCandidate'))p=Object.getPrototypeOf(p);
    if(p){prototype=p;break;}
  }
  if(!prototype)throw new Error('Scratchの接続候補APIが見つかりません。');
  const descriptor=Object.getOwnPropertyDescriptor(prototype,'getConnectionCandidate');
  const original=descriptor.value,before=new Set(spec.before||[]),place=spec.place||{};
  const parent=workspace.getBlockById(place.after||place.parent);
  const neighbour=place.after?parent?.nextConnection:place.parent?parent?.getInput(place.input)?.connection:null;
  if((place.after||place.parent)&&!neighbour)throw new Error('接続先がありません。');
  let strategy=null,delta=null,committing=false,restored=false;

  function candidate(block,dragDelta) {
    if(!neighbour)return null; // Explicit workspace coordinates mean no snapping.
    const local=block.outputConnection||block.previousConnection;
    if(!local||block.getDescendants(false).includes(neighbour.getSourceBlock()))return null;
    // Blockly keeps connection coordinates at drag start and supplies a delta.
    // Mirror its ConnectionDB search, including native safety/type/drag checks.
    const x=local.x,y=local.y;
    try {
      local.x+=dragDelta.x;local.y+=dragDelta.y;
      const distance=local.distanceFrom(neighbour);
      const radius=committing?Infinity:this.getSearchRadius();
      if(!workspace.connectionChecker.canConnect(local,neighbour,true,radius))return null;
      return {local,neighbour,distance};
    }finally{local.x=x;local.y=y;}
  }
  Object.defineProperty(prototype,'getConnectionCandidate',{...descriptor,value:function(block,dragDelta){
    const matches=this.workspace===workspace&&(spec.blockId?block.id===spec.blockId:!before.has(block.id));
    if(!matches)return original.call(this,block,dragDelta);
    strategy=this;delta={x:dragDelta.x,y:dragDelta.y};
    if(spec.opcode&&block.type!==spec.opcode)return null;
    return candidate.call(this,block,dragDelta);
  }});
  return {
    prepareDrop() {
      if(!strategy||!delta)throw new Error('APIで指定したブロックのドラッグを確認できません。');
      if(spec.opcode&&strategy.block.type!==spec.opcode)throw new Error('ドラッグされたブロックが指定と異なります。');
      // At the commanded endpoint, select the explicit socket regardless of
      // proximity/hysteresis. Blockly's endDrag still performs the actual drop.
      committing=true;
      strategy.updateConnectionPreview(strategy.block,delta);
      if(neighbour&&strategy.connectionCandidate?.neighbour!==neighbour)throw new Error('指定された入力にはこのブロックを接続できません。');
    },
    cancel() {if(strategy)strategy.revertDrag();},
    restore() {
      if(restored)return;
      Object.defineProperty(prototype,'getConnectionCandidate',descriptor);
      restored=true;
    }
  };
};
