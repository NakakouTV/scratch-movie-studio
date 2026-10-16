import {framing,assertions,ms} from './presentation-schema.mjs';
export const PRESENTATION_OPERATIONS=['view.focus','state.assert','presentation.hold'];
export async function presentationHold(c,a){
 const duration=ms(a.ms),mode=a.mode??'live';if(!['live','freeze'].includes(mode))throw new Error('保持のmodeはlive / freezeです。');
 if(c.presentation)return c.presentation.keep(duration,mode,'explicit');
 if(mode==='freeze'&&!c.recorder?.accepting)throw new Error('freezeには録画中のカットまたはセッションが必要です。');
 await c.settleCursor(true);if(mode==='freeze')await c.recorder.setFrozen(true);
 try{for(let left=duration;left>0;left-=50){if(c.options.shouldCancel?.())throw new Error('撮影を中止しました。');await c.pause(Math.min(left,50));}}finally{if(mode==='freeze')await c.recorder.setFrozen(false);}
}

export async function focusSubject(c,value){
 const spec=framing(value);if(!spec)return null;
 if(spec.editorZoom!==undefined)await c.configureView({editorZoom:spec.editorZoom});
 if(['block','definition','input'].includes(spec.kind)){
  await c.execute({type:'stage.view',mode:'editor'});if(spec.target!==undefined)await c.selectTarget(spec.target,spec.isStage);await c.selectTab('code');
  await c.configureView({minScale:spec.scale});await c.page.evaluate(s=>studio.workspace.setScale(s),spec.scale);
  if(spec.block)spec.block=c.resolve(spec.block);
  await c.page.evaluate(async({spec,duration})=>{
   const subject=studio.subject(spec);if(!subject)return;const r=subject.box,a=studio.codeArea();
   if(r.width>a.right-a.left||r.height>a.bottom-a.top)throw new Error('説明対象が構図に収まりません。倍率・対象範囲を変更してください。');
   if(spec.move==='center'||r.x<a.left||r.y<a.top||r.x+r.width>a.right||r.y+r.height>a.bottom)await studio.pan((a.left+a.right-r.width)/2-r.x,(a.top+a.bottom-r.height)/2-r.y,duration);
  },{spec,duration:spec.duration??c.timing.pan??250});
 }else if(spec.kind==='costumeName'){
  if(spec.target!==undefined)await c.selectTarget(spec.target,spec.isStage);await c.selectTab('costumes');
 }
 const result=await c.page.evaluate(spec=>studio.subject(spec),spec);
 if(result&&spec.minTextPx&&result.fontPx<spec.minTextPx)throw new Error(`説明対象の文字が小さすぎます（${Math.round(result.fontPx)}px）。scale / editorZoom、または対象範囲を変更してください。`);
 if(result){const z=result.editorZoom;result.screenBox=Object.fromEntries(Object.entries(result.box).map(([k,v])=>[k,v*z]));}
 return result;
}
export async function assertState(c,checks){
 checks=assertions(checks).map(s=>({...s,...(s.block?{block:s.target?(c.aliases.get(`${s.target}\0${s.block}`)||s.block):c.resolve(s.block)}:{}),...(s.id?{id:c.variableRefs.get(s.id)||s.id}:{}),...(s.conditions?{conditions:s.conditions.map(v=>({...v,...(v.id?{id:c.variableRefs.get(v.id)||v.id}:{})}))}:{})}));
 const results=await c.page.evaluate(s=>studio.assertPresentation(s),checks);
 if(results.some(r=>!r.matched))throw new Error('説明の開始・終了状態が一致しません: '+JSON.stringify(results.filter(r=>!r.matched)).slice(0,2500));return results;
}

