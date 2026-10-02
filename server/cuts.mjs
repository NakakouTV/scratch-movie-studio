import fs from 'node:fs/promises';
import path from 'node:path';
import {JobRunner,atomicJSON} from './jobs.mjs';
import {EditorController,subtitleMargin} from './controller.mjs';
import {blankProject} from './project.mjs';
import {Recorder} from './recorder.mjs';

export function normalizeCut(input,operations){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('カット設定はオブジェクトで指定してください。');
  const number=(value,fallback,min,max,name)=>{const n=value??fallback;if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw new Error(`${name}は${min}〜${max}です。`);return n;};
  const actions=(value,name)=>{const a=value??[];if(!Array.isArray(a)||a.length>10000||a.some(v=>!v||!operations.includes(v.type)))throw new Error(`${name}に未対応の操作があります。`);return a;};
  const framing=value=>{
    if(value===undefined)return null;
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('構図の指定が不正です。');
    if(value.target!==undefined&&typeof value.target!=='string')throw new Error('構図の対象名が不正です。');
    if(value.block!==undefined&&typeof value.block!=='string')throw new Error('構図のブロックIDが不正です。');
    if(value.isStage!==undefined&&typeof value.isStage!=='boolean')throw new Error('isStageはtrue / falseです。');
    return {target:value.target,isStage:value.isStage??false,block:value.block,scale:number(value.scale,0.8,0.3,1.5,'構図の倍率')};
  };
  const title=input.title??'カット';if(typeof title!=='string'||!title.trim()||title.length>200)throw new Error('カット名は1〜200文字です。');
  const start=input.start??'project';if(!['project','blank'].includes(start))throw new Error('開始状態はproject / blankです。');
  return {version:1,title:title.trim(),start,subtitleMargin:subtitleMargin(input.subtitleMargin),setup:actions(input.setup,'準備'),actions:actions(input.actions,'撮影'),framing:framing(input.framing??undefined),endFraming:framing(input.endFraming??undefined),speed:number(input.speed,1,0.25,10,'速度'),beforeMs:number(input.beforeMs,500,0,30000,'前の余白'),afterMs:number(input.afterMs,1000,0,30000,'後の余白')};
}

export class CutRunner extends JobRunner {
  async prepare(job,buffer,recipe){
    const directory=this.directory(job.id);await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(path.join(directory,'source.sb3'),buffer);await atomicJSON(path.join(directory,'cut.json'),recipe);
    job.kind='cut';job.checkpointable=false;job.resumable=false;await this.persist(job);
  }
  async run(job){
    const directory=this.directory(job.id);let c,recorder,finalStatus='failed';const log=[];
    const artifact=name=>job.artifacts.push({name,url:`/outputs/${job.id}/${name}`});
    const check=()=>{if(job.cancelled)throw new Error('撮影を中止しました。');if(recorder?.error)throw recorder.error;};
    const hold=async ms=>{for(let left=ms;left>0;left-=100){check();await c.pause(Math.min(100,left));}};
    const perform=async(actions,phase)=>{job.phase=phase;job.step=0;job.total=actions.length;for(const action of actions){check();job.current=`${phase==='setup'?'準備（録画外）':'撮影'} · ${action.type}`;await c.execute(action);job.step++;log.push({phase,step:job.step,action});}};
    const frame=async view=>{
      if(!view)return;
      await c.execute({type:'stage.view',mode:'editor'});
      if(view.target!==undefined)await c.selectTarget(view.target,view.isStage);
      await c.selectTab('code');await c.configureView({minScale:view.scale});
      await c.execute({type:'workspace.zoom',scale:view.scale});
      if(view.block){
        const id=c.resolve(view.block);
        await c.page.evaluate(async id=>{
          const w=studio.workspace,b=w.getBlockById(id);if(!b)throw new Error('構図のブロックがありません: '+id);
          const r=studio.box(b.getSvgRoot()),a=studio.codeArea();
          if(r.width>a.right-a.left||r.height>a.bottom-a.top)throw new Error('指定ブロック全体が構図に収まりません。倍率を下げるか別のブロックを指定してください。');
          await studio.pan((a.left+a.right-r.width)/2-r.x,(a.top+a.bottom-r.height)/2-r.y,0);
        },id);
      }
    };
    try{
      const recipe=JSON.parse(await fs.readFile(path.join(directory,'cut.json'),'utf8')),source=await fs.readFile(path.join(directory,'source.sb3'));
      artifact('cut.json');artifact('source.sb3');
      const s=recipe.speed;c=job.controller=await new EditorController(this.baseURL,{subtitleMargin:recipe.subtitleMargin,timing:{move:450/s,drag:750/s,type:75/s,pause:200/s}}).open();
      await c.setAssetSource(source);await c.load(source);if(recipe.start==='blank')await c.load(await blankProject(source));
      await perform(recipe.setup,'setup');await frame(recipe.framing);check();
      // Saving the start project is diagnostic; retakes replay preparation from
      // the original source so runtime state and aliases are never assumed saved.
      await fs.writeFile(path.join(directory,'start.sb3'),await c.save());artifact('start.sb3');
      await c.move(1880,1050,0);await c.page.screenshot({path:path.join(directory,'start.jpg')});artifact('start.jpg');
      recorder=new Recorder(c.page,directory);await recorder.start();await hold(recipe.beforeMs);
      await perform(recipe.actions,'capture');await frame(recipe.endFraming);await c.move(1880,1050);await hold(recipe.afterMs);check();
      await recorder.stop();job.status='encoding';job.current='カットを保存中';await recorder.encode();check();
      await fs.writeFile(path.join(directory,'result.sb3'),await c.save());artifact('result.sb3');
      job.preview=path.join(directory,'preview.jpg');await c.page.screenshot({path:job.preview});artifact('preview.jpg');artifact('movie.mp4');artifact('recording.json');
      finalStatus='completed';job.current='カットの撮影が完了しました';
    }catch(e){finalStatus=job.cancelled?'cancelled':'failed';job.error=e.message;log.push({phase:job.phase,error:e.message});
      if(c?.page&&!c.page.isClosed()){job.preview=path.join(directory,'failure.jpg');await c.page.screenshot({path:job.preview}).then(()=>artifact('failure.jpg')).catch(()=>{});}
    }finally{
      await recorder?.abort();await c?.close().catch(()=>{});job.controller=null;
      await atomicJSON(path.join(directory,'log.json'),log);artifact('log.json');job.finishedAt=new Date().toISOString();job.status=finalStatus;await this.persist(job);
    }
  }
}
