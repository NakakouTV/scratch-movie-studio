import JSZip from 'jszip';
import {createHash} from 'node:crypto';

const emptySvg='<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>';
export const EMPTY_COSTUME={name:'準備用（追加後に削除）',assetId:createHash('md5').update(emptySvg).digest('hex'),dataFormat:'svg',bitmapResolution:1,rotationCenterX:1,rotationCenterY:1};
EMPTY_COSTUME.md5ext=EMPTY_COSTUME.assetId+'.svg';

export async function readSb3(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file('project.json');
  if (!entry) throw new Error('project.json がないため、sb3として読み込めません。');
  if (entry._data?.uncompressedSize > 20*1024*1024) throw new Error('project.json が大きすぎます。');
  const project = JSON.parse(await entry.async('string'));
  if (!Array.isArray(project.targets) || !project.targets.some(t=>t.isStage)) throw new Error('Scratch 3 のプロジェクトを指定してください。');
  return {zip,project};
}

export async function blankProject(buffer,{assets=false}={}) {
  const {zip,project} = await readSb3(buffer);
  for (const t of project.targets) {
    t.blocks={}; t.variables={}; t.lists={}; t.broadcasts={}; t.comments={};
    if(assets){t.costumes=[{...EMPTY_COSTUME}];t.sounds=[];t.currentCostume=0;}
  }
  project.monitors=[];
  if(assets)zip.file(EMPTY_COSTUME.md5ext,emptySvg);
  zip.file('project.json',JSON.stringify(project));
  return zip.generateAsync({type:'nodebuffer'});
}

