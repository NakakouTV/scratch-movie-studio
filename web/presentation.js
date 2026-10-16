// Read semantic explanation subjects from the official editor; no visual overlay.
window.installStudioPresentation=studio=>{
 studio.subject=spec=>{
  const kind=spec.kind??'block';let el;
  if(['block','definition','input'].includes(kind)){
   const b=studio.workspace.getBlockById(spec.block);if(!b){if(!spec.block&&kind==='block')return null;throw new Error('説明対象のブロックがありません: '+spec.block);}
   if(kind==='definition'&&b.type!=='procedures_definition')throw new Error('定義ブロックを指定してください。');
   if(kind==='input'){const child=spec.input?b.getInputTargetBlock(spec.input):b;el=spec.field?studio.field(spec.block,spec.input,spec.field).getSvgRoot():child?.getSvgRoot();}
   else el=b.getSvgRoot();
  }else if(kind==='variableScope')el=document.querySelector('input[name="variableScopeOption"]')?.closest('[class*="prompt_options"]')??document.querySelector('[class*="prompt_variable-scope"]')??document.querySelector('input[name="variableScopeOption"]')?.parentElement?.parentElement;
  else if(kind==='variableName')el=document.querySelector('[class*="prompt_variable-name-text-input"]');
  else if(kind==='costumeName')el=document.querySelector('input[class*="fixed-tools_costume-input"]');
  else if(kind==='dialog')el=[...document.querySelectorAll('[role="dialog"],[class*="prompt_modal-content"]')].find(e=>e.getBoundingClientRect().width>0);
  else if(kind==='stage')el=studio.vm.renderer.canvas;
  else if(kind==='monitor'){
   const {variable}=studio.runtimeData(spec,spec.dataKind??'variable');el=studio.monitorComponent(variable.id)?.element;
  }
  if(!el||!el.isConnected||!el.getBoundingClientRect().width)throw new Error('説明対象が表示されていません: '+kind);
  const text=el.matches('input,text')?el:el.querySelector('text,input,[class*="monitor_label"]')??el,zoom=studio.editorZoom??1;
  const fontPx=parseFloat(getComputedStyle(text).fontSize)*zoom*(text instanceof SVGElement?studio.workspace.scale:1);
  return {kind,box:studio.box(el),text:el.value??el.textContent??'',fontPx,viewport:{width:innerWidth,height:innerHeight},editorZoom:zoom};
 };
 studio.assertPresentation=checks=>checks.map(s=>{
  const rt=studio.vm.runtime,t=s.scope==='global'?rt.getTargetForStage():s.target?rt.targets.find(t=>t.isOriginal&&t.getName()===s.target):studio.vm.editingTarget;
  let actual,matched=false;
  if(['variables','lists','costumes'].includes(s.type)){
   if(!t)throw new Error('検証する対象がありません。');actual=s.type==='costumes'?t.getCostumes().map(v=>v.name):Object.values(t.variables).filter(v=>v.type===(s.type==='lists'?'list':'')).map(v=>v.name);
   matched=Array.isArray(s.names)&&s.names.every(n=>actual.includes(n))&&(s.exact===false||actual.length===s.names.length);
  }else if(['variable','list'].includes(s.type)){
   if(!t)throw new Error('検証する対象がありません。');const v=Object.values(t.variables).find(v=>v.type===(s.type==='list'?'list':'')&&(s.id?v.id===s.id:v.name===s.name));
   actual=v?{exists:true,value:v.value}: {exists:false};matched=s.exists===false?!v:!!v;
   if(matched&&s.value!==undefined)matched=JSON.stringify(actual.value)===JSON.stringify(s.value);
  }else if(s.type==='block'){
   const b=t?.blocks.getBlock(s.block);actual={exists:!!b,opcode:b?.opcode};matched=s.exists===false?!b:!!b;
   if(matched&&s.opcode!==undefined)matched=b?.opcode===s.opcode;
  }else if(s.type==='tab'){actual=['code','costumes','sounds'][studio.store.getState().scratchGui.editorTab.activeTabIndex];matched=actual===s.value;}
  else if(s.type==='target'){actual=studio.vm.editingTarget.getName();matched=actual===s.value;}
  else if(s.type==='running'){actual=rt.threads.some(t=>!t.updateMonitor);matched=actual===s.value;}
  else if(s.type==='runtime'){actual=studio.runtimeCheck(s.conditions);matched=actual.every(v=>v.matched);}
  return {check:s,actual,matched};
 });
};
