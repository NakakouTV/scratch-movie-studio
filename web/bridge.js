/* Adapter for the pinned official @scratch/scratch-gui 15.1.1 distribution.
 * No Scratch UI components or dialogs are re-created by this application. */
(() => {
  const root = document.getElementById('scratch-root');
  GUI.setAppElement(root);
  const Wrapped = GUI.AppStateHOC(GUI.default);
  const appRef = React.createRef();
  ReactDOM.createRoot(root).render(React.createElement(Wrapped, {
    ref: appRef, canEditTitle: true, canSave: false,
    showComingSoon: false, backpackVisible: false,
  }));
  function components() {
    const key = Object.keys(root).find(k => k.startsWith('__reactContainer'));
    const anchor = root[key];
    const tree = anchor?.stateNode?.current || anchor;
    const results = [], seen = new Set();
    function walk(f) {
      if (!f || seen.has(f)) return;
      seen.add(f);
      if (f.stateNode && typeof f.stateNode === 'object') results.push(f.stateNode);
      walk(f.child); walk(f.sibling);
    }
    walk(tree); return results;
  }
  window.studio = {
    get store() { return appRef.current?.appState.store; },
    get vm() { return this.store?.getState().scratchGui.vm; },
    get blocks() { return components().find(c => c.ScratchBlocks && c.workspace); },
    get workspace() { return this.blocks?.workspace; },
    get SB() { return this.blocks?.ScratchBlocks; },
    get procedureDialog() { return components().find(c => c.mutationRoot && c.workspace); },
    box(el) { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; },
    point(ws,x,y) { const p=new DOMPoint(x,y).matrixTransform(ws.getCanvas().getScreenCTM());return {x:p.x,y:p.y}; },
    connectionPoint(c) {return this.point(c.getSourceBlock().workspace,c.x,c.y);},
    beginTargetedDrag(spec) {
      if(this.targetedDrag)throw new Error('別のAPIドラッグが実行中です。');
      this.targetedDrag=createScratchSnapGuard(this,spec);
    },
    endTargetedDrag() {
      this.targetedDrag?.restore();this.targetedDrag=null;
    },
    field(blockId,input,name) {
      let b=this.workspace.getBlockById(blockId);
      if(input) b=b?.getInputTargetBlock(input);
      if(!b) throw new Error(`入力ブロックが見つかりません: ${blockId} / ${input}`);
      return name?b.getField(name):b.inputList.flatMap(i=>i.fieldRow).find(f=>f.name && f.EDITABLE!==false);
    },
    fieldInfo(blockId,input,name) {
      const f=this.field(blockId,input,name);
      if(!f)throw new Error(`編集可能なフィールドがありません: ${name||input||blockId}`);
      // Scratch's colour slider inherits getOptions from FieldDropdown.
      // Recognise specialised editors before their general base classes.
      const kind=typeof f.rgbToHsv==='function'?'colour':typeof f.getOptions==='function'?'menu':'htmlInput_' in f?'text':'unsupported';
      return {name:f.name,kind,value:f.getValue(),text:f.getText(),editable:f.EDITABLE,
        options:kind==='menu'?f.getOptions().map(o=>({label:typeof o[0]==='string'?o[0]:o[0].alt,value:o[1]})):null,
        box:this.box(f.getSvgRoot())};
    },
    categoryInfo(id) {
      const item=this.workspace.getToolbox().getToolboxItems().find(i=>i.toolboxItemDef_?.toolboxitemid===id||i.name_===id);
      if(!item) throw new Error(`カテゴリがありません: ${id}`);
      return this.box(item.getDiv());
    },
    flyBlock(spec) {
      const pool=this.workspace.getFlyout().getWorkspace().getAllBlocks(false);
      return pool.find(b=>{
        if(b.type!==spec.opcode) return false;
        if(spec.opcode==='procedures_call') return b.mutationToDom()?.getAttribute('proccode')===spec.mutation?.proccode;
        if(spec.opcode==='data_variable'||spec.opcode==='data_listcontents') {
          const field=spec.opcode==='data_variable'?'VARIABLE':'LIST';
          return spec.variableId?b.getFieldValue(field)===spec.variableId:b.getField(field)?.getText()===spec.fields?.[field]?.[0];
        }
        return !b.isShadow();
      });
    },
    cursor(x,y) { document.getElementById('movie-cursor').style.transform = `translate(${x}px,${y}px)`; },
    async load(base64) {
      await this.vm.loadProject(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
    },
    async save() {
      const blob = await this.vm.saveProjectSb3();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = ''; for (let i=0; i<bytes.length; i+=32768) binary += String.fromCharCode(...bytes.subarray(i,i+32768));
      return btoa(binary);
    },
    state() {
      return {ready: !!this.workspace, target: this.vm?.editingTarget?.getName(),
        targets: this.vm?.runtime.targets.filter(t => t.isOriginal).map(t => ({id:t.id,name:t.getName(),isStage:t.isStage})),
        blocks: this.workspace?.getAllBlocks(false).map(b => ({id:b.id,type:b.type,text:b.toString(),x:b.getRelativeToSurfaceXY().x,y:b.getRelativeToSurfaceXY().y})),
        locale:this.store?.getState().locales.locale};
    }
  };
  installStudioGeometry(studio);
  const init = setInterval(() => {
    if (!studio.store) return;
    studio.store.dispatch({type:'scratch-gui/locales/SELECT_LOCALE',locale:'ja'});
    clearInterval(init);
  }, 50);
  document.addEventListener('mousemove', e => studio.cursor(e.clientX,e.clientY), true);
})();