export function buildPlan(project,{assets=false}={}) {
  const actions=[], warnings=[],scenes=[];
  const scene=(title,kind,target)=>scenes.push({title:title.slice(0,200),kind,target,from:actions.length+1});
  const emit=(type,args)=>actions.push({type,...args});
  for (const target of project.targets) {
    const blocks=target.blocks || {};
    scene(`${target.name} · ${assets?'素材の追加':'準備'}`,assets?'assets':'setup',target.name);
    emit('target.select',{target:target.name,isStage:target.isStage});
    if(assets){
      for(const [assetIndex,c] of (target.costumes||[]).entries())emit('costume.add',{assetIndex,name:c.name});
      if(target.costumes?.length)emit('costume.select',{index:target.currentCostume||0});
      for(const [assetIndex,s] of (target.sounds||[]).entries())emit('sound.add',{assetIndex,name:s.name});
      emit('tab.select',{tab:'code'});
    }
    scene(`${target.name} · 変数・リスト`,'variables',target.name);
    for (const [id,v] of Object.entries(target.variables || {})) {
      if(v[2]) warnings.push(`クラウド変数「${v[0]}」はローカル変数として作成します。`);
      emit('variable.create',{sourceId:id,name:v[0],scope:target.isStage?'global':'local',value:v[1],monitor:project.monitors?.find(m=>m.id===id)||{visible:false}});
    }
    for (const [id,v] of Object.entries(target.lists || {})) emit('variable.create',{sourceId:id,name:v[0],scope:target.isStage?'global':'local',kind:'list',value:v[1],monitor:project.monitors?.find(m=>m.id===id)||{visible:false}});
    // Broadcasts are created by block.field on the first real send/receive
    // block. Scratch may delete unused names when a temporary block is removed.
    const roots=Object.entries(blocks).filter(([,b])=>Array.isArray(b)?b.length>=5:b.topLevel&&!b.shadow)
      .sort((a,b)=>(a[1].y??a[1][4]??0)-(b[1].y??b[1][4]??0)||(a[1].x??a[1][3]??0)-(b[1].x??b[1][3]??0));
    for (const [id,b] of roots.filter(([,b])=>b.opcode==='procedures_definition')) {
      const proto=blocks[b.inputs.custom_block?.[1]];
      if (!proto?.mutation) throw new Error(`定義ブロック ${id} の構造が不正です。`);
      scene(`${target.name} · 定義「${proto.mutation.proccode}」を作成`,'definition',target.name);
      emit('procedure.create',{sourceId:id,prototypeId:b.inputs.custom_block[1],mutation:proto.mutation,x:b.x||40,y:b.y||40});
    }
    const seen=new Set();
    function visit(id,place) {
      if (seen.has(id)) throw new Error(`循環または重複したブロック接続です: ${id}`);
      seen.add(id);
      const b=blocks[id];
      if (!b) throw new Error(`接続先ブロックがありません: ${id}`);
      if(Array.isArray(b)) {
        emit('block.add',{sourceId:id,opcode:b[0]===12?'data_variable':'data_listcontents',fields:{[b[0]===12?'VARIABLE':'LIST']:[b[1],b[2]]},place:place||{x:b[3]||40,y:b[4]||40}});return;
      }
      if(b.shadow || b.opcode==='procedures_prototype') return;
      if(b.opcode!=='procedures_definition') emit('block.add',{sourceId:id,opcode:b.opcode,mutation:b.mutation,fields:b.fields,place:place||{x:b.x||40,y:b.y||40}});
      for (const [field,value] of Object.entries(b.fields||{})) emit('block.field',{block:id,field,value:value[0],referenceId:value[1]});
      for (const [name,input] of Object.entries(b.inputs||{})) {
        if(name==='custom_block') continue;
        const active=input[1],fallback=input[2];
        // Enter literals before dropping reporters, retaining the original hidden shadow.
        const shadow=input[0]===3?fallback:active;
        if(Array.isArray(shadow)&&shadow[0]===11) emit('block.field',{block:id,input:name,field:'BROADCAST_OPTION',value:String(shadow[1]??''),referenceId:shadow[2]});
        else if(Array.isArray(shadow)&&shadow[0]<12) emit('block.input',{block:id,input:name,value:String(shadow[1]??'')});
        else if(typeof shadow==='string'&&blocks[shadow]?.shadow) {
          for(const [field,v] of Object.entries(blocks[shadow].fields||{})) emit('block.field',{block:id,input:name,field,value:v[0],referenceId:v[1]});
        }
        if(typeof active==='string'&&!blocks[active]?.shadow) visit(active,{parent:id,input:name});
        else if(Array.isArray(active)&&active[0]>=12) emit('block.add',{sourceId:`${id}::${name}`,opcode:active[0]===12?'data_variable':'data_listcontents',fields:{[active[0]===12?'VARIABLE':'LIST']:[active[1],active[2]]},place:{parent:id,input:name}});
      }
      if(b.next) visit(b.next,{after:id});
    }
    for (const [index,[id,b]] of roots.entries()) {
      const name=b.opcode==='procedures_definition'?`定義「${blocks[b.inputs.custom_block[1]].mutation.proccode}」の処理`:`スクリプト ${index+1}`;
      scene(`${target.name} · ${name}`,'script',target.name);visit(id);
    }
    if(Object.keys(target.comments||{}).length) warnings.push(`「${target.name}」のコメント作成アニメーションは未対応です。`);
  }
  const ranges=scenes.map((s,i)=>({...s,to:(scenes[i+1]?.from??actions.length+1)-1})).filter(s=>s.from<=s.to).map((s,i)=>({id:`scene-${i+1}`,...s,enabled:true}));
  return {version:1,editorVersion:'15.1.1',settings:{width:1920,height:1080,fps:30,locale:'ja',animateAssets:assets},warnings,actions,scenes:ranges};
}

