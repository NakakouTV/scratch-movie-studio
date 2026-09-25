import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JobRunner,atomicJSON} from '../server/jobs.mjs';
import {EditorController} from '../server/controller.mjs';
import {buildPlan,readSb3} from '../server/project.mjs';
import {runProcess} from '../server/recorder.mjs';

const record=process.argv.includes('--record'),root=path.resolve('test-results/checkpoint-resume'),jobs=new Map();
const sceneMode=process.argv.includes('--scenes');
let runner=new JobRunner(root,'http://127.0.0.1:8601',jobs);
const filename=record?'PEN動作確認.sb3':(await fs.readdir('.')).find(n=>n.startsWith('Fast ')&&n.endsWith('.sb3'));
const buffer=await fs.readFile(filename),{project}=await readSb3(buffer),plan=buildPlan(project,{assets:true});
const job={id:randomUUID(),name:filename,status:'running',step:0,total:plan.actions.length,current:'test',startedAt:new Date().toISOString(),warnings:[],artifacts:[]};jobs.set(job.id,job);
const scenes=plan.scenes.map((s,i)=>({...s,enabled:i!==1}));
await runner.prepare(job,buffer,plan,{record,speed:10,minScale:0.8,checkpointEvery:25,demoSeconds:record?0.3:0,outputMode:sceneMode?'both':'full',scenes:sceneMode?scenes:undefined});
const original=EditorController.prototype.execute;let pause=true,fail=false;
EditorController.prototype.execute=async function(action){
  const result=await original.call(this,action);
  const scale=await this.page.evaluate(()=>studio.workspace.scale);assert.ok(scale>=0.8-1e-6,`readability floor: ${scale}`);
  if(pause&&action.type==='costume.add'){pause=false;job.pauseRequested=true;}
  if(fail&&action.type==='block.add'&&(action.opcode==='procedures_call'||sceneMode)){fail=false;throw new Error('TEST: failure after block was already added');}
  return result;
};
const hydrate=async()=>{const restored=new Map();runner=new JobRunner(root,'http://127.0.0.1:8601',restored);await runner.hydrate();return restored.get(job.id);};
try{
  await runner.run(job);assert.equal(job.status,'paused',job.error);assert.ok(job.checkpoint.step>0);assert.ok(job.resumable);
  const saved=JSON.parse(await fs.readFile(path.join(runner.directory(job.id),'checkpoint.json'),'utf8'));
  console.log(`paused after costume import at ${saved.nextIndex}`);
  let current=await hydrate();current.status='running';current.pauseRequested=false;
  if(!record||sceneMode){
    fail=true;await runner.run(current,true);assert.equal(current.status,'failed');assert.match(current.error,/TEST:/);
    assert.ok(current.step>current.checkpoint.step,'partial action must not advance checkpoint');
    // Simulate a process stopping with a running job, then reload disk history.
    current.status='running';await runner.persist(current);current=await hydrate();assert.equal(current.status,'paused');assert.ok(current.resumable);
    console.log(`interrupted partial block at ${current.step}, restart at ${current.checkpoint.step}`);
  }
  current.status='running';current.pauseRequested=false;current.error=undefined;
  await runner.run(current,true);assert.equal(current.status,'completed',current.error);assert.equal(current.verification.ok,true);assert.equal(current.resumable,false);
  const {zip:actual,project:rebuilt}=await readSb3(await fs.readFile(path.join(runner.directory(job.id),'rebuilt.sb3')));
  const {zip:expected,project:normalized}=await readSb3(await fs.readFile(path.join(runner.directory(job.id),'assets.sb3')));
  for(const target of normalized.targets)for(const asset of [...target.costumes,...target.sounds])assert.deepEqual(await actual.file(asset.md5ext).async('nodebuffer'),await expected.file(asset.md5ext).async('nodebuffer'));
  assert.equal(rebuilt.targets.length,normalized.targets.length);
  if(record){
    const info=JSON.parse(await runProcess('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path.join(runner.directory(job.id),'movie.mp4')]));
    const video=info.streams.find(s=>s.codec_type==='video');assert.equal(video.width,1920);assert.equal(video.height,1080);assert.equal(video.r_frame_rate,'30/1');assert.ok(info.streams.some(s=>s.codec_type==='audio'));
    const metadata=JSON.parse(await fs.readFile(path.join(runner.directory(job.id),'recording.json'),'utf8'));
    assert.ok(metadata.segments.length>=3);assert.equal(metadata.segments[0].path,saved.segments[0]);
    assert.ok(Math.abs(Number(info.format.duration)-metadata.duration)<1,'joined duration should match committed recordings');
    await runProcess('ffmpeg',['-v','error','-i',path.join(runner.directory(job.id),'movie.mp4'),'-f','null','-']);
    console.log(`recorded ${metadata.segments.length} segments, ${info.format.duration}s; audio/video decode PASS`);
    if(sceneMode){
      const manifest=JSON.parse(await fs.readFile(path.join(runner.directory(job.id),'scenes.json'),'utf8'));
      assert.equal(manifest.scenes.length,scenes.length+1);
      assert.deepEqual(manifest.scenes.flatMap(s=>s.segments),metadata.segments.map(s=>s.path));
      assert.equal(new Set(manifest.scenes.flatMap(s=>s.segments)).size,metadata.segments.length);
      for(const scene of manifest.scenes){
        assert.deepEqual(scene.segments,metadata.segments.filter(s=>s.sceneId===scene.id).map(s=>s.path));
        if(!scene.enabled){assert.equal(scene.file,undefined);continue;}
        const output=path.join(runner.directory(job.id),scene.file);
        const probe=JSON.parse(await runProcess('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output]));
        assert.equal(probe.streams.find(s=>s.codec_type==='video').r_frame_rate,'30/1');
        assert.ok(probe.streams.some(s=>s.codec_type==='audio'));
        assert.ok(Math.abs(Number(probe.format.duration)-scene.duration)<0.5);
        await runProcess('ffmpeg',['-v','error','-i',output,'-f','null','-']);
      }
      console.log(`PASS scenes: ${manifest.scenes.filter(s=>s.file).length} MP4s, disabled scene, demo, boundaries, no duplicate segments after failure/resume`);
    }
  }
  await atomicJSON(path.join(root,sceneMode?'scenes-result.json':record?'record-result.json':'result.json'),{job:current.id,verification:current.verification,checkpoint:current.checkpoint});
  console.log(`PASS ${plan.actions.length} actions: pause, disk restore, ${record?'MP4 join':'partial failure retry'}, exact assets, semantic comparison`);
}finally{EditorController.prototype.execute=original;}
