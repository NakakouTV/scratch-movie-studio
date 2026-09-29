import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {EditorController} from './controller.mjs';
import {Recorder,runProcess} from './recorder.mjs';
import {readSb3,blankProject,buildPlan} from './project.mjs';
import {projectStructure} from './structure.mjs';

import {JobRunner,publicJob,activeJob} from './jobs.mjs';
import {normalizeScenes} from './scenes.mjs';
import {CutRunner,normalizeCut} from './cuts.mjs';
import {DEMO_OPERATIONS} from './demo-actions.mjs';

export const OPERATIONS=[...DEMO_OPERATIONS,'tab.select','costume.add','costume.select','sound.add','target.select','category.select','variable.create','procedure.create','broadcast.create','block.add','block.input','block.field','block.move','block.delete','workspace.zoom','view.configure','workspace.focus','mouse.move','mouse.click','mouse.down','mouse.up','mouse.wheel','keyboard.type','keyboard.press','project.start','project.stop','wait'];
export async function apiRouter(root,baseURL) {
  const router=express.Router(),projects=new Map(),sessions=new Map(),jobs=new Map();
  const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const session=id=>{const s=sessions.get(id);if(!s)throw new Error('セッションがありません。');return s;};
  const project=id=>{const p=projects.get(id);if(!p)throw new Error('プロジェクトがありません。もう一度読み込んでください。');return p;};
  const sessionState=async s=>({...await s.controller.state(),busy:s.busy,recording:!!s.recorder?.accepting,currentAction:s.currentAction??null,lastAction:s.lastAction??null});
  const runner=new JobRunner(root,baseURL,jobs);await runner.hydrate();
  const cuts=new CutRunner(root,baseURL,jobs);
  async function startCut(buffer,input,retakeOf){
    if([...jobs.values()].some(activeJob))throw new Error('別の動画を制作中です。');
    const recipe=normalizeCut(input,OPERATIONS),id=randomUUID();
    const job={id,kind:'cut',name:recipe.title,status:'running',step:0,total:recipe.setup.length,current:'カットを準備中',startedAt:new Date().toISOString(),artifacts:[],warnings:[],retakeOf};
    jobs.set(id,job);
    try{await runProcess(process.env.FFMPEG_PATH||'ffmpeg',['-version']);await cuts.prepare(job,buffer,recipe);}catch(e){jobs.delete(id);throw e;}
    cuts.launch(job);return publicJob(job);
  }
  router.post('/cuts',asyncRoute(async(req,res)=>res.status(202).json(await startCut(project(req.body.projectId).buffer,req.body))));
  router.post('/cuts/:id/retake',asyncRoute(async(req,res)=>{
    const job=jobs.get(req.params.id);if(job?.kind!=='cut')throw new Error('カットがありません。');
    const directory=cuts.directory(job.id),recipe=JSON.parse(await fs.readFile(path.join(directory,'cut.json'),'utf8'));
    res.status(202).json(await startCut(await fs.readFile(path.join(directory,'source.sb3')),{...recipe,...req.body},job.id));
  }));
  router.get('/capabilities',(req,res)=>res.json({version:'0.3.0',editorVersion:'15.1.1',operations:OPERATIONS,extensions:['pen'],video:{width:1920,height:1080,fps:30,format:'mp4'},unsupported:['paint drawing automation','sound waveform editing','cloud sync','hardware extensions'],note:'背景・コスチューム・音は公式のアップロード操作で追加します。スプライト自体は撮影前に準備します。'}));
  router.get('/samples',asyncRoute(async(req,res)=>res.json((await fs.readdir(root)).filter(n=>n.endsWith('.sb3')))));
  async function addProject(buffer,name) {
    const {project:json}=await readSb3(buffer);const plan=buildPlan(json,{assets:true}),id=randomUUID();
    projects.set(id,{id,name,buffer,json,plan});
    return {id,name,plan,summary:{sprites:json.targets.filter(t=>!t.isStage).length,blocks:json.targets.reduce((n,t)=>n+Object.values(t.blocks||{}).filter(b=>!b.shadow).length,0),actions:plan.actions.length,extensions:json.extensions||[]}};
  }
  router.post('/projects',express.raw({type:'application/octet-stream',limit:'80mb'}),asyncRoute(async(req,res)=>{
    if(!Buffer.isBuffer(req.body))throw new Error('sb3をapplication/octet-streamで送信してください。');
    res.json(await addProject(req.body,decodeURIComponent(req.get('X-File-Name')||'project.sb3')));
  }));
  router.post('/samples/load',asyncRoute(async(req,res)=>{
    const name=req.body.name;if(typeof name!=='string'||path.basename(name)!==name||!name.endsWith('.sb3'))throw new Error('ファイル名が不正です。');
    res.json(await addProject(await fs.readFile(path.join(root,name)),name));
  }));
  router.get('/projects/:id/plan',(req,res)=>res.json(project(req.params.id).plan));
  router.get('/projects/:id/cut-plan',(req,res)=>res.json(buildPlan(project(req.params.id).json)));
  router.get('/projects/:id/structure',(req,res)=>res.json(projectStructure(project(req.params.id).json)));
  router.post('/sessions',asyncRoute(async(req,res)=>{
    if([...jobs.values()].some(j=>['running','encoding'].includes(j.status)))throw new Error('動画を制作中です。完了後にセッションを作成してください。');
    const p=project(req.body.projectId),id=randomUUID();
    const controller=await new EditorController(baseURL,{headed:!!req.body.headed,timing:req.body.timing,minScale:req.body.minScale}).open();
    try {await controller.setAssetSource(p.buffer);await controller.load(p.buffer);if(req.body.blank)await controller.load(await blankProject(p.buffer,{assets:!!req.body.animateAssets}));}catch(e){await controller.close();throw e;}
    const s={id,controller,busy:false,log:[],directory:path.join(root,'outputs',id)};sessions.set(id,s);
    res.json({id,state:await sessionState(s)});
  }));
  router.get(['/sessions/:id','/sessions/:id/state'],asyncRoute(async(req,res)=>res.json(await sessionState(session(req.params.id)))));
  router.post('/sessions/:id/actions',asyncRoute(async(req,res)=>{
    const s=session(req.params.id);if(s.busy)throw new Error('このセッションは操作中です。');
    const actions=Array.isArray(req.body)?req.body:[req.body];
    if(actions.length>10000)throw new Error('操作数が多すぎます。');
    s.busy=true;
    try {
      const results=[];
      for(const action of actions){
        s.currentAction={sequence:s.log.length+1,action,startedAt:new Date().toISOString()};
        try{
          const result=await s.controller.execute(action);results.push(result??null);
          s.lastAction={...s.currentAction,success:true,result:result??null,completedAt:new Date().toISOString()};
        }catch(error){
          s.lastAction={...s.currentAction,success:false,error:error.message,completedAt:new Date().toISOString()};throw error;
        }finally{s.log.push(s.lastAction);s.currentAction=null;}
      }
      res.json({results});
    }finally{s.busy=false;}
  }));
  router.get('/sessions/:id/screenshot',asyncRoute(async(req,res)=>res.type('image/jpeg').send(await session(req.params.id).controller.page.screenshot({type:'jpeg',quality:70}))));
  router.get('/sessions/:id/project.sb3',asyncRoute(async(req,res)=>res.type('application/octet-stream').attachment('project.sb3').send(await session(req.params.id).controller.save())));
  router.post('/sessions/:id/recording/start',asyncRoute(async(req,res)=>{
    const s=session(req.params.id);if(s.recorder)throw new Error('録画中です。');
    await runProcess(process.env.FFMPEG_PATH||'ffmpeg',['-version']);
    s.recorder=new Recorder(s.controller.page,s.directory);
    try{await s.recorder.start();}catch(e){s.recorder=null;throw e;}
    res.json({recording:true});
  }));
  router.post('/sessions/:id/recording/stop',asyncRoute(async(req,res)=>{
    const s=session(req.params.id);if(!s.recorder)throw new Error('録画が開始されていません。');
    try{await s.recorder.stop();await s.recorder.encode();}
    catch(e){await s.recorder.abort();throw e;}
    finally{s.recorder=null;}
    await fs.writeFile(path.join(s.directory,'actions.json'),JSON.stringify(s.log,null,2));res.json({url:`/outputs/${s.id}/movie.mp4`});
  }));
  router.delete('/sessions/:id',asyncRoute(async(req,res)=>{
    const s=session(req.params.id);if(s.busy)throw new Error('操作中です。');
    await s.recorder?.abort();await s.controller.close();sessions.delete(s.id);res.json({closed:true});
  }));
  router.post('/jobs',asyncRoute(async(req,res)=>{
    if([...jobs.values()].some(j=>['running','encoding'].includes(j.status)))throw new Error('別の動画を制作中です。');
    const p=project(req.body.projectId);
    const plan=req.body.plan||(req.body.animateAssets===false?buildPlan(p.json):p.plan);
    if(!Array.isArray(plan.actions)||plan.actions.length>10000||plan.actions.some(a=>!OPERATIONS.includes(a.type)))throw new Error('操作手順に未対応の命令があります。');
    const record=req.body.record!==false;
    const speed=Number(req.body.speed||1);if(!Number.isFinite(speed)||speed<0.25||speed>10)throw new Error('速度は0.25〜10です。');
    const id=randomUUID(),job={id,name:p.name,status:'running',step:0,total:plan.actions.length,current:'準備中',startedAt:new Date().toISOString(),warnings:plan.warnings||[],cancelled:false,artifacts:[]};
    const minScale=Number(req.body.minScale??0.8),checkpointEvery=Number(req.body.checkpointEvery??25),demoSeconds=Number(req.body.demoSeconds??3);
    if(!Number.isFinite(minScale)||minScale<0.3||minScale>1.5)throw new Error('倍率下限は0.3〜1.5です。');
    if(!Number.isInteger(checkpointEvery)||checkpointEvery<1||checkpointEvery>100)throw new Error('保存間隔は1〜100操作です。');
    if(!Number.isFinite(demoSeconds)||demoSeconds<0||demoSeconds>30)throw new Error('実演時間は0〜30秒です。');
    const outputMode=req.body.outputMode??'full';
    if(!['full','scenes','both'].includes(outputMode))throw new Error('出力形式は full / scenes / both です。');
    const scenes=outputMode==='full'?[]:normalizeScenes(plan,req.body.scenes);
    if(plan.actions.some(a=>DEMO_OPERATIONS.includes(a.type)))throw new Error('実演用操作は独立カットまたは個別セッションで使用してください。');
    if(outputMode!=='full'&&plan.actions.some(a=>/^(mouse\.|keyboard\.|project\.)/.test(a.type)))throw new Error('場面別出力には、直接のマウス・キー・実行操作を含まない手順を指定してください。');
    if(outputMode==='scenes'&&!scenes.some(s=>s.enabled)&&demoSeconds===0)throw new Error('出力する場面を1つ以上選択してください。');
    jobs.set(id,job);
    try{if(record)await runProcess(process.env.FFMPEG_PATH||'ffmpeg',['-version']);await runner.prepare(job,p.buffer,plan,{record,speed,minScale,checkpointEvery,demoSeconds,outputMode,scenes});}catch(e){jobs.delete(id);throw e;}
    res.status(202).json(publicJob(job));runner.launch(job);
  }));
  router.get('/jobs',(req,res)=>res.json([...jobs.values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).map(publicJob)));
  router.get('/jobs/:id',(req,res)=>{const j=jobs.get(req.params.id);if(!j)return res.status(404).json({error:'ジョブがありません。'});res.json(publicJob(j));});
  router.post('/jobs/:id/cancel',(req,res)=>{const j=jobs.get(req.params.id);if(j)j.cancelled=true;res.json({requested:true});});
  router.post('/jobs/:id/pause',asyncRoute(async(req,res)=>{
    const j=jobs.get(req.params.id);if(!j||!activeJob(j)||!j.checkpointable||j.phase==='finishing')throw new Error('この制作は途中保存できません（完成確認・最終出力中の場合は完了をお待ちください）。');
    j.pauseRequested=true;res.json({requested:true});
  }));
  router.post('/jobs/:id/resume',asyncRoute(async(req,res)=>{
    if([...jobs.values()].some(activeJob))throw new Error('別の動画を制作中です。');
    const j=jobs.get(req.params.id);if(!j)throw new Error('ジョブがありません。');
    await runner.resume(j);res.status(202).json(publicJob(j));
  }));
  router.get('/jobs/:id/preview',asyncRoute(async(req,res)=>{
    const j=jobs.get(req.params.id);res.set('Cache-Control','no-store');
    if(j?.controller?.page&&!j.controller.page.isClosed())return res.type('image/jpeg').send(await j.controller.page.screenshot({type:'jpeg',quality:60}));
    if(j?.preview)return res.sendFile(j.preview);
    res.status(204).end();
  }));

  return router;
}
