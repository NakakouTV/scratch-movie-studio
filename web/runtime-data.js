window.installStudioRuntimeData=studio=>{
  studio.runtimeData=(spec,kind)=>{
    const rt=studio.vm.runtime,target=spec.scope==='global'?rt.getTargetForStage():spec.target?rt.targets.find(t=>t.isOriginal&&!t.isStage&&t.getName()===spec.target):studio.vm.editingTarget;
    if(!target||!target.isOriginal)throw new Error('データの対象スプライトがありません。');
    if(spec.scope!=='global'&&target.isStage)throw new Error('全体データにはscope: globalを指定してください。');
    const matches=Object.values(target.variables).filter(v=>v.type===(kind==='list'?'list':'')&&(spec.id?v.id===spec.id:v.name===spec.name));
    if(matches.length!==1)throw new Error('データを一意に指定できません。scope・target・idまたはnameを確認してください。');
    return {variable:matches[0],target};
  };
  studio.runtimeRead=spec=>{
    if(spec.type==='running')return studio.vm.runtime.threads.some(t=>!t.updateMonitor);
    if(spec.type==='cloneCount'){
      if(!studio.vm.runtime.targets.some(t=>t.isOriginal&&!t.isStage&&t.getName()===spec.target))throw new Error('クローンを確認するスプライトがありません。');
      return studio.vm.runtime.targets.filter(t=>!t.isOriginal&&!t.isStage&&t.getName()===spec.target).length;
    }
    const {variable}=studio.runtimeData(spec,spec.type);
    if(spec.type==='variable')return variable.value;
    if(spec.property==='length')return variable.value.length;
    if(spec.index===undefined)return variable.value.slice();
    // During initialization a list can briefly be shorter than the item we
    // are waiting for. Treat the item as not ready, not as a broken reference.
    if(spec.index>variable.value.length)return undefined;
    return variable.value[spec.index-1];
  };
  studio.runtimeCheck=conditions=>conditions.map(condition=>{
    const actual=studio.runtimeRead(condition),expected=condition.value,op=condition.op;
    if(actual===undefined&&condition.type==='list'&&condition.index!==undefined)return {condition,actual:null,missing:true,matched:false};
    const equal=Array.isArray(expected)?Array.isArray(actual)&&actual.length===expected.length&&actual.every((v,i)=>String(v)===String(expected[i])):String(actual)===String(expected);
    const numeric=Number(actual),desired=Number(expected);
    const matched=op==='equals'?equal:op==='notEquals'?!equal:op==='contains'?String(actual).includes(String(expected)):
      Number.isFinite(numeric)&&Number.isFinite(desired)&&(op==='gt'?numeric>desired:op==='gte'?numeric>=desired:op==='lt'?numeric<desired:numeric<=desired);
    return {condition,actual,matched};
  });
};
