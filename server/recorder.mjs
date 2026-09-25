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

// CDP emits frames on visual changes. Preserve their real durations, then sample
// at 30 fps; idle periods and character typing keep their actual timing.
export class Recorder {
  constructor(page,directory) {this.page=page;this.directory=directory;this.frames=[];this.pending=[];this.accepting=false;}
  async start() {
    this.frameDir=path.join(this.directory,'frames');await fs.mkdir(this.frameDir,{recursive:true});
    this.cdp=await this.page.context().newCDPSession(this.page);
    await this.page.screenshot({path:path.join(this.frameDir,'000000.jpg'),type:'jpeg',quality:90});
    this.hasAudio=await this.page.evaluate(async()=>{
      const engine=studio.vm.runtime.audioEngine;
      if(!engine?.audioContext||!engine.inputNode)return false;
      await engine.audioContext.resume();
      const destination=engine.audioContext.createMediaStreamDestination();
      engine.inputNode.connect(destination);
      const recorder=new MediaRecorder(destination.stream,{mimeType:'audio/webm;codecs=opus'}),chunks=[];
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      window.studioAudio={recorder,chunks,destination,engine};recorder.start(1000);return true;
    });
    this.frames.push({file:'000000.jpg',time:0});this.started=performance.now();this.accepting=true;
    this.cdp.on('Page.screencastFrame',event=>{
      this.cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});
      if(!this.accepting) return;
      const file=String(this.frames.length).padStart(6,'0')+'.jpg';
      this.frames.push({file,time:(performance.now()-this.started)/1000});
      this.pending.push(fs.writeFile(path.join(this.frameDir,file),Buffer.from(event.data,'base64')).catch(e=>{this.writeError=e;}));
    });
    await this.cdp.send('Page.startScreencast',{format:'jpeg',quality:90,maxWidth:1920,maxHeight:1080,everyNthFrame:1});
  }
  async stop() {
    if(!this.accepting)return;
    this.accepting=false;this.duration=(performance.now()-this.started)/1000;
    await this.cdp.send('Page.stopScreencast');await this.cdp.detach();await Promise.all(this.pending);
    if(this.writeError)throw this.writeError;
    if(this.hasAudio){
      const base64=await this.page.evaluate(async()=>{
        const a=window.studioAudio;
        await new Promise(resolve=>{a.recorder.onstop=resolve;a.recorder.stop();});
        a.engine.inputNode.disconnect(a.destination);a.destination.stream.getTracks().forEach(t=>t.stop());
        const bytes=new Uint8Array(await new Blob(a.chunks).arrayBuffer());let binary='';
        for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
        delete window.studioAudio;return btoa(binary);
      });
      await fs.writeFile(path.join(this.directory,'audio.webm'),Buffer.from(base64,'base64'));
    }
    const lines=[];
    for(let i=0;i<this.frames.length;i++) {
      lines.push(`file '${this.frames[i].file}'`);
      lines.push(`duration ${Math.max(0.001,(this.frames[i+1]?.time??this.duration)-this.frames[i].time).toFixed(6)}`);
    }
    lines.push(`file '${this.frames.at(-1).file}'`);
    await fs.writeFile(path.join(this.frameDir,'frames.txt'),lines.join('\n'));
    await fs.writeFile(path.join(this.directory,'recording.json'),JSON.stringify({width:1920,height:1080,fps:30,audio:!!this.hasAudio,duration:this.duration,frames:this.frames.length},null,2));
  }
  async encode() {
    await runProcess(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-y','-f','concat','-safe','0','-i','frames.txt',...(this.hasAudio?['-i',path.join(this.directory,'audio.webm'),'-map','0:v','-map','1:a','-c:a','aac','-b:a','160k','-af','apad']:[]),'-vf','fps=30,scale=1920:1080:flags=lanczos','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart','-t',String(this.duration),path.join(this.directory,'movie.mp4')],{cwd:this.frameDir});
    return path.join(this.directory,'movie.mp4');
  }
}
