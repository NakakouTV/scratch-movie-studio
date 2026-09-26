import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {Recorder,runProcess} from '../server/recorder.mjs';
import {joinSegments} from '../server/scenes.mjs';

const directory=path.resolve('test-results/recording-stream',randomUUID());
await fs.mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1920,height:1080}});
let recorder;
const probe=async file=>JSON.parse(await runProcess('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));
async function analyze(file){
  await runProcess('ffmpeg',['-v','error','-y','-i',file,'-map','0:v:0','-vf','scale=1:1,format=gray','-fps_mode','passthrough','-f','rawvideo',file+'.gray']);
  await runProcess('ffmpeg',['-v','error','-y','-i',file,'-map','0:a:0','-ac','1','-ar','48000','-f','s16le',file+'.pcm']);
  const gray=await fs.readFile(file+'.gray'),pcm=await fs.readFile(file+'.pcm');
  const video=[],audio=[];
  for(let i=0;i<gray.length;i++)if(gray[i]>128&&(i===0||gray[i-1]<=128))video.push(i/30);
  let active=false;
  for(let i=0;i+3200<=pcm.length;i+=3200){
    let square=0;for(let j=i;j<i+3200;j+=2)square+=pcm.readInt16LE(j)**2;
    const loud=Math.sqrt(square/1600)>1000;
    if(loud&&!active)audio.push(i/96000);active=loud;
  }
  assert.equal(audio.length,video.length,JSON.stringify({audio,video}));
  assert.ok(audio.length>0);
  const offsets=audio.map((t,i)=>t-video[i]);
  assert.ok(offsets.every(t=>Math.abs(t)<=0.10001),`audio/flash offsets: ${JSON.stringify({offsets,audio,video})}`);
  return {frames:gray.length,offsets};
}
try{
  await page.setContent('<body style="margin:0;background:black"></body>');
  await page.evaluate(()=>{
    const audioContext=new AudioContext(),inputNode=audioContext.createGain();inputNode.connect(audioContext.destination);
    window.studio={vm:{runtime:{audioEngine:{audioContext,inputNode}}}};
  });
  const segments=[],metadata=[];
  for(const [i,length] of [1177,783,1359].entries()){
    const segment=`segment-${i}`;segments.push(segment);
    recorder=new Recorder(page,path.join(directory,segment));await recorder.start();
    await page.evaluate(async length=>{
      await new Promise(resolve=>setTimeout(resolve,220));
      const {audioContext,inputNode}=studio.vm.runtime.audioEngine,osc=audioContext.createOscillator();
      osc.frequency.value=600;osc.connect(inputNode);osc.start();document.body.style.background='white';
      await new Promise(resolve=>setTimeout(resolve,180));
      osc.stop();document.body.style.background='black';
      await new Promise(resolve=>setTimeout(resolve,length-400));
    },length);
    await recorder.stop();await recorder.encode();
    await fs.writeFile(path.join(directory,`frames-${i}.json`),JSON.stringify(recorder.frames));
    const m=JSON.parse(await fs.readFile(path.join(recorder.directory,'recording.json'),'utf8'));metadata.push(m);
    assert.equal(m.fallbackTimestamps,0);
    assert.deepEqual((await fs.readdir(recorder.directory)).sort(),['audio.flac','movie.mp4','recording.json']);
    assert.equal((await probe(path.join(recorder.directory,'movie.mp4'))).streams.find(s=>s.codec_type==='video').nb_frames,String(m.frameCount));
  }
  assert.deepEqual(await joinSegments(directory,segments,'movie.mp4'),{video:'copy'});
  const output=path.join(directory,'movie.mp4'),result=await analyze(output),info=await probe(output);
  const total=metadata.reduce((n,m)=>n+m.frameCount,0);
  assert.equal(result.frames,total);assert.equal(result.offsets.length,3);
  assert.equal(info.streams.find(s=>s.codec_type==='video').avg_frame_rate,'30/1');
  // Every presentation timestamp remains exactly on the 30 fps grid.
  const packets=JSON.parse(await runProcess('ffprobe',['-v','error','-select_streams','v','-show_entries','packet=pts_time','-of','json',output])).packets;
  assert.equal(packets.length,total);packets.forEach((p,i)=>assert.ok(Math.abs(Number(p.pts_time)-i/30)<0.00001));
  // The MP4 concat demuxer inserts H.264 parameter sets at keyframes, so packet
  // bytes can differ without re-encoding. Compare every decoded pixel instead.
  const hashes=async file=>{
    await runProcess('ffmpeg',['-v','error','-y','-i',file,'-map','0:v:0','-fps_mode','passthrough','-f','framemd5',file+'.md5']);
    return (await fs.readFile(file+'.md5','utf8')).trim().split(/\r?\n/).filter(l=>!l.startsWith('#')).map(l=>l.split(',').at(-1).trim());
  };
  const originals=[];for(const segment of segments)originals.push(...await hashes(path.join(directory,segment,'movie.mp4')));
  assert.deepEqual(await hashes(output),originals,'every decoded video frame must be unchanged');
  // Legacy/mixed checkpoints retain their compatibility path.
  await fs.writeFile(path.join(directory,segments[0],'recording.json'),JSON.stringify({duration:metadata[0].duration}));
  assert.deepEqual(await joinSegments(directory,segments,'legacy.mp4'),{video:'reencode'});
  await analyze(path.join(directory,'legacy.mp4'));
  // Explicit cancellation and encoder failure must not leave usable-looking movies.
  recorder=new Recorder(page,path.join(directory,'aborted'));await recorder.start();await recorder.abort();
  assert.equal(recorder.accepting,false);assert.ok(recorder.encoder.exitCode!==null||recorder.encoder.signalCode!==null);
  recorder=new Recorder(page,path.join(directory,'failed'));await recorder.start();recorder.encoder.kill();
  await assert.rejects(recorder.finished);await assert.rejects(recorder.stop());
  await assert.rejects(fs.access(path.join(directory,'failed','movie.mp4')));
  // Pages without Scratch audio still produce compatible silent segments.
  await page.evaluate(()=>{delete window.studio;});
  recorder=new Recorder(page,path.join(directory,'silent'));await recorder.start();await page.waitForTimeout(130);await recorder.encode();
  assert.equal((await probe(path.join(directory,'silent','movie.mp4'))).streams.length,2);
  const previous=process.env.FFMPEG_PATH;
  try{
    process.env.FFMPEG_PATH=path.join(directory,'missing-ffmpeg.exe');
    recorder=new Recorder(page,path.join(directory,'missing'));await assert.rejects(recorder.start(),/ENOENT/);
    assert.equal(recorder.accepting,false);
  }finally{if(previous===undefined)delete process.env.FFMPEG_PATH;else process.env.FFMPEG_PATH=previous;}
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({metadata,result,total,info},null,2));
  console.log(JSON.stringify({directory,frames:total,offsets:result.offsets}));
  console.log('PASS streaming, AV sync, exact concat timestamps, legacy join, encoder failure, cancellation, silent audio');
}finally{await recorder?.abort();await browser.close();}
