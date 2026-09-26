import {chromium} from 'playwright';
import {readSb3,EMPTY_COSTUME} from './project.mjs';

const categories={event:'events',control:'control',motion:'motion',looks:'looks',sound:'sound',sensing:'sensing',operator:'operators',data:'variables',procedures:'myBlocks',pen:'pen'};
export class EditorController {
  constructor(baseURL,options={}) {
    this.baseURL=baseURL;this.options=options;
    this.timing={move:450,drag:750,type:75,pause:200,...options.timing};
    this.aliases=new Map();this.procedures=new Map();this.variableRefs=new Map();this.broadcastNames=new Map();this.position={x:600,y:500};
    this.minScale=options.minScale??0.8;this.activeTab='code';
  }
  async open() {
    this.browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:!this.options.headed,args:['--no-proxy-server','--autoplay-policy=no-user-gesture-required']});
    this.context=await this.browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,locale:'ja-JP',acceptDownloads:true});
    this.page=await this.context.newPage();
    this.page.setDefaultTimeout(10000);
    this.errors=[];
    this.page.on('pageerror',e=>this.errors.push(e.message));
    await this.page.goto(`${this.baseURL}/editor.html`);
    await this.page.waitForFunction(()=>window.studio?.workspace,null,{timeout:60000});
    await this.page.evaluate(()=>document.body.classList.add('recording'));
    await this.configureView({minScale:this.minScale});
    return this;
  }
  async close() {await this.browser?.close();}
  async pause(ms=this.timing.pause) { if(ms>0) await new Promise(r=>setTimeout(r,ms)); }
  async move(x,y,ms=this.timing.move) {
    if(!Number.isFinite(x)||!Number.isFinite(y)) throw new Error('カーソル座標が不正です。');
    const start={...this.position},steps=Math.max(1,Math.ceil(ms/33));
    for(let i=1;i<=steps;i++) {
      const t=i/steps,e=t*t*(3-2*t);
      await this.page.mouse.move(start.x+(x-start.x)*e,start.y+(y-start.y)*e);
      if(ms>0) await this.pause(ms/steps);
    }
    this.position={x,y};
  }
  async clickBox(box) {
    if(!box) throw new Error('クリック対象が見つかりません。');
    await this.move(box.x+box.width/2,box.y+box.height/2);
    await this.page.mouse.click(this.position.x,this.position.y);
    await this.pause();
  }
  async click(locator) {
    await locator.waitFor({state:'visible'});
    for(let attempt=0;attempt<3;attempt++){
      await locator.scrollIntoViewIfNeeded();
      const box=await locator.boundingBox();if(!box)continue;
      const point={x:box.x+box.width/2,y:box.y+box.height/2};await this.move(point.x,point.y);
      const hit=await locator.evaluate((el,p)=>el.contains(document.elementFromPoint(p.x,p.y)),point);
      if(hit){await this.page.mouse.click(point.x,point.y);await this.pause();return;}
    }
    throw new Error('クリック対象が他の表示に隠れています。');
  }
  async type(text,replace=true) {
    if(replace) {
      await this.page.keyboard.press('Home');
      await this.page.keyboard.press('Shift+End');
    }
    if(String(text)==='') await this.page.keyboard.press('Backspace');
    for(const char of String(text)) {await this.page.keyboard.insertText(char);await this.pause(this.timing.type);}
  }
  key(id) {return `${this.target}\0${id}`;}
  resolve(id) {return this.aliases.get(this.key(id))||id;}
  async load(buffer) {
    const {project:source}=await readSb3(buffer);
    this.aliases.clear();this.procedures.clear();this.variableRefs.clear();this.broadcastNames.clear();this.callArgs=new Map();
    await this.page.evaluate(b=>studio.load(b),buffer.toString('base64'));
    await this.page.waitForFunction(()=>studio.vm.runtime.targets.length>0&&studio.workspace);
    await this.pause(500);
    this.target=await this.page.evaluate(()=>studio.vm.editingTarget.getName());
    const ids=await this.page.evaluate(()=>studio.vm.runtime.targets.flatMap(t=>Object.keys(t.variables)));
    for(const id of ids)this.variableRefs.set(id,id);
    const bindings=source.targets.flatMap(t=>Object.entries(t.blocks||{}).flatMap(([id,b])=>[
      {target:t.name,isStage:!!t.isStage,sourceId:id,id},
      ...Object.entries(b.inputs||{}).filter(([,v])=>Array.isArray(v[1])&&[12,13].includes(v[1][0])).map(([input])=>({target:t.name,isStage:!!t.isStage,sourceId:`${id}::${input}`,parent:id,input}))
    ]));
    const loaded=await this.page.evaluate(bindings=>bindings.flatMap(b=>{
      const t=studio.vm.runtime.targets.find(t=>t.isOriginal&&t.isStage===b.isStage&&t.getName()===b.target);
      const id=b.parent?t?.blocks.getBlock(b.parent)?.inputs?.[b.input]?.block:b.id;
      return id&&t?.blocks.getBlock(id)?[{target:b.target,sourceId:b.sourceId,id}]:[];
    }),bindings);
    for(const b of loaded)this.aliases.set(`${b.target}\0${b.sourceId}`,b.id);
    await this.configureView({minScale:this.minScale});
  }
  async configureView({minScale=this.minScale}={}) {
    if(!Number.isFinite(minScale)||minScale<0.3||minScale>1.5)throw new Error('倍率下限は0.3〜1.5です。');
    this.minScale=minScale;
    await this.page.evaluate(scale=>{studio.minScale=scale;studio.ensureReadable();},minScale);
  }
  async checkpoint() {
    await this.page.keyboard.press('Escape');
    await this.pause(100);
    const view=await this.page.evaluate(()=>{
      const w=studio.workspace,f=w.getFlyout().getWorkspace(),item=w.getToolbox().getSelectedItem();
      return {target:studio.vm.editingTarget.getName(),isStage:studio.vm.editingTarget.isStage,scale:w.scale,x:w.scrollX,y:w.scrollY,category:item?.toolboxItemDef_?.toolboxitemid,flyoutY:f.scrollY,extensions:[...studio.vm.extensionManager._loadedExtensions.keys()]};
    });
    // SB3 stores input variable/list reporters inline without their runtime ID.
    // Remember the socket so aliases can follow the new ID after deserialization.
    const reporters=await this.page.evaluate(()=>studio.vm.runtime.targets.filter(t=>t.isOriginal).flatMap(t=>
      Object.values(t.blocks._blocks).filter(b=>b.parent&&['data_variable','data_listcontents'].includes(b.opcode)).flatMap(b=>{
        const input=Object.entries(t.blocks.getBlock(b.parent)?.inputs||{}).find(([,v])=>v.block===b.id)?.[0];
        return input?[{target:t.getName(),id:b.id,parent:b.parent,input}]:[];
      })));
    return {version:1,editorVersion:'15.1.1',view,tab:this.activeTab,minScale:this.minScale,position:this.position,
      reporters,
      maps:Object.fromEntries(['aliases','procedures','variableRefs','broadcastNames','callArgs'].map(k=>[k,[...(this[k]||new Map())]]))};
  }
  async restoreCheckpoint(buffer,state) {
    if(state.version!==1||state.editorVersion!=='15.1.1')throw new Error('保存地点のエディタ版に対応していません。');
    // The VM omits unused extensions when saving an unfinished project. Keep
    // loaded categories (e.g. PEN before its first block) available on resume.
    const {zip,project}=await readSb3(buffer);
    project.extensions=[...new Set([...(project.extensions||[]),...(state.view.extensions||[])])];
    zip.file('project.json',JSON.stringify(project));
    await this.load(await zip.generateAsync({type:'nodebuffer'}));await this.selectTab('code');
    await this.page.evaluate(async extensions=>{
      const manager=studio.vm.extensionManager;
      for(const id of extensions)if(!manager.isExtensionLoaded(id))await manager.loadExtensionURL(id);
    },state.view.extensions||[]);
    await this.pause(200);
    await this.selectTarget(state.view.target,state.view.isStage);
    const reporterIds=new Map((state.reporters||[]).map(b=>[`${b.target}\0${b.id}`,this.aliases.get(`${b.target}\0${b.parent}::${b.input}`)]));
    for(const [key,entries] of Object.entries(state.maps))if(['aliases','procedures','variableRefs','broadcastNames','callArgs'].includes(key))this[key]=new Map(entries);
    for(const [key,id] of this.aliases){
      const target=key.slice(0,key.indexOf('\0')),restored=reporterIds.get(`${target}\0${id}`);
      if(restored)this.aliases.set(key,restored);
    }
    await this.configureView({minScale:state.minScale});
    if(state.view.category)await this.category(state.view.category);
    await this.page.evaluate(v=>{const w=studio.workspace;w.setScale(v.scale);w.scroll(v.x,v.y);const f=w.getFlyout().getWorkspace();f.scroll(f.scrollX,v.flyoutY);},state.view);
    await this.selectTab(state.tab||'code');
    await this.move(state.position.x,state.position.y,0);
  }
  async state() {
    const state=await this.page.evaluate(()=>studio.state());
    const reverse=new Map();
    for(const [key,id] of this.aliases){const prefix=`${state.target}\0`;if(key.startsWith(prefix)){const values=reverse.get(id)||[];values.push(key.slice(prefix.length));reverse.set(id,values);}}
    for(const block of state.blocks||[]){
      block.sourceIds=reverse.get(block.id)||[];block.sourceId=block.sourceIds[0]??null;
      block.parentSourceId=reverse.get(block.parent)?.[0]??null;block.nextSourceId=reverse.get(block.next)?.[0]??null;
      const args=block.sourceIds.map(id=>this.callArgs?.get(`${state.target}\0${id}`)).find(Boolean);
      for(const input of block.inputs){
        input.sourceBlockId=reverse.get(input.blockId)?.[0]??null;
        const index=args?.args.indexOf(input.name)??-1;
        input.sourceName=index<0?input.name:args.originalArgs[index];
      }
    }
    return state;
  }
  async setAssetSource(buffer) {this.assetSource=await readSb3(buffer);}
  async selectTab(tab) {
    const index={code:0,costumes:1,sounds:2}[tab];
    if(index===undefined)throw new Error('タブは code / costumes / sounds で指定してください。');
    const locator=this.page.getByRole('tab').nth(index);
    if(await locator.getAttribute('aria-selected')!=='true'){
      await this.click(locator);
      await this.pause(Math.max(150,this.timing.pause));
    }
    this.activeTab=tab;
    if(tab==='code')await this.page.evaluate(()=>studio.ensureReadable());
  }
  assetItems() {return this.page.locator('[class*="asset-panel_wrapper"] [class*="sprite-selector-item_sprite-selector-item"]');}
  async selectCostume(index) {
    const count=await this.page.evaluate(()=>studio.vm.editingTarget.sprite.costumes.length);
    if(!Number.isInteger(index)||index<0||index>=count)throw new Error('コスチューム番号が不正です（0始まり）。');
    await this.selectTab('costumes');
    // The upload flyout can remain open above the thumbnail list. Leave it
    // before scrolling, and centre the item away from the floating add button.
    const tab=await this.page.getByRole('tab').nth(1).boundingBox();
    await this.move(tab.x+tab.width/2,tab.y+tab.height/2);await this.pause(350);
    const item=this.assetItems().nth(index);await item.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}));await this.click(item);
    await this.page.waitForFunction(index=>studio.vm.editingTarget.currentCostume===index,index);
  }
  async addAsset(kind,a) {
    const source=this.assetSource?.project.targets.find(t=>t.name===(a.sourceTarget||this.target));
    const metadata=source?.[kind==='costume'?'costumes':'sounds']?.[a.assetIndex];
    if(!Number.isInteger(a.assetIndex)||!metadata)throw new Error('読み込んだsb3内に指定された素材がありません。');
    const file=this.assetSource.zip.file(metadata.md5ext||`${metadata.assetId}.${metadata.dataFormat}`);
    if(!file)throw new Error(`素材ファイルがありません: ${metadata.name}`);
    const buffer=await file.async('nodebuffer');
    const mime={svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',wav:'audio/wav',mp3:'audio/mpeg'}[metadata.dataFormat];
    if(!mime)throw new Error(`未対応の素材形式です: ${metadata.dataFormat}`);
    await this.selectTab(kind==='costume'?'costumes':'sounds');
    const state=await this.page.evaluate(()=>({stage:studio.vm.editingTarget.isStage,costumes:studio.vm.editingTarget.sprite.costumes.map(c=>({name:c.name,assetId:c.assetId})),sounds:studio.vm.editingTarget.sprite.sounds.length}));
    const noun=kind==='sound'?'音':state.stage?'背景':'コスチューム';
    const panel=this.page.locator('[class*="asset-panel_wrapper"]:visible');
    const main=panel.getByRole('button',{name:`${noun}を選ぶ`,exact:true}).first();
    const box=await main.boundingBox();
    if(!box)throw new Error('素材の追加ボタンが見つかりません。');
    await this.move(box.x+box.width/2,box.y+box.height/2);await this.pause(350);
    await this.page.evaluate(({kind,metadata,data})=>prepareStudioAssetImport(studio,kind,metadata,data),{kind,metadata,data:buffer.toString('base64')});
    try{
      const [chooser]=await Promise.all([this.page.waitForEvent('filechooser'),this.click(panel.getByRole('button',{name:new RegExp(`^${noun}をアップロード`)}))]);
      await chooser.setFiles({name:`import.${metadata.dataFormat}`,mimeType:mime,buffer});
      await this.page.waitForFunction(()=>['done','error'].includes(studio.assetImport?.status),null,{timeout:30000});
      const error=await this.page.evaluate(()=>studio.assetImport.error);if(error)throw new Error(error);
      const count=kind==='costume'?state.costumes.length+1:state.sounds+1;
      await this.page.waitForFunction(({kind,count})=>studio.vm.editingTarget.sprite[kind==='costume'?'costumes':'sounds'].length===count,{kind,count});
      await this.pause(Math.max(500,this.timing.pause*2));
    }finally{
      await this.page.evaluate(()=>{studio.assetImport?.restore();studio.assetImport=null;});
    }
    if(kind==='costume'&&state.costumes.length===1&&state.costumes[0].assetId===EMPTY_COSTUME.assetId&&state.costumes[0].name===EMPTY_COSTUME.name){
      await this.selectCostume(0);
      await this.click(this.assetItems().nth(0).locator('[class*="sprite-selector-item_delete-button"]'));
      await this.page.waitForFunction(()=>studio.vm.editingTarget.sprite.costumes.length===1);
      await this.pause(250);
    }
    return {name:metadata.name,kind};
  }
  async save() {return Buffer.from(await this.page.evaluate(()=>studio.save()),'base64');}
  async selectTarget(name,isStage=false) {
    const current=await this.page.evaluate(()=>studio.vm.editingTarget?.getName());
    if(current===name) {this.target=name;return;}
    if(isStage) await this.click(this.page.locator('[class*="stage-selector_stage-selector"]').first());
    else await this.click(this.page.getByRole('button',{name,exact:true}));
    await this.page.waitForFunction(n=>studio.vm.editingTarget?.getName()===n,name);
    this.target=name;await this.pause();await this.page.evaluate(()=>studio.ensureReadable());
  }
  async category(id) {
    await this.selectTab('code');
    await this.page.evaluate(id=>{
      const item=studio.workspace.getToolbox().getToolboxItems().find(i=>i.toolboxItemDef_?.toolboxitemid===id||i.name_===id);
      item?.getDiv().scrollIntoView({block:'nearest'});
    },id);
    await this.clickBox(await this.page.evaluate(id=>studio.categoryInfo(id),id));
    await this.page.waitForFunction(()=>studio.workspace.getFlyout().scrollTarget===undefined);
    await this.pause(80);
  }
  async createVariable(a) {
    await this.category('variables');
    await this.click(this.page.locator('.blocklyFlyoutButton').filter({hasText:a.kind==='list'?'リストを作る':'変数を作る'}));
    const input=this.page.locator('[class*="prompt_variable-name-text-input"]');
    await this.click(input);await this.type(a.name);
    if(a.scope==='local') await this.click(this.page.locator('input[name="variableScopeOption"][value="local"]'));
    await this.click(this.page.getByRole('button',{name:'OK',exact:true}));
    const id=await this.page.evaluate(({name,scope,kind,value})=>{
      const t=scope==='local'?studio.vm.editingTarget:studio.vm.runtime.getTargetForStage();
      const v=Object.values(t.variables).find(v=>v.name===name&&v.type===(kind==='list'?'list':''));
      if(!v) throw new Error('変数の作成を確認できません。同じ名前の変数が別のスコープにないか確認してください。');
      if(value!==undefined) v.value=value;
      studio.vm.emitTargetsUpdate();return v.id;
    },a);
    if(a.monitor){
      // The GUI adds the monitor asynchronously after the variable event.
      await this.page.waitForFunction(id=>studio.vm.runtime._monitorState.has(id),id,{timeout:5000});
      await this.page.evaluate(({id,monitor})=>{
        const runtime=studio.vm.runtime,current=runtime._monitorState.get(id);
        // Immutable.Map.merge converts nested plain objects (notably params)
        // into Maps. Scratch's label adapter requires params.VARIABLE / LIST.
        // Keep the freshly created identity, owner, name and runtime value.
        const keys=['mode','x','y','width','height','visible','sliderMin','sliderMax','isDiscrete'];
        const settings=Object.fromEntries(keys.filter(key=>monitor[key]!==undefined).map(key=>[key,monitor[key]]));
        runtime.requestUpdateMonitor(current.merge(settings));
      },{id,monitor:a.monitor});
      await this.pause(80);
    }
    if(a.sourceId) {this.aliases.set(this.key(a.sourceId),id);this.variableRefs.set(a.sourceId,id);}
    return {id};
  }
  async createProcedure(a) {
    await this.category('myBlocks');
    await this.click(this.page.locator('.blocklyFlyoutButton').filter({hasText:'ブロックを作る'}));
    await this.page.waitForFunction(()=>!!studio.procedureDialog);
    const chunks=a.mutation.proccode.split(/(%[sb])/g),names=JSON.parse(a.mutation.argumentnames||'[]');
    if(!chunks[0].trim()) {await this.type('');await this.page.keyboard.press('Enter');}
    let arg=0,hasLabel=false;
    for(const chunk of chunks) {
      if(chunk==='%s'||chunk==='%b') {
        await this.click(this.page.locator('[class*="custom-procedures_option-card"]').nth(chunk==='%b'?1:0));
        await this.type(names[arg++]||'入力');await this.page.keyboard.press('Enter');
      } else if(chunk.trim()) {
        if(hasLabel||arg) await this.click(this.page.locator('[class*="custom-procedures_option-card"]').nth(2));
        await this.type(chunk.trim());await this.page.keyboard.press('Enter');hasLabel=true;
      }
    }
    if(String(a.mutation.warp)==='true') await this.click(this.page.locator('[class*="custom-procedures_checkbox-row"] input'));
    const before=await this.page.evaluate(()=>studio.workspace.getTopBlocks(false).map(b=>b.id));
    await this.click(this.page.getByRole('button',{name:'OK',exact:true}));
    await this.pause(300);
    const def=await this.page.evaluate(before=>{
      const b=studio.workspace.getTopBlocks(false).find(b=>b.type==='procedures_definition'&&!before.includes(b.id));
      if(!b) throw new Error('定義ブロックの作成に失敗しました。');
      const p=b.getInputTargetBlock('custom_block');
      const m=p.mutationToDom();
      return {id:b.id,prototypeId:p.id,proccode:m.getAttribute('proccode'),args:JSON.parse(m.getAttribute('argumentids'))};
    },before);
    if(def.proccode!==a.mutation.proccode) throw new Error(`定義名が一致しません: ${def.proccode}`);
    this.aliases.set(this.key(a.sourceId),def.id);
    this.aliases.set(this.key(a.prototypeId),def.prototypeId);
    this.procedures.set(this.key(def.proccode),{...def,originalArgs:JSON.parse(a.mutation.argumentids||'[]')});
    // Official creation leaves the definition attached to the mouse.
    await this.placeCreatedDefinition(def.id,a.x||80,a.y||80);
    return def;
  }
  async placeCreatedDefinition(id,x,y) {
    const info=await this.page.evaluate(({id,x,y})=>{
      const w=studio.workspace,b=w.getBlockById(id);return {box:studio.box(b.getSvgRoot()),point:studio.point(w,x,y),dragging:w.isDragging()};
    },{id,x,y});
    if(info.dragging) {await this.move(info.point.x+20,info.point.y+20,this.timing.drag);await this.page.mouse.click(this.position.x,this.position.y);}
    else await this.moveBlock(id,{x,y});
    await this.pause();
  }
  async ensureVisible(id,input,fieldName) {
    await this.selectTab('code');
    await this.page.evaluate(({id,input,fieldName,duration})=>studio.reveal(id,input,fieldName,duration),{id,input,fieldName,duration:this.timing.move});
    await this.pause(120);
  }
  mappedInput(id,input) {
    const p=this.callArgs?.get(this.key(id));
    if(!p) return input;const i=p.originalArgs.indexOf(input);return i<0?input:p.args[i];
  }
  async input(a) {
    const id=this.resolve(a.block),input=this.mappedInput(a.block,a.input);
    if(await this.page.getByRole('tab').nth(0).getAttribute('aria-selected')!=='true')await this.selectTab('code');
    const name=await this.page.evaluate(({id,input})=>studio.fieldInfo(id,input).name,{id,input});
    return this.field({...a,field:name});
  }
  async colour(id,input,name,value) {
    if(!/^#[\da-f]{6}$/i.test(value))throw new Error('色は #rrggbb 形式で指定してください。');
    const hsv=await this.page.evaluate(({id,input,name,value})=>{
      const f=studio.field(id,input,name),rgb=value.slice(1).match(/../g).map(n=>parseInt(n,16));return f.rgbToHsv(...rgb);
    },{id,input,name,value});
    await this.page.locator('.scratchColourSlider').first().waitFor({state:'visible'});
    for(const [i,ratio] of [hsv.hue/360,hsv.saturation,hsv.value/255].entries()){
      const slider=this.page.locator('.scratchColourSlider').nth(i),r=await slider.boundingBox();
      await this.move(r.x+8+ratio*(r.width-16),r.y+r.height/2);await this.page.mouse.click(this.position.x,this.position.y);await this.pause();
    }
    // The official range sliders quantize HSV; retain the exact sb3 RGB value in
    // the same native field after visibly moving its controls.
    await this.page.evaluate(({id,input,name,value})=>studio.field(id,input,name).setValue(value),{id,input,name,value});
    await this.page.keyboard.press('Escape');
    const actual=await this.page.evaluate(({id,input,name})=>studio.field(id,input,name).getValue(),{id,input,name});
    if(String(actual).toLowerCase()!==value.toLowerCase())throw new Error(`色の設定が一致しません: ${value} → ${actual}`);
    return {value:actual};
  }
  async field(a) {
    if(a.field==='BROADCAST_OPTION'&&a.value===undefined)a={...a,value:this.broadcastNames.get(a.referenceId)};
    const id=this.resolve(a.block),input=a.input?this.mappedInput(a.block,a.input):undefined;
    await this.ensureVisible(id,input,a.field);
    const f=await this.page.evaluate(({id,input,name})=>studio.fieldInfo(id,input,name),{id,input,name:a.field});
    const expected=this.variableRefs.get(a.referenceId)||a.value;
    if(String(f.value)===String(expected)||(!a.referenceId&&['VARIABLE','LIST','VALUE'].includes(a.field)&&f.text===String(a.value))) return {unchanged:true};
    if(f.editable===false) throw new Error(`このフィールドは入力できません: ${a.field}`);
    if(f.kind==='unsupported')throw new Error(`このフィールドの操作形式には未対応です: ${a.field}`);
    if(f.kind==='colour'&&!/^#[\da-f]{6}$/i.test(String(a.value)))throw new Error('色は #rrggbb 形式で指定してください。');
    await this.clickBox(f.box);
    if(f.kind==='colour')return this.colour(id,input,a.field,String(a.value));
    if(f.kind==='menu') {
      const option=f.options.find(o=>String(o.value)===String(expected))||f.options.find(o=>String(o.label)===String(a.value));
      if(!option&&a.field==='BROADCAST_OPTION'){
        if(typeof a.value!=='string'||!a.value)throw new Error('メッセージ名を指定してください。');
        await this.click(this.page.locator('.blocklyMenuItem').filter({hasText:'新しいメッセージ'}));
        await this.click(this.page.locator('[class*="prompt_variable-name-text-input"]'));await this.type(a.value);
        await this.click(this.page.getByRole('button',{name:'OK',exact:true}));
        const selected=await this.page.evaluate(({id,input})=>{const f=studio.field(id,input,'BROADCAST_OPTION');return {id:f.getValue(),name:f.getText()};},{id,input});
        if(selected.name!==a.value)throw new Error('メッセージ名の作成を確認できません。');
        if(a.referenceId)this.variableRefs.set(a.referenceId,selected.id);
        return {value:a.value,created:true};
      }
      if(!option) throw new Error(`選択肢がありません: ${a.field}=${a.value}`);
      const items=this.page.locator('.blocklyMenuItem').filter({hasText:new RegExp(`^${escapeRegExp(option.label)}$`)});
      const matchIndex=f.options.filter(o=>o.label===option.label).indexOf(option);
      await this.click(items.nth(Math.max(0,matchIndex)));
      const selected=await this.page.evaluate(({id,input,name})=>studio.field(id,input,name).getValue(),{id,input,name:a.field});
      if(String(selected)!==String(option.value))throw new Error(`選択結果が一致しません: ${a.field}`);
      if(a.field==='BROADCAST_OPTION'&&a.referenceId)this.variableRefs.set(a.referenceId,option.value);
    } else {
      const editor=this.page.locator('input.blocklyHtmlInput:visible');
      await editor.waitFor();await this.click(editor);await this.type(a.value);await this.page.keyboard.press('Enter');await this.pause(80);
      const value=await this.page.evaluate(({id,input,name})=>studio.field(id,input,name).getValue(),{id,input,name:a.field});
      if(String(value)!==String(a.value))throw new Error(`入力が一致しません: ${a.value} → ${value}`);
    }
    return {value:a.value};
  }
  async addBlock(a) {
    const variable=a.fields?.VARIABLE||a.fields?.LIST;
    if(variable?.[1])a={...a,variableId:this.variableRefs.get(variable[1])};
    const prefix=a.opcode.split('_')[0];
    if(prefix==='argument') return this.addArgument(a);
    await this.selectTab('code');
    await this.page.waitForFunction(()=>studio.workspace.getFlyout().scrollTarget===undefined);
    const category=categories[prefix]||prefix;
    const location=await this.page.evaluate(spec=>{const b=studio.flyBlock(spec);return b?studio.palettePosition(b.id):null;},a);
    // ContinuousFlyout already contains neighbouring categories. Keep its
    // current position when possible, and click only for a distant category.
    if(!location||(!location.visible&&!location.near&&location.category!==category))await this.category(category);
    if(a.place?.after||a.place?.parent) await this.ensureVisible(this.resolve(a.place.after||a.place.parent),a.place.input?this.mappedInput(a.place.parent,a.place.input):undefined);
    // Locate the actual palette block, then scroll the palette to it.
    const fly=await this.page.evaluate(spec=>{
      const b=studio.flyBlock(spec);if(!b) throw new Error(`パレットにブロックがありません: ${spec.opcode}`);
      return {id:b.id,y:b.getRelativeToSurfaceXY().y};
    },a);
    await this.page.evaluate(id=>studio.revealPalette(id),fly.id);
    // ContinuousFlyout scrolls asynchronously. Measuring mid-animation can
    // grab a different block by the time the mouse reaches the palette.
    await this.page.waitForFunction(()=>studio.workspace.getFlyout().scrollTarget===undefined);
    const source={id:fly.id,flyout:true};
    const result=await this.dragNew(a,source);
    if(a.opcode==='procedures_call') {
      this.callArgs ||= new Map();this.callArgs.set(this.key(a.sourceId),this.procedures.get(this.key(a.mutation.proccode)));
    }
    return result;
  }
  async destination(place,source) {
    const p={...place};if(p.after)p.after=this.resolve(p.after);if(p.parent){p.input=this.mappedInput(place.parent,p.input);p.parent=this.resolve(p.parent);}
    return this.page.evaluate(({p,source})=>{
      const w=studio.workspace;
      const c=p.after?w.getBlockById(p.after)?.nextConnection:p.parent?w.getBlockById(p.parent)?.getInput(p.input)?.connection:null;
      if((p.after||p.parent)&&!c) throw new Error('接続先がありません。');
      const to=c?studio.connectionPoint(c):studio.point(w,p.x??100,p.y??100);
      const anchor=c&&source.connection?source.connection:source.box;
      return {x:to.x+source.grab.x-anchor.x,y:to.y+source.grab.y-anchor.y};
    },{p,source});
  }
  async dragNew(a,source) {
    const p={...(a.place||{x:120,y:120})};if(p.after)p.after=this.resolve(p.after);if(p.parent){p.input=this.mappedInput(p.parent,p.input);p.parent=this.resolve(p.parent);}
    if(source.flyout)await this.page.evaluate(({p,duration})=>studio.revealDestination(p,duration),{p,duration:this.timing.move});
    else await this.ensureVisible(source.id);
    source=await this.prepareSource(source.id,!!source.flyout);
    const before=await this.page.evaluate(()=>studio.workspace.getAllBlocks(false).map(b=>b.id));
    await this.dragWithSnap({sourceId:source.id,flyout:!!source.flyout,opcode:a.opcode,before,source},a.place,()=>this.moveHeldBlock(a.place||{x:120,y:120},source));
    const id=await this.page.evaluate(({before,opcode})=>{
      const b=studio.workspace.getAllBlocks(false).find(b=>!before.includes(b.id)&&b.type===opcode&&!b.isShadow()&&b.getParent()?.type!=='procedures_prototype');
      if(!b) throw new Error(`ドラッグでブロックを作成できませんでした: ${opcode}`);
      return b.id;
    },{before,opcode:a.opcode});
    await this.waitForDrop(id);
    if(a.sourceId)this.aliases.set(this.key(a.sourceId),id);
    await this.verifyConnection(id,a.place);
    return {id};
  }
  async prepareSource(id,flyout) {
    for(let attempt=0;attempt<3;attempt++){
      if(flyout){
        await this.page.evaluate(id=>studio.revealPalette(id),id);
        await this.page.waitForFunction(()=>studio.workspace.getFlyout().scrollTarget===undefined);
      }
      let source=await this.page.evaluate(({id,flyout})=>studio.dragSource(id,flyout),{id,flyout});
      if(!source.grab&&!flyout){await this.ensureVisible(id);source=await this.page.evaluate(id=>studio.dragSource(id),id);}
      if(!source.grab)continue;
      await this.move(source.grab.x,source.grab.y);
      const stable=await this.page.evaluate(source=>{
        const w=source.flyout?studio.workspace.getFlyout().getWorkspace():studio.workspace,b=w.getBlockById(source.id),fresh=studio.dragSource(source.id,source.flyout),hit=document.elementFromPoint(source.grab.x,source.grab.y);
        return fresh.grab&&Math.abs(fresh.box.x-source.box.x)<1&&Math.abs(fresh.box.y-source.box.y)<1&&b.getSvgRoot().contains(hit)&&hit.closest('[data-id]')===b.getSvgRoot();
      },source);
      if(stable)return source;
    }
    throw new Error('ドラッグ元を操作可能な位置に表示できませんでした。');
  }
  async dragWithSnap(spec,place,move) {
    const p={...place};
    if(p.after)p.after=this.resolve(p.after);
    if(p.parent){p.input=this.mappedInput(place.parent,p.input);p.parent=this.resolve(p.parent);}
    await this.page.evaluate(spec=>studio.beginTargetedDrag(spec),{...spec,place:p});
    try {
      await this.page.evaluate(source=>{studio.dragMotion=createStudioDragMotion(studio,source);},spec.source);
      await this.page.mouse.down();
      await move();
      await this.page.evaluate(()=>studio.targetedDrag.prepareDrop());
    }catch(error){
      await this.page.evaluate(()=>studio.targetedDrag?.cancel()).catch(()=>{});
      throw error;
    }finally{
      try{await this.page.mouse.up();}
      finally{await this.page.evaluate(()=>{studio.dragMotion?.restore();studio.dragMotion=null;studio.endTargetedDrag();});}
    }
  }
  async moveHeldBlock(place,source) {
    let dest=await this.destination(place,source);
    // Cross Blockly's drag threshold using real pointer events before panning.
    const dx=dest.x-this.position.x,dy=dest.y-this.position.y,length=Math.hypot(dx,dy);
    await this.move(this.position.x+(length>24?dx/length*24:24),this.position.y+(length>24?dy/length*24:0),Math.min(100,this.timing.drag));
    await this.page.waitForFunction(()=>studio.dragMotion?.active,null,{timeout:2000});
    // Native clone/focus may have scrolled the workspace at gesture start.
    dest=await this.destination(place,source);
    const view=await this.page.evaluate(()=>({area:studio.codeArea(),x:studio.workspace.scrollX,y:studio.workspace.scrollY}));
    const end={x:Math.max(view.area.left+30,Math.min(view.area.right-30,dest.x)),y:Math.max(view.area.top+30,Math.min(view.area.bottom-30,dest.y))};
    const pan={x:end.x-dest.x,y:end.y-dest.y};
    const duration=Math.max(this.timing.drag,Math.min(6000,this.timing.drag*Math.sqrt(1+Math.hypot(pan.x,pan.y)/500)));
    const start={...this.position},steps=Math.max(1,Math.ceil(duration/33));
    for(let i=1;i<=steps;i++){
      const t=i/steps,e=t*t*(3-2*t);
      if(pan.x||pan.y)await this.page.evaluate(({x,y})=>studio.dragMotion.scrollTo(x,y),{x:view.x+pan.x*e,y:view.y+pan.y*e});
      await this.move(start.x+(end.x-start.x)*e,start.y+(end.y-start.y)*e,0);
      await this.pause(duration/steps);
    }
  }
  async verifyConnection(id,place) {
    if(!place?.after&&!place?.parent) return;
    const parent=this.resolve(place.after||place.parent),input=place.input?this.mappedInput(place.parent,place.input):null;
    const ok=await this.page.evaluate(({id,parent,input})=>{
      const b=studio.workspace.getBlockById(parent);return (input?b.getInputTargetBlock(input):b.getNextBlock())?.id===id;
    },{id,parent,input});
    if(!ok) throw new Error(`ドラッグ後の接続が一致しません: ${id} → ${parent}${input?' / '+input:''}`);
  }
  async addArgument(a) {
    const name=a.fields.VALUE[0];
    const source=await this.page.evaluate(({name,opcode})=>{
      const b=studio.workspace.getAllBlocks(false).find(b=>b.type===opcode&&b.getFieldValue('VALUE')===name&&b.getParent()?.type==='procedures_prototype');
      if(!b) throw new Error(`定義の引数が見つかりません: ${name}`);return b.id;
    },{name,opcode:a.opcode});
    await this.ensureVisible(source);
    return this.dragNew(a,{id:source,flyout:false});
  }
  async moveBlock(id,place) {
    id=this.resolve(id);
    await this.ensureVisible(id);
    const source=await this.prepareSource(id,false);
    await this.dragWithSnap({sourceId:id,blockId:id,source},place,()=>this.moveHeldBlock(place,source));
    await this.waitForDrop(id);await this.verifyConnection(id,place);return {id};
  }
  async waitForDrop(id) {
    // Blockly flushes its events to the VM asynchronously. Continue when the
    // dropped block is committed instead of pausing a fixed 150–180 ms.
    await this.page.waitForFunction(id=>{
      const w=studio.workspace,b=w.getBlockById(id),vm=studio.vm.editingTarget.blocks.getBlock(id);
      return !!b&&!!vm&&!w.getGesture()?.getCurrentDragger()&&
        (vm.parent??null)===(b.getParent()?.id??null)&&
        (vm.next??null)===(b.getNextBlock()?.id??null);
    },id,{polling:'raf',timeout:5000});
  }
  async execute(a) {
    switch(a.type) {
      case 'tab.select':return this.selectTab(a.tab);
      case 'costume.add':return this.addAsset('costume',a);
      case 'sound.add':return this.addAsset('sound',a);
      case 'costume.select':return this.selectCostume(a.index);
      case 'target.select':return this.selectTarget(a.target,a.isStage);
      case 'variable.create':return this.createVariable(a);
      case 'procedure.create':return this.createProcedure(a);
      case 'block.add':return this.addBlock(a);
      case 'block.input':return this.input(a);
      case 'block.field':return this.field(a);
      case 'block.move':return this.moveBlock(a.block,a.place);
      case 'block.delete': {const id=this.resolve(a.block);await this.ensureVisible(id);await this.page.evaluate(id=>studio.workspace.getBlockById(id).select(),id);await this.page.keyboard.press('Delete');return;}
      case 'category.select':return this.category(a.category);
      case 'mouse.move':return this.move(a.x,a.y,a.duration);
      case 'mouse.click':await this.move(a.x,a.y);return this.page.mouse.click(a.x,a.y,{button:a.button||'left'});
      case 'mouse.down':return this.page.mouse.down();
      case 'mouse.up':return this.page.mouse.up();
      case 'mouse.wheel':return this.page.mouse.wheel(a.dx||0,a.dy||0);
      case 'keyboard.type':return this.type(a.text,a.replace??false);
      case 'keyboard.press':return this.page.keyboard.press(a.key);
      case 'wait':return this.pause(Math.min(a.ms||0,60000));
      case 'project.start':return this.click(this.page.locator('[class*="green-flag_green-flag"]').first());
      case 'project.stop':return this.click(this.page.locator('[class*="stop-all_stop-all"]').first());
      case 'workspace.zoom':return this.page.evaluate(s=>studio.workspace.setScale(s),a.scale);
      case 'view.configure':return this.configureView(a);
      case 'workspace.focus':return this.ensureVisible(this.resolve(a.block));
      case 'broadcast.create':return this.createBroadcast(a);
      default:throw new Error(`未対応の操作です: ${a.type}`);
    }
  }
  async createBroadcast(a) {
    if(a.sourceId)this.broadcastNames.set(a.sourceId,a.name);
    if(!a.block)return {deferred:true,name:a.name};
    const opcode=await this.page.evaluate(id=>studio.workspace.getBlockById(id)?.type,this.resolve(a.block));
    return this.field({block:a.block,input:a.input||(opcode==='event_whenbroadcastreceived'?undefined:'BROADCAST_INPUT'),field:'BROADCAST_OPTION',value:a.name,referenceId:a.sourceId});
  }
}
function escapeRegExp(s) {return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
