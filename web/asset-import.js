/* Preserve sb3 asset bytes and metadata at the official upload/VM boundary.
 * Ordinary file upload recalculates centres and may transcode images. The
 * native upload UI still reads the file; only this single import is enriched. */
window.prepareStudioAssetImport=(studio,kind,metadata,base64)=>{
  if(studio.assetImport)throw new Error('素材の追加処理が実行中です。');
  const vm=studio.vm,targetId=vm.editingTarget.id,method=kind==='costume'?'addCostume':'addSound';
  const original=vm[method],storage=vm.runtime.storage;
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  const asset=storage.createAsset(kind==='sound'?storage.AssetType.Sound:metadata.dataFormat==='svg'?storage.AssetType.ImageVector:storage.AssetType.ImageBitmap,metadata.dataFormat,bytes,metadata.assetId,false);
  const state={status:'waiting',error:null,restore(){vm[method]=original;}};
  vm[method]=function(...args){
    const id=kind==='costume'?args[2]:args[1];
    if(id&&id!==targetId)return original.apply(this,args);
    state.restore();state.status='loading';
    const item={...metadata,md5:metadata.md5ext,asset};
    return Promise.resolve().then(()=>kind==='costume'?original.call(this,metadata.md5ext,item,targetId):original.call(this,item,targetId))
      .then(result=>{state.status='done';return result;},error=>{state.status='error';state.error=String(error);throw error;});
  };
  studio.assetImport=state;
};
