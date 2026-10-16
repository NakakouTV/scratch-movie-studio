import {waitSpecification} from './board-actions.mjs';
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
export const PHASES=['before','after','dialog.opened','name.before','name.entered','scope.before','scope.selected','create.before','definition.configured','created','target.visible','field.opened','value.before','value.entered','value.committed','option.selected','drop.before','drop.completed'];
export const ms=(v,fallback=0,max=60000)=>{v??=fallback;if(!Number.isFinite(v)||v<0||v>max)throw new Error(`時間は0〜${max}msです。`);return v;};
export function timing(v={}){
 if(!object(v))throw new Error('timingはオブジェクトです。');
 const result={};for(const key of Object.keys(v)){if(!['move','drag','type','pan','pause'].includes(key))throw new Error('timingはmove / drag / type / pan / pauseです。');result[key]=ms(v[key],0,key==='type'?1000:10000);}return result;
}
export function framing(v){
 if(v==null)return null;if(!object(v))throw new Error('構図はオブジェクトです。');
 const kind=v.kind??(v.input||v.field?'input':'block');
 if(!['block','definition','input','variableScope','variableName','costumeName','dialog','stage','monitor'].includes(kind))throw new Error('構図のkindが未対応です。');
 for(const key of ['target','block','input','field','name','id'])if(v[key]!==undefined&&(typeof v[key]!=='string'||!v[key]))throw new Error(`構図の${key}が不正です。`);
 if(v.isStage!==undefined&&typeof v.isStage!=='boolean')throw new Error('isStageはtrue / falseです。');
 if(v.editorZoom!==undefined&&(!Number.isFinite(v.editorZoom)||v.editorZoom<1||v.editorZoom>1.75))throw new Error('説明対象の全体倍率は1〜1.75です。');
 if(v.minTextPx!==undefined&&(!Number.isFinite(v.minTextPx)||v.minTextPx<8||v.minTextPx>48))throw new Error('minTextPxは8〜48pxです。');
 if(kind==='input'&&!v.block)throw new Error('入力欄の構図にはblockが必要です。');
 if(kind==='monitor'&&(!['global','local',undefined].includes(v.scope)||!['variable','list',undefined].includes(v.dataKind)||!v.name&&!v.id))throw new Error('モニターの構図にはscope・dataKindとname/idを指定してください。');
 const scale=v.scale??.8;if(!Number.isFinite(scale)||scale<.3||scale>1.5)throw new Error('構図の倍率は0.3〜1.5です。');
 const move=v.move??'if-needed';if(!['if-needed','center'].includes(move))throw new Error('構図のmoveはif-needed / centerです。');
 return {...v,kind,scale,move,...(v.duration===undefined?{}:{duration:ms(v.duration,250,10000)})};
}
export function assertions(v=[]){
 if(!Array.isArray(v)||v.length>100)throw new Error('状態検証は最大100件の配列です。');
 return v.map(s=>{
  if(!object(s)||!['variable','list','variables','lists','costumes','block','tab','target','running','runtime'].includes(s.type))throw new Error('状態検証のtypeが未対応です。');
  if(s.scope!==undefined&&!['global','local'].includes(s.scope))throw new Error('検証のscopeはglobal / localです。');
  if(s.exists!==undefined&&typeof s.exists!=='boolean')throw new Error('existsはtrue / falseです。');
  if(s.names!==undefined&&(!Array.isArray(s.names)||!s.names.every(n=>typeof n==='string')||new Set(s.names).size!==s.names.length))throw new Error('namesは重複のない名前の配列です。');
  if(['variables','lists','costumes'].includes(s.type)&&!Array.isArray(s.names))throw new Error('一覧の状態検証にはnamesが必要です。');
  if(s.exact!==undefined&&typeof s.exact!=='boolean')throw new Error('exactはtrue / falseです。');
  if(['variable','list'].includes(s.type)&&!(typeof s.id==='string'&&s.id)&&!(typeof s.name==='string'&&s.name))throw new Error('データの状態検証にはnameまたはidが必要です。');
  if(s.type==='block'&&(typeof s.block!=='string'||!s.block))throw new Error('ブロックの状態検証にはblockが必要です。');
  if(s.type==='runtime')return {...s,conditions:waitSpecification({conditions:s.conditions,timeoutMs:0,stableMs:0}).conditions};
  return structuredClone(s);
 });
}
function cue(v,markers){
 if(!object(v))throw new Error('節目の設定はオブジェクトです。');
 if(v.at!==undefined&&(!markers.has(v.at)))throw new Error('音声の目印がありません: '+v.at);
 if(v.at!==undefined&&v.atMs!==undefined&&v.atMs!==markers.get(v.at).atMs)throw new Error('atとatMsの時刻が一致しません。');
 if(v.mode!==undefined&&!['live','freeze'].includes(v.mode))throw new Error('保持のmodeはlive / freezeです。');
 return {...v,atMs:v.at===undefined?(v.atMs===undefined?undefined:ms(v.atMs,0,3600000)):markers.get(v.at).atMs,holdMs:ms(v.holdMs),mode:v.mode??'live',framing:framing(v.framing),check:assertions(v.check)};
}
export function presentation(input,operations){
 const narration=input.narration??{};if(!object(narration)||!Array.isArray(narration.markers??[]))throw new Error('narration.markersは目印の配列です。');
 if((narration.markers??[]).length>10000)throw new Error('目印は最大10000件です。');
 const markers=new Map();for(const m of narration.markers??[]){if(!object(m)||typeof m.id!=='string'||!m.id||markers.has(m.id)||m.text!==undefined&&typeof m.text!=='string')throw new Error('目印のidは一意な文字列です。');markers.set(m.id,{...m,atMs:ms(m.atMs,undefined,3600000)});}
 const sync=input.sync??{};if(!object(sync)||!['error','warn'].includes(sync.late??'error'))throw new Error('sync.lateはerror / warnです。');
 const normalizeActions=(list=[])=>{
  if(!Array.isArray(list)||list.length>10000)throw new Error('操作数が多すぎます。');
  return list.map(a=>{if(!object(a)||!operations.includes(a.type))throw new Error('未対応の操作です。');const cues={};if(a.cues!==undefined&&!object(a.cues))throw new Error('cuesは節目名のオブジェクトです。');for(const [phase,c] of Object.entries(a.cues??{})){if(!PHASES.includes(phase))throw new Error('未対応の操作の節目です: '+phase);cues[phase]=cue(c,markers);if(cues[phase].atMs!==undefined&&!['before','name.before','scope.before','create.before','value.before','drop.before'].includes(phase))throw new Error('音声目印は操作の直前の節目（*.before / before）へ指定してください。完了後の節目にはholdMsを使います。');}return {...a,...(a.cues?{cues}:{}),...(a.timing?{timing:timing(a.timing)}:{})};});
 };
 if(input.beats!==undefined&&(!Array.isArray(input.beats)||input.beats.length>1000))throw new Error('beatsは最大1000件の配列です。');
 if(input.beats?.length&&input.actions?.length)throw new Error('beatsとactionsは同時に指定できません。');
 const ids=new Set();const beats=(input.beats??[]).map((b,i)=>{
  if(!object(b))throw new Error('beatはオブジェクトです。');const id=b.id??`beat-${i+1}`;if(typeof id!=='string'||!id||ids.has(id))throw new Error('beatのidは一意にしてください。');ids.add(id);
  if(b.text!==undefined&&typeof b.text!=='string')throw new Error('beat.textは台本の文字列です。');
  return {...b,...cue(b,markers),id,text:b.text??'',actions:normalizeActions(b.actions),beforeMs:ms(b.beforeMs),afterMs:ms(b.afterMs),before:assertions(b.before),after:assertions(b.after),timing:timing(b.timing),endFraming:framing(b.endFraming)};
 });
 if(beats.reduce((n,b)=>n+b.actions.length,0)>10000)throw new Error('beatの合計操作数は10000件までです。');
 const setup=normalizeActions(input.setup);if(setup.some(a=>Object.keys(a.cues??{}).length))throw new Error('音声同期のcuesは録画する操作に指定してください。');
 return {narration:{markers:[...markers.values()],...(narration.durationMs===undefined?{}:{durationMs:ms(narration.durationMs,0,3600000)})},sync:{late:sync.late??'error',toleranceMs:ms(sync.toleranceMs,120,10000)},beats,actions:normalizeActions(input.actions),setup,timing:timing(input.timing),setupTiming:timing(input.setupTiming)};
}
