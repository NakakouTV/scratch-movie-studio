// Unlike canonicalProject (comparison only), this view preserves source IDs
// and connections. These IDs are also the aliases used by buildPlan.
const categories={event:'events',control:'control',motion:'motion',looks:'looks',sound:'sound',sensing:'sensing',operator:'operators',data:'variables',procedures:'myBlocks',argument:'myBlocks',pen:'pen'};
const literalTypes={4:'number',5:'positive-number',6:'whole-number',7:'integer',8:'angle',9:'colour',10:'text',11:'broadcast'};

export function projectStructure(project){
  const stage=project.targets.find(t=>t.isStage);
  const targets=project.targets.map(target=>{
    const originals=target.blocks||{},nodes=new Map();
    const reference=(id,kind)=>{
      const key=kind==='list'?'lists':kind==='broadcast'?'broadcasts':'variables';
      const owner=[target,stage].find(t=>t&&Object.hasOwn(t[key]||{},id));
      return {id,kind,target:owner?.name??null,scope:owner?(owner.isStage?'global':'local'):null};
    };
    function node(id,block,parent=null){
      if(Array.isArray(block)){
        const list=block[0]===13;
        return {id,opcode:list?'data_listcontents':'data_variable',category:'variables',parent,next:null,topLevel:parent===null,shadow:false,synthetic:!!parent,
          fields:{[list?'LIST':'VARIABLE']:{value:block[1],reference:reference(block[2],list?'list':'variable')}},inputs:{},
          position:parent===null?{x:block[3]??0,y:block[4]??0}:null};
      }
      const fields=Object.fromEntries(Object.entries(block.fields||{}).map(([name,value])=>[name,{value:value[0],...(value[1]?{reference:reference(value[1],name==='LIST'?'list':name==='BROADCAST_OPTION'?'broadcast':'variable')}:{})}]));
      return {id,opcode:block.opcode,category:categories[block.opcode.split('_')[0]]||null,parent:block.parent??null,next:block.next??null,
        topLevel:!!block.topLevel,shadow:!!block.shadow,synthetic:false,fields,inputs:{},
        position:block.topLevel?{x:block.x??0,y:block.y??0}:null,...(block.mutation?{mutation:structuredClone(block.mutation)}:{})};
    }
    for(const [id,b] of Object.entries(originals))nodes.set(id,node(id,b));
    function inputValue(value,parent,input,active){
      if(value===null||value===undefined)return null;
      if(typeof value==='string')return {kind:'block',id:value};
      if(!Array.isArray(value))throw new Error(`入力構造が不正です: ${parent}/${input}`);
      if(value[0]===12||value[0]===13){
        // Matches the alias assigned to compact reporters by buildPlan.
        if(active){
          const id=`${parent}::${input}`;
          if(nodes.has(id))throw new Error(`入力ブロックIDが重複しています: ${id}`);
          nodes.set(id,node(id,value,parent));return {kind:'block',id};
        }
        return {kind:'reference',value:value[1],reference:reference(value[2],value[0]===13?'list':'variable')};
      }
      return {kind:'literal',type:literalTypes[value[0]]||'unknown',value:value[1],...(value[0]===11?{reference:reference(value[2],'broadcast')}:{})};
    }
    for(const [id,b] of Object.entries(originals))if(!Array.isArray(b)){
      nodes.get(id).inputs=Object.fromEntries(Object.entries(b.inputs||{}).map(([name,v])=>[name,{mode:v[0],value:inputValue(v[1],id,name,true),fallback:v[0]===3?inputValue(v[2],id,name,false):null}]));
    }
    const scripts=[...nodes.values()].filter(b=>b.topLevel&&!b.shadow).map(b=>({id:b.id,rootBlockId:b.id,trigger:b.opcode.startsWith('event_')?b.opcode:null,kind:b.opcode==='procedures_definition'?'procedure':'script'}));
    const procedures=scripts.filter(s=>s.kind==='procedure').map(s=>{
      const prototypeId=nodes.get(s.id).inputs.custom_block?.value?.id,prototype=nodes.get(prototypeId);
      const mutation=prototype?.mutation||{};
      return {id:s.id,prototypeId,proccode:mutation.proccode??null,argumentIds:JSON.parse(mutation.argumentids||'[]'),argumentNames:JSON.parse(mutation.argumentnames||'[]'),warp:String(mutation.warp)==='true',
        callBlockIds:[...nodes.values()].filter(b=>b.opcode==='procedures_call'&&b.mutation?.proccode===mutation.proccode).map(b=>b.id)};
    });
    return {name:target.name,isStage:!!target.isStage,selectAction:{type:'target.select',target:target.name,isStage:!!target.isStage},
      scripts,blocks:[...nodes.values()],procedures,
      variables:Object.entries(target.variables||{}).map(([id,v])=>({id,name:v[0],initialValue:v[1],cloud:!!v[2],scope:target.isStage?'global':'local'})),
      lists:Object.entries(target.lists||{}).map(([id,v])=>({id,name:v[0],initialValue:v[1],scope:target.isStage?'global':'local'})),
      broadcasts:Object.entries(target.broadcasts||{}).map(([id,name])=>({id,name})),
      costumes:(target.costumes||[]).map((c,index)=>({index,name:c.name,dataFormat:c.dataFormat})),
      sounds:(target.sounds||[]).map((s,index)=>({index,name:s.name,dataFormat:s.dataFormat}))};
  });
  return {version:1,idScope:'target',extensions:project.extensions||[],targets};
}
