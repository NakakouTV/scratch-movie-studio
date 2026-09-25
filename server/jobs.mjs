import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {EditorController} from './controller.mjs';
import {Recorder} from './recorder.mjs';
import {blankProject,compareProjects} from './project.mjs';
import {normalizeScenes,joinSegments} from './scenes.mjs';

export const publicJob=job=>{const {controller,recorder,...data}=job;return data;};
export const activeJob=job=>['running','encoding'].includes(job.status);
const readJSON=async file=>JSON.parse(await fs.readFile(file,'utf8'));
export async function atomicJSON(file,value){
  const temporary=file+'.'+randomUUID()+'.tmp';
  await fs.writeFile(temporary,JSON.stringify(value,null,2));
  await fs.rename(temporary,file);
}

// A checkpoint is published only after its sb3, ID maps and encoded video
// segment are complete. Unpublished segments are never used on resume.
export class JobRunner {
  constructor(root,baseURL,jobs){this.root=root;this.baseURL=baseURL;this.jobs=jobs;}
  directory(id){return path.join(this.root,'outputs',id);}
  async persist(job){await atomicJSON(path.join(this.directory(job.id),'job.json'),publicJob(job));}
  async hydrate(){
    const output=path.join(this.root,'outputs');await fs.mkdir(output,{recursive:true});
    for(const entry of await fs.readdir(output,{withFileTypes:true})){
      if(!entry.isDirectory())continue;
      try{
        const directory=path.join(output,entry.name),job=await readJSON(path.join(directory,'job.json'));
        if(job.id!==entry.name)continue;
        const saved=await readJSON(path.join(directory,'checkpoint.json')).catch(()=>null);
        job.resumable=!!saved&&job.status!=='completed';
        if(saved)job.checkpoint={step:saved.nextIndex,savedAt:saved.savedAt};
        if(activeJob(job)){job.status='paused';job.current='サーバー停止前の保存地点から再開できます';job.error=undefined;await this.persist(job);}
        this.jobs.set(job.id,job);
      }catch(error){if(error.code!=='ENOENT')console.warn(`履歴を読み込めません: ${entry.name}: ${error.message}`);}
    }
  }
  async prepare(job,buffer,plan,options){
    options.outputMode??='full';
    if(options.outputMode!=='full')options.scenes=normalizeScenes(plan,options.scenes);
    const directory=this.directory(job.id);await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(path.join(directory,'source.sb3'),buffer);
    await atomicJSON(path.join(directory,'plan.json'),plan);
    // Raw input may leave a pressed mouse, dialog or running VM. Its state
    // cannot be reconstructed from sb3, so don't advertise resumability.
    options.checkpointable=!plan.actions.some(a=>/^(mouse\.|keyboard\.|project\.)/.test(a.type));
    await atomicJSON(path.join(directory,'options.json'),options);
    job.checkpointable=options.checkpointable;job.outputMode=options.outputMode;job.scenes=options.scenes||[];await this.persist(job);
  }
  async resume(job){
    if(activeJob(job)||!job.resumable)throw new Error('再開できる保存地点がありません。');
    const previous=job.status;job.status='running';
    try{await readJSON(path.join(this.directory(job.id),'checkpoint.json'));}catch(e){job.status=previous;throw e;}
    job.status='running';job.current='保存地点を復元中';job.error=undefined;job.verification=undefined;
    job.cancelled=false;job.pauseRequested=false;job.finishedAt=undefined;job.phase='building';
    await this.persist(job);
    this.launch(job,true);
  }
  launch(job,resume=false){
    this.run(job,resume).catch(async error=>{job.controller=null;job.status='failed';job.error=error.message;await this.persist(job).catch(()=>{});});
  }
  async run(job,resume=false){
    const directory=this.directory(job.id),plan=await readJSON(path.join(directory,'plan.json')),options=await readJSON(path.join(directory,'options.json'));
    const source=await fs.readFile(path.join(directory,'source.sb3'));
    let c,recorder,expected,segments=[],segmentScenes=[],log=[],nextIndex=0,lastSaved=0,finalStatus='failed',recordingScene=null;
    const sceneMode=options.outputMode&&options.outputMode!=='full',scenes=options.scenes||[];
    const sceneAt=index=>scenes.find(s=>index+1>=s.from&&index+1<=s.to);
    const artifact=name=>{if(!job.artifacts.some(a=>a.name===name))job.artifacts.push({name,url:`/outputs/${job.id}/${name}`});};
    const startSegment=async(sceneId=null)=>{
      if(!options.record||recorder)return;
      recordingScene=sceneId;
      recorder=new Recorder(c.page,path.join(directory,'segments',randomUUID()));await recorder.start();
    };
    const finishSegment=async()=>{
      if(!recorder)return;
      await recorder.stop();job.status='encoding';job.current='録画区間を保存中';
      await recorder.encode();
      segments.push(path.relative(directory,recorder.directory).replaceAll('\\','/'));
      segmentScenes.push(recordingScene);
      recorder=null;job.status='running';
    };
    const checkpoint=async index=>{
      const state=await c.checkpoint(),buffer=await c.save();
      await finishSegment();
      const folder='checkpoints/'+randomUUID(),absolute=path.join(directory,folder);await fs.mkdir(absolute,{recursive:true});
      await fs.writeFile(path.join(absolute,'project.sb3'),buffer);
      await atomicJSON(path.join(absolute,'state.json'),state);
      const saved={version:1,folder,nextIndex:index,segments:[...segments],segmentScenes:[...segmentScenes],log:[...log],savedAt:new Date().toISOString()};
      await atomicJSON(path.join(directory,'checkpoint.json'),saved);
      lastSaved=index;job.checkpoint={step:index,savedAt:saved.savedAt};job.resumable=true;
      const entry={name:'checkpoint.sb3',url:`/outputs/${job.id}/${folder}/project.sb3`};
      job.artifacts=job.artifacts.filter(a=>a.name!=='checkpoint.sb3');job.artifacts.push(entry);
      await c.page.screenshot({path:path.join(directory,'checkpoint.jpg'),type:'jpeg',quality:85});
      job.preview=path.join(directory,'checkpoint.jpg');await this.persist(job);
    };
    try{
      artifact('plan.json');
      c=job.controller=await new EditorController(this.baseURL,{minScale:options.minScale??0.8,timing:{move:450/options.speed,drag:750/options.speed,type:75/options.speed,pause:200/options.speed}}).open();
      if(resume){
        const saved=await readJSON(path.join(directory,'checkpoint.json'));
        expected=await readJSON(path.join(directory,'expected.json'));
        const assets=await fs.readFile(path.join(directory,'assets.sb3'));
        await c.load(assets);await c.setAssetSource(assets);
        await c.restoreCheckpoint(await fs.readFile(path.join(directory,saved.folder,'project.sb3')),await readJSON(path.join(directory,saved.folder,'state.json')));
        nextIndex=lastSaved=saved.nextIndex;segments=saved.segments;segmentScenes=saved.segmentScenes||segments.map(()=>null);log=saved.log;
        job.step=nextIndex;
      }else{
        await c.load(source);expected=JSON.parse(await c.page.evaluate(()=>studio.vm.toJSON()));
        const assets=await c.save();await c.setAssetSource(assets);
        await fs.writeFile(path.join(directory,'assets.sb3'),assets);await atomicJSON(path.join(directory,'expected.json'),expected);
        await c.load(await blankProject(source,{assets:!!plan.settings?.animateAssets}));
        if(options.checkpointable)await checkpoint(0);
      }
      for(let i=nextIndex;i<plan.actions.length;i++){
        if(job.cancelled){finalStatus='cancelled';job.current='中止';return;}
        if(job.pauseRequested){if(lastSaved!==i)await checkpoint(i);finalStatus='paused';job.current='途中保存しました';return;}
        const currentScene=sceneAt(i);job.currentScene=currentScene?.title;
        await startSegment(currentScene?.id);
        if(i===nextIndex)await c.pause(600/options.speed);
        const action=plan.actions[i];job.step=i+1;job.current=action.type+' '+(action.opcode||action.name||action.target||action.input||'');
        const started=Date.now(),result=await c.execute(action);
        log.push({step:i+1,action,result:result??null,durationMs:Date.now()-started});
        if(options.checkpointable&&(i+1-lastSaved>=options.checkpointEvery||action.type==='target.select'||(action.type==='tab.select'&&action.tab==='code')||i+1===plan.actions.length||(sceneMode&&currentScene?.to===i+1))){
          await checkpoint(i+1);
          if(job.pauseRequested){finalStatus='paused';job.current='途中保存しました';return;}
        }
      }
      if(job.pauseRequested){finalStatus='paused';job.current='途中保存しました';return;}
      job.phase='finishing';
      job.verification=compareProjects(expected,JSON.parse(await c.page.evaluate(()=>studio.vm.toJSON())));
      await atomicJSON(path.join(directory,'verification.json'),job.verification);artifact('verification.json');
      await fs.writeFile(path.join(directory,'rebuilt.sb3'),await c.save());artifact('rebuilt.sb3');
      if(!job.verification.ok)throw new Error(`完成プログラムに${job.verification.differences.length}件の差があります。検証レポートを確認してください。`);
      await startSegment(options.demoSeconds>0?'demo':scenes.at(-1)?.id);
      if(options.demoSeconds>0){job.current='完成したプログラムを実行';await c.execute({type:'project.start'});await c.pause(options.demoSeconds*1000);await c.execute({type:'project.stop'});}
      await c.pause(700/options.speed);
      job.preview=path.join(directory,'preview.jpg');await c.page.screenshot({path:job.preview,type:'jpeg',quality:90});artifact('preview.jpg');
      await finishSegment();
      if(job.cancelled){finalStatus='cancelled';job.current='中止';return;}
      if(options.record){
        job.status='encoding';job.current='保存済みの録画区間を結合中';
        if(options.outputMode!=='scenes'){await joinSegments(directory,segments,'movie.mp4');artifact('movie.mp4');}
        const metadata=await Promise.all(segments.map(s=>readJSON(path.join(directory,s,'recording.json'))));
        await atomicJSON(path.join(directory,'recording.json'),{width:1920,height:1080,fps:30,duration:metadata.reduce((n,m)=>n+m.duration,0),segments:segments.map((s,i)=>({path:s,sceneId:segmentScenes[i],...metadata[i]}))});
        artifact('recording.json');
        if(sceneMode){
          const outputScenes=[...scenes,...(options.demoSeconds>0?[{id:'demo',title:'完成後の実演',enabled:true,from:null,to:null}]:[])],entries=[];
          for(const [index,scene] of outputScenes.entries()){
            if(job.cancelled){finalStatus='cancelled';job.current='中止';return;}
            const indices=segments.map((_,i)=>i).filter(i=>segmentScenes[i]===scene.id);
            const entry={...scene,segments:indices.map(i=>segments[i]),duration:indices.reduce((n,i)=>n+metadata[i].duration,0)};
            if(scene.enabled){
              job.current=`場面 ${index+1}/${outputScenes.length} を出力中 · ${scene.title}`;
              entry.file=`scenes/${String(index+1).padStart(3,'0')}.mp4`;
              await joinSegments(directory,entry.segments,entry.file);
              job.artifacts=job.artifacts.filter(a=>a.name!==entry.file);
              job.artifacts.push({name:entry.file,url:`/outputs/${job.id}/${entry.file}`,title:scene.title,sceneId:scene.id});
            }
            entries.push(entry);
          }
          await atomicJSON(path.join(directory,'scenes.json'),{version:1,rangeConvention:'1-based inclusive',scenes:entries});artifact('scenes.json');
        }
      }
      finalStatus='completed';job.current='完了';job.currentScene=undefined;job.resumable=false;
    }catch(error){
      finalStatus=job.cancelled?'cancelled':'failed';job.error=error.message;
      log.push({error:error.message,stack:error.stack,step:job.step});
      if(c?.page&&!c.page.isClosed()){job.preview=path.join(directory,'failure.jpg');await c.page.screenshot({path:job.preview,type:'jpeg'}).catch(()=>{});artifact('failure.jpg');}
    }finally{
      // This is an uncommitted tail (failed/cancelled action or an idle segment).
      // Keep it for diagnosis, but never join it to the finished video.
      await recorder?.stop().catch(()=>{});
      await atomicJSON(path.join(directory,'log.json'),log);artifact('log.json');
      await c?.close().catch(()=>{});job.controller=null;job.finishedAt=new Date().toISOString();job.status=finalStatus;
      await this.persist(job);
    }
  }
}
