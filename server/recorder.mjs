import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

export async function runProcess(command,args,{cwd}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',d=>{output=(output+d).slice(-12000);});child.stderr.on('data',d=>{output=(output+d).slice(-12000);});
    child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(new Error(`${command} failed (${code}): ${output}`)));
  });
}

export const VIDEO_PROFILE='h264-1080p30-no-bframes-v1';
const ffmpeg=()=>process.env.FFMPEG_PATH||'ffmpeg';

// Sample capture timestamps, not network receipt times. Hold the previous image
// across idle periods. Compressed images are streamed; no JPEG files are needed.
export class Recorder {
  constructor(page,directory) {
    this.page=page;this.directory=directory;this.frames=[];this.accepting=false;
    this.queue=Promise.resolve();this.queuedBytes=0;this.peakQueuedBytes=0;this.frameCount=0;this.fallbackTimestamps=0;
  }
  async start() {
    try {
      await fs.mkdir(this.directory,{recursive:true});
      this.lastImage=await this.page.screenshot({type:'jpeg',quality:90});
      this.encoder=spawn(ffmpeg(),['-hide_banner','-y','-f','image2pipe','-framerate','30','-vcodec','mjpeg','-i','pipe:0','-an','-vf','scale=1920:1080:flags=lanczos','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-bf','0','-video_track_timescale','90000',path.join(this.directory,'video.partial.mp4')],{windowsHide:true,stdio:['pipe','ignore','pipe']});
      let stderr='';this.encoder.stderr.on('data',d=>{stderr=(stderr+d).slice(-12000);});
      this.encoder.stdin.on('error',e=>{this.error??=e;});
      this.finished=new Promise((resolve,reject)=>{
        this.encoder.on('error',reject);
        this.encoder.on('close',code=>code===0?resolve():reject(new Error(`録画エンコーダーが終了しました (${code}): ${stderr}`)));
      });
      this.finished.catch(e=>{this.error??=e;});
      await new Promise((resolve,reject)=>{this.encoder.once('spawn',resolve);this.encoder.once('error',reject);});
      this.cdp=await this.page.context().newCDPSession(this.page);
      const clock=await this.page.evaluate(async()=>{
        const engine=window.studio?.vm?.runtime?.audioEngine;
        if(!engine?.audioContext||!engine.inputNode)return {start:Date.now()/1000,audio:false};
        await engine.audioContext.resume();
        const destination=engine.audioContext.createMediaStreamDestination();engine.inputNode.connect(destination);
        // An inactive Scratch graph can stop delivering silent samples. Keep the
        // capture track alive so MediaRecorder does not discard leading silence.
        const silence=engine.audioContext.createConstantSource();silence.offset.value=0;silence.connect(destination);silence.start();
        const recorder=new MediaRecorder(destination.stream,{mimeType:'audio/webm;codecs=opus'}),chunks=[];
        recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
        window.studioAudio={recorder,chunks,destination,engine,silence};
        const start=Date.now()/1000;recorder.start(1000);return {start,audio:true};
      });
      this.origin=clock.start;this.hasAudio=clock.audio;this.started=performance.now();this.accepting=true;
      this.frames.push({time:0});
      this.cdp.on('Page.screencastFrame',event=>{
        this.cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});
        if(!this.accepting||this.error)return;
        let time=event.metadata?.timestamp-this.origin;
        if(!Number.isFinite(time)){time=(performance.now()-this.started)/1000;this.fallbackTimestamps++;}
        time=Math.max(this.frames.at(-1).time,time,0);
        this.sampleUntil(time);
        this.lastImage=Buffer.from(event.data,'base64');this.frames.push({time});
      });
      await this.cdp.send('Page.startScreencast',{format:'jpeg',quality:90,maxWidth:1920,maxHeight:1080,everyNthFrame:1});
      if(this.error)throw this.error;
    } catch(e) {await this.abort();throw e;}
  }
  sampleUntil(time) {
    const count=Math.max(0,Math.ceil(time*30-1e-6)-this.frameCount);
    if(!count)return;
    const image=this.lastImage;
    this.frameCount+=count;this.queuedBytes+=image.length;
    this.peakQueuedBytes=Math.max(this.peakQueuedBytes,this.queuedBytes);
    if(this.queuedBytes>64*1024*1024){this.error=new Error('動画エンコードが追いつかず録画を停止しました。途中保存から再開してください。');this.encoder.kill();return;}
    this.queue=this.queue.then(async()=>{
      if(this.error)throw this.error;
      for(let i=0;i<count;i++)await new Promise((resolve,reject)=>{
        this.encoder.stdin.write(image,error=>error?reject(error):resolve());
      });
    }).catch(e=>{this.error??=e;this.encoder.kill();}).finally(()=>{this.queuedBytes-=image.length;});
  }
  stop() {return this.stopping??=(this.stopRecording().catch(async e=>{await this.abort();throw e;}));}
  async stopRecording() {
    if(!this.accepting)return;
    this.accepting=false;
    const audio=await this.page.evaluate(async()=>{
      const end=Date.now()/1000,a=window.studioAudio;
      if(!a)return {end};
      try{
        await new Promise((resolve,reject)=>{a.recorder.onstop=resolve;a.recorder.onerror=reject;a.recorder.stop();});
        const bytes=new Uint8Array(await new Blob(a.chunks).arrayBuffer());let binary='';
        for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
        return {end,base64:btoa(binary)};
      }finally{a.silence.stop();a.silence.disconnect();a.engine.inputNode.disconnect(a.destination);a.destination.stream.getTracks().forEach(t=>t.stop());delete window.studioAudio;}
    });
    await this.cdp.send('Page.stopScreencast');await this.cdp.detach();this.cdp=null;
    this.capturedDuration=Math.max(1/30,audio.end-this.origin,this.frames.at(-1).time);
    this.sampleUntil(this.capturedDuration);
    await this.queue;
    if(this.error)throw this.error;
    this.encoder.stdin.end();await this.finished;
    this.duration=this.frameCount/30;
    if(audio.base64)await fs.writeFile(path.join(this.directory,'audio.webm'),Buffer.from(audio.base64,'base64'));
    this.stopped=true;
  }
  async abort() {
    this.accepting=false;this.encoder?.kill();
    await this.finished?.catch(()=>{});
    await this.cdp?.send('Page.stopScreencast').catch(()=>{});await this.cdp?.detach().catch(()=>{});this.cdp=null;
    await this.page.evaluate(()=>{
      const a=window.studioAudio;if(!a)return;
      if(a.recorder.state!=='inactive')a.recorder.stop();
      a.silence.stop();a.silence.disconnect();a.engine.inputNode.disconnect(a.destination);a.destination.stream.getTracks().forEach(t=>t.stop());delete window.studioAudio;
    }).catch(()=>{});
  }
  async encode() {
    await this.stop();if(!this.stopped)throw new Error('録画区間が完成していません。');
    // 48 kHz gives exactly 1600 samples per video frame. Retain lossless audio
    // so joining checkpoints never accumulates AAC encoder padding.
    const samples=this.frameCount*1600;
    await runProcess(ffmpeg(),['-hide_banner','-y',...(this.hasAudio?['-i','audio.webm']:['-f','lavfi','-i','anullsrc=r=48000:cl=stereo']),'-af',`aresample=48000,apad,atrim=end_sample=${samples},asetpts=N/SR/TB`,'-ac','2','-c:a','flac','audio.flac'],{cwd:this.directory});
    await runProcess(ffmpeg(),['-hide_banner','-y','-i','video.partial.mp4','-i','audio.flac','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','160k','-video_track_timescale','90000','-movflags','+faststart','movie.partial.mp4'],{cwd:this.directory});
    await fs.rename(path.join(this.directory,'movie.partial.mp4'),path.join(this.directory,'movie.mp4'));
    await fs.writeFile(path.join(this.directory,'recording.json'),JSON.stringify({version:2,profile:VIDEO_PROFILE,width:1920,height:1080,fps:30,audio:!!this.hasAudio,duration:this.duration,capturedDuration:this.capturedDuration,frameCount:this.frameCount,frames:this.frames.length,fallbackTimestamps:this.fallbackTimestamps,clock:'browser-capture',audioSamples:samples,peakQueuedBytes:this.peakQueuedBytes},null,2));
    await fs.unlink(path.join(this.directory,'video.partial.mp4'));
    if(this.hasAudio)await fs.unlink(path.join(this.directory,'audio.webm'));
    return path.join(this.directory,'movie.mp4');
  }
}