// Compare program meaning, not generated block, variable, argument IDs or editor coordinates.
export function canonicalProject(project) {
  const owner=id=>project.targets.find(t=>Object.hasOwn(t.variables||{},id)||Object.hasOwn(t.lists||{},id))?.name||null;
  return project.targets.map(t=>{
    const blocks=t.blocks||{};
    function node(ref,visited=new Set()) {
      if(ref===null||ref===undefined) return null;
      if(Array.isArray(ref)) {
        if(ref[0]===12||ref[0]===13) return {opcode:ref[0]===12?'data_variable':'data_listcontents',fields:{[ref[0]===12?'VARIABLE':'LIST']:String(ref[1])},references:{[ref[0]===12?'VARIABLE':'LIST']:owner(ref[2])},inputs:{},next:null};
        return {literal:String(ref[1]??'')};
      }
      const b=blocks[ref]; if(!b) throw new Error(`Missing block: ${ref}`);
      if(Array.isArray(b)) return node(b,visited);
      if(visited.has(ref)) throw new Error('Cyclic block graph');
      const nextVisited=new Set(visited).add(ref);
      const fields=Object.fromEntries(Object.entries(b.fields||{}).map(([k,v])=>[k,String(v[0]??'')]));
      const references=Object.fromEntries(Object.entries(b.fields||{}).filter(([k])=>k==='VARIABLE'||k==='LIST').map(([k,v])=>[k,owner(v[1])]));
      const inputs={};
      const argIds=b.opcode==='procedures_call'?JSON.parse(b.mutation.argumentids||'[]'):[];
      for(const [name,v] of Object.entries(b.inputs||{})) {
        if(name==='custom_block') continue;
        inputs[argIds.includes(name)?`arg${argIds.indexOf(name)}`:name]=node(v[1],nextVisited);
      }
      let mutation;
      if(b.opcode==='procedures_definition') {
        const m=blocks[b.inputs.custom_block[1]].mutation;
        mutation={proccode:m.proccode,argumentnames:JSON.parse(m.argumentnames||'[]'),warp:String(m.warp)};
      } else if(b.opcode==='procedures_call') mutation={proccode:b.mutation.proccode,warp:String(b.mutation.warp)};
      else if(b.mutation) {mutation={...b.mutation};delete mutation.tagName;delete mutation.children;}
      // A stop block has no next connector by default. Scratch may omit the
      // explicit false flag when serializing an otherwise identical block.
      if(b.opcode==='control_stop'&&mutation?.hasnext==='false'){
        delete mutation.hasnext;if(!Object.keys(mutation).length)mutation=undefined;
      }
      return {opcode:b.opcode,fields,...(Object.keys(references).length?{references}:{}),inputs,...(mutation?{mutation}:{}),next:node(b.next,nextVisited)};
    }
    const scripts=Object.entries(blocks).filter(([,b])=>Array.isArray(b)?b.length>=5:b.topLevel&&!b.shadow).map(([id])=>node(id));
    const sort=a=>a.sort((x,y)=>JSON.stringify(x).localeCompare(JSON.stringify(y)));
    return {name:t.name,isStage:t.isStage,currentCostume:t.currentCostume||0,scripts:sort(scripts),
      variables:sort(Object.values(t.variables||{}).map(v=>[v[0],String(v[1])])),
      lists:sort(Object.values(t.lists||{})),
      costumes:(t.costumes||[]).map(c=>({name:c.name,md5ext:c.md5ext,rotationCenterX:c.rotationCenterX,rotationCenterY:c.rotationCenterY,bitmapResolution:c.bitmapResolution})),
      sounds:(t.sounds||[]).map(s=>({name:s.name,md5ext:s.md5ext}))};
  });
}

export function compareProjects(expected,actual) {
  const a=canonicalProject(expected),b=canonicalProject(actual),differences=[];
  function compare(x,y,p) {
    if(JSON.stringify(x)===JSON.stringify(y)) return;
    if(x&&y&&typeof x==='object'&&typeof y==='object') {
      for(const k of new Set([...Object.keys(x),...Object.keys(y)])) compare(x[k],y[k],`${p}.${k}`);
    } else differences.push({path:p,expected:x,actual:y});
  }
  compare(a,b,'targets');
  return {ok:differences.length===0,differences};
}
