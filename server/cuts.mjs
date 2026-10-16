import fs from 'node:fs/promises';
import path from 'node:path';
import {JobRunner,atomicJSON} from './jobs.mjs';
import {EditorController,subtitleMargin,editorZoom} from './controller.mjs';
import {blankProject} from './project.mjs';
import {Recorder} from './recorder.mjs';
import {presentation,framing} from './presentation-schema.mjs';
import {Presentation,focusSubject} from './presentation.mjs';

export function normalizeCut(input,operations){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('カット設定はオブジェクトで指定してください。');
  const number=(value,fallback,min,max,name)=>{const n=value??fallback;if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw new Error(`${name}は${min}〜${max}です。`);return n;};
  const title=input.title??'カット';if(typeof title!=='string'||!title.trim()||title.length>200)throw new Error('カット名は1〜200文字です。');
  const start=input.start??'project';if(!['project','blank'].includes(start))throw new Error('開始状態はproject / blankです。');
  if(input.clearAssets!==undefined&&typeof input.clearAssets!=='boolean')throw new Error('clearAssetsはtrue / falseです。');
  if(input.clearAssets&&start!=='blank')throw new Error('素材を空にする場合はstart: blankを指定してください。');
  const speed=number(input.speed,1,.25,10,'速度');
  return {version:2,title:title.trim(),start,clearAssets:input.clearAssets??false,subtitleMargin:subtitleMargin(input.subtitleMargin),editorZoom:editorZoom(input.editorZoom),...presentation(input,operations),setupSpeed:number(input.setupSpeed,speed,.25,10,'準備の速度'),framing:framing(input.framing),endFraming:framing(input.endFraming),speed,beforeMs:number(input.beforeMs,500,0,30000,'前の余白'),afterMs:number(input.afterMs,1000,0,30000,'後の余白')};
}

export class CutRunner extends JobRunner {
  async prepare(job,buffer,recipe){
    const directory=this.directory(job.id);await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(path.join(directory,'source.sb3'),buffer);await atomicJSON(path.join(directory,'cut.json'),recipe);
    job.kind='cut';job.checkpointable=false;job.resumable=false;await this.persist(job);
  }
  async run(job){
    const directory=this.directory(job.id);let c,recorder,presentationRun,finalStatus='failed';const log=[];
    const artifact=name=>job.artifacts.push({name,url:`/outputs/${job.id}/${name}`});
    const check=()=>{if(job.cancelled)throw new Error('撮影を中止しました。');if(recorder?.error)throw recorder.error;};
    const hold=async ms=>{for(let left=ms;left>0;left-=100){check();await c.pause(Math.min(100,left));}};
    const perform=async(actions,phase)=>{job.phase=phase;job.step=0;job.total=actions.length;for(const action of actions){check();job.current=`${phase==='setup'?'準備（録画外）':'撮影'} · ${action.type}`;await c.execute(action);job.step++;log.push({phase,step:job.step,action});}};
    const frame=view=>focusSubject(c,view);
    try{
      const recipe=JSON.parse(await fs.readFile(path.join(directory,'cut.json'),'utf8')),source=await fs.readFile(path.join(directory,'source.sb3'));
      artifact('cut.json');artifact('source.sb3');
      const s=recipe.speed;c=job.controller=await new EditorController(this.baseURL,{shouldCancel:()=>job.cancelled,subtitleMargin:recipe.subtitleMargin,editorZoom:recipe.editorZoom,timing:{move:450/s,drag:750/s,type:75/s,pause:200/s}}).open();
      await c.setAssetSource(source);await c.load(source);if(recipe.start==='blank')await c.load(await blankProject(source,{assets:recipe.clearAssets}));
      const captureTiming={...c.timing,...recipe.timing},ss=recipe.setupSpeed??s;c.timing={move:450/ss,drag:750/ss,type:75/ss,pause:200/ss,...recipe.setupTiming};
      await perform(recipe.setup,'setup');c.timing=captureTiming;const initialTarget=await frame(recipe.framing);check();
      // Saving the start project is diagnostic; retakes replay preparation from
      // the original source so runtime state and aliases are never assumed saved.
      await fs.writeFile(path.join(directory,'start.sb3'),await c.save());artifact('start.sb3');
      await c.hideCursor();await c.page.screenshot({path:path.join(directory,'start.jpg')});artifact('start.jpg');
      recorder=new Recorder(c.page,directory);await recorder.start();presentationRun=new Presentation(c,recorder,{sync:{late:'error',toleranceMs:120},...recipe},hold);if(initialTarget)presentationRun.recordFocus(initialTarget);await hold(recipe.beforeMs);
      const beats=recipe.beats??[];job.phase='capture';job.step=0;job.total=beats.length?beats.reduce((n,b)=>n+b.actions.length,0):recipe.actions.length;
      const actionRun=presentationRun.actionRun.bind(presentationRun);presentationRun.actionRun=async(a,index)=>{check();job.current=`撮影 · ${presentationRun.beat?.text??a.type}`;await actionRun(a,index);job.step++;log.push({phase:'capture',step:job.step,action:a});};
      await presentationRun.run(recipe.actions,beats);await presentationRun.frame(recipe.endFraming);await c.settleCursor(true);await hold(recipe.afterMs);
      if(recipe.narration?.durationMs>presentationRun.now())await presentationRun.keep(recipe.narration.durationMs-presentationRun.now(),'live','narration-end');check();
      await recorder.stop();job.status='encoding';job.current='カットを保存中';await recorder.encode();check();
      await fs.writeFile(path.join(directory,'result.sb3'),await c.save());artifact('result.sb3');
      job.preview=path.join(directory,'preview.jpg');await c.page.screenshot({path:job.preview});artifact('preview.jpg');artifact('movie.mp4');artifact('recording.json');
      finalStatus='completed';job.current='カットの撮影が完了しました';
    }catch(e){finalStatus=job.cancelled?'cancelled':'failed';job.error=e.message;log.push({phase:job.phase,error:e.message});
      if(c?.page&&!c.page.isClosed()){job.preview=path.join(directory,'failure.jpg');await c.page.screenshot({path:job.preview}).then(()=>artifact('failure.jpg')).catch(()=>{});}
    }finally{
      if(presentationRun){await atomicJSON(path.join(directory,'timeline.json'),presentationRun.report());await fs.writeFile(path.join(directory,'timeline.csv'),presentationRun.csv());await atomicJSON(path.join(directory,'quality.json'),{version:1,warnings:presentationRun.warnings,scope:'semantic-target-and-action-log',note:'映像全体の自動認識による合否判定ではありません。'});artifact('timeline.json');artifact('timeline.csv');artifact('quality.json');job.warnings.push(...presentationRun.warnings.map(w=>w.type+(w.beat?' · '+w.beat:'')));}
      await recorder?.abort();await c?.close().catch(()=>{});job.controller=null;
      await atomicJSON(path.join(directory,'log.json'),log);artifact('log.json');job.finishedAt=new Date().toISOString();job.status=finalStatus;await this.persist(job);
    }
  }
}
