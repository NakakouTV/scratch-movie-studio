import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {EditorController} from '../server/controller.mjs';
import {blankProject} from '../server/project.mjs';
import {Recorder,runProcess} from '../server/recorder.mjs';
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:160,drag:700,type:1,pause:60}}).open();
const directory=path.resolve('test-results/drag-tracking');await fs.mkdir(directory,{recursive:true});
let recorder;
try{
  const buffer=await fs.readFile('PEN動作確認.sb3');await c.load(await blankProject(buffer));await c.selectTarget('ペン');
  await c.page.evaluate(()=>{
    window.dragTrace={down:0,up:0,samples:[],pointer:{x:0,y:0}};
    document.addEventListener('pointerdown',e=>{if(studio.targetedDrag)dragTrace.down++;},true);
    document.addEventListener('pointerup',e=>{if(studio.targetedDrag)dragTrace.up++;},true);
    document.addEventListener('pointermove',e=>{dragTrace.pointer={x:e.clientX,y:e.clientY};},true);
    const sample=()=>{
      const w=studio.workspace,d=w?.getGesture()?.getCurrentDragger(),b=d?.draggable;
      if(studio.dragMotion?.active&&b?.getSvgRoot){
        const p=dragTrace.pointer,m=b.getSvgRoot().getScreenCTM(),origin=new DOMPoint(0,0).matrixTransform(m);
        const cursor=new DOMMatrix(getComputedStyle(document.getElementById('movie-cursor')).transform);
        dragTrace.samples.push({time:performance.now(),id:b.id,x:w.scrollX,y:w.scrollY,gripX:(p.x-origin.x)/w.scale,gripY:(p.y-origin.y)/w.scale,cursorError:Math.hypot(cursor.e-p.x,cursor.f-p.y)});
      }
      requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  });
  recorder=new Recorder(c.page,directory);await recorder.start();
  const cases=[];
  async function check(action,panning=false){
    await c.page.evaluate(()=>{dragTrace.down=0;dragTrace.up=0;dragTrace.samples=[];});
    await c.execute(action);
    const trace=await c.page.evaluate(()=>dragTrace),samples=trace.samples;
    assert.equal(trace.down,1);assert.equal(trace.up,1);assert.ok(samples.length>3);
    const first=samples[0];
    const error=Math.max(...samples.map(s=>Math.hypot(s.gripX-first.gripX,s.gripY-first.gripY)));
    assert.ok(error<2,`grab point drift ${error}`);
    assert.ok(samples.every(s=>s.cursorError<1),'recorded cursor must follow pointer events');
    if(panning)assert.ok(samples.some(s=>Math.hypot(s.x-first.x,s.y-first.y)>100),'workspace must pan during the held drag');
    const result={action,samples:samples.length,maxGripError:error,maxCursorError:Math.max(...samples.map(s=>s.cursorError)),panDistance:Math.max(...samples.map(s=>Math.hypot(s.x-first.x,s.y-first.y)))};
    cases.push(result);console.log(JSON.stringify(result));
    assert.equal(await c.page.evaluate(()=>!!studio.dragMotion||!!studio.targetedDrag),false);
  }
  await check({type:'block.add',sourceId:'move',opcode:'motion_movesteps',place:{x:200,y:200}});
  await check({type:'block.move',block:'move',place:{x:800,y:5000}},true);
  await check({type:'block.move',block:'move',place:{x:-2000,y:-1200}},true);
  await check({type:'block.move',block:'move',place:{x:200,y:200}},true);
  await c.page.screenshot({path:path.join(directory,'completed.png')});
  await recorder.stop();const start=performance.now();const movie=await recorder.encode();const encodeSeconds=(performance.now()-start)/1000;
  const recording=JSON.parse(await fs.readFile(path.join(directory,'recording.json'),'utf8'));
  const frames=recorder.frames,intervals=frames.slice(1).map((f,i)=>f.time-frames[i].time).sort((a,b)=>a-b);
  const frameBytes=0; // The streaming recorder does not create JPEG files.
  const probe=JSON.parse(await runProcess('ffprobe',['-v','error','-show_streams','-show_format','-of','json',movie]));
  const report={cases,recording,encodeSeconds,frameBytes,movieBytes:(await fs.stat(movie)).size,frameIntervalP50:intervals[Math.floor(intervals.length*.5)],frameIntervalP95:intervals[Math.floor(intervals.length*.95)],probe};
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  assert.ok(probe.streams.some(s=>s.codec_type==='video'&&s.width===1920&&s.height===1080&&s.avg_frame_rate==='30/1'));
  assert.deepEqual(c.errors,[]);console.log('PASS: pointer/block tracking, single held drag, pan in all directions, MP4 recorded');
}finally{await recorder?.stop().catch(()=>{});await c.close();}