export class Presentation {
 constructor(c,recorder,recipe,hold){this.c=c;this.recorder=recorder;this.recipe=recipe;this.hold=hold;this.events=[];this.warnings=[];this.beat=null;this.action=null;this.used=new Set();}
 now(){return Math.max(0,Date.now()-this.recorder.origin*1000);}
 event(type,data={}){const atMs=this.now();const e={type,atMs,frame:Math.round(atMs*30/1000),beat:this.beat?.id??null,text:this.beat?.text??'',...data};this.events.push(e);return e;}
 async check(checks,when){if(!checks?.length)return;const results=await assertState(this.c,checks);this.event('assert',{when,results});}
 recordFocus(target){this.event('focus',{target});if(target){const r=target.screenBox;if(r.x<0||r.y<0||r.x+r.width>1920||r.y+r.height>1080)this.warnings.push({type:'target-clipped',beat:this.beat?.id,target});if(r.y+r.height>1080-this.c.subtitleMargin)this.warnings.push({type:'subtitle-overlap',beat:this.beat?.id,target});if(target.fontPx<14)this.warnings.push({type:'small-text',beat:this.beat?.id,fontPx:target.fontPx});}return target;}
 async frame(spec){if(spec)return this.recordFocus(await focusSubject(this.c,spec));}
 async keep(ms,mode='live',reason='confirmation'){
  if(!ms)return;if(!await this.c.page.evaluate(()=>!!studio.dragMotion?.active))await this.c.settleCursor(true);const event=this.event('hold-start',{mode,reason,durationMs:ms});
  if(mode==='freeze')await this.recorder.setFrozen(true);
  try{await this.hold(ms);}finally{if(mode==='freeze')await this.recorder.setFrozen(false);}
  this.event('hold-end',{mode,reason,fromFrame:event.frame});
 }
 async cue(spec,label){
  if(!spec)return;await this.frame(spec.framing);await this.check(spec.check,label);await this.keep(spec.holdMs,spec.mode,label);
  if(spec.atMs!==undefined){
   if(spec.atMs>this.now()){
    if(!await this.c.page.evaluate(()=>!!studio.dragMotion?.active))await this.c.settleCursor(true);
    this.event('hold-start',{mode:'live',reason:'sync',durationMs:Math.max(0,spec.atMs-this.now())});
    // Wait against the absolute video clock. Preparation/CDP time must not be
    // added to a relative sleep, otherwise every marker can drift late.
    for(let left=spec.atMs-this.now();left>0;left=spec.atMs-this.now())await this.hold(Math.min(left,left>100?50:10));
    this.event('hold-end',{mode:'live',reason:'sync'});
   }
   const actual=this.now(),lateMs=actual-spec.atMs;this.event('marker',{marker:spec.at??null,label,plannedMs:spec.atMs,lateMs});if(lateMs>this.recipe.sync.toleranceMs){const issue={type:'late-marker',label,lateMs,plannedMs:spec.atMs};this.warnings.push(issue);if(this.recipe.sync.late==='error')throw new Error(`音声の目印に間に合いません: ${spec.at??label}（${Math.round(lateMs)}ms遅れ）。準備・目印・操作時間を調整してください。`);}
  }
 }
 async phase(name){
  if(!this.action)return;this.phaseName=name;const before=name==='before'||name.endsWith('.before');if(!before)this.event('phase',{phase:name,action:this.action.type});const spec=this.action.cues?.[name];if(spec){this.used.add(name);await this.cue(spec,name);}if(before)this.event('phase',{phase:name,action:this.action.type});
 }
 async actionRun(a,index){
  this.action=a;this.used=new Set();const saved={...this.c.timing},samples=[],oldSample=this.c.options.onDragSample,view=await this.c.page.evaluate(()=>({x:studio.workspace.scrollX,y:studio.workspace.scrollY}));this.c.options.onDragSample=s=>samples.push(s);this.c.timing={...saved,...a.timing};
  this.event('action-start',{index,action:a.type});let success=false,error;
  try{const result=await this.c.execute(a);if(a.type==='view.focus')this.recordFocus(result);if(a.type==='state.assert')this.event('assert',{when:'explicit',results:result});const missing=Object.keys(a.cues??{}).filter(k=>!this.used.has(k));if(missing.length)throw new Error('操作で指定した節目を通りませんでした: '+missing.join(', '));success=true;}
  catch(e){error=e.message;throw e;}
  finally{this.c.timing=saved;this.c.options.onDragSample=oldSample;const gaps=samples.slice(1).map((s,i)=>s.time-samples[i].time),maxGapMs=gaps.length?Math.max(...gaps):0;this.event('action-end',{index,action:a.type,success,error,dragSamples:samples.length,maxDragGapMs:maxGapMs});if(maxGapMs>160)this.warnings.push({type:'drag-event-gap',beat:this.beat?.id,index,maxGapMs});this.action=null;}
  const after=await this.c.page.evaluate(()=>({x:studio.workspace.scrollX,y:studio.workspace.scrollY})),distance=Math.hypot(view.x-after.x,view.y-after.y)*this.c.editorZoom;
  if(distance>800)this.warnings.push({type:'long-pan',beat:this.beat?.id,index,distancePx:distance});
 }
 async run(actions,beats){
  const old=this.c.options.onPhase,oldPresentation=this.c.presentation;this.c.options.onPhase=name=>this.phase(name);this.c.presentation=this;
  try{
   if(!beats.length){for(const [i,a] of actions.entries())await this.actionRun(a,i+1);return;}
   for(const b of beats){
    this.beat=b;this.event('beat-start');const saved={...this.c.timing};this.c.timing={...saved,...b.timing};
    try{
     await this.check(b.before,'before');await this.frame(b.framing);await this.keep(b.beforeMs,b.mode,'before');await this.cue({...b,framing:null},b.id);
     for(const [i,a] of b.actions.entries())await this.actionRun(a,i+1);
     await this.check(b.after,'after');await this.frame(b.endFraming);await this.keep(b.afterMs,b.mode,'after');
     if(b.afterMs<250)this.warnings.push({type:'short-result-hold',beat:b.id,durationMs:b.afterMs});this.event('beat-end');
    }finally{this.c.timing=saved;}
   }
  }finally{this.c.options.onPhase=old;this.c.presentation=oldPresentation;this.beat=null;}
 }
 report(){return {version:1,fps:30,clock:'recording-start',events:this.events,warnings:this.warnings};}
 csv(){const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';return '\ufeff'+['type,atMs,frame,beat,text,phase,marker,plannedMs,lateMs,target',...this.events.map(e=>[e.type,Math.round(e.atMs),e.frame,e.beat,e.text,e.phase,e.marker,e.plannedMs,e.lateMs,e.target?JSON.stringify(e.target.screenBox):''].map(cell).join(','))].join('\r\n');}
}
