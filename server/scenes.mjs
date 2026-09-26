import fs from 'node:fs/promises';
import path from 'node:path';
import {runProcess,VIDEO_PROFILE} from './recorder.mjs';

export function normalizeScenes(plan,requested){
  const input=requested??plan.scenes??(plan.actions.length?[{title:'プログラムの制作',from:1,to:plan.actions.length}]:[]);
  if(!Array.isArray(input)||input.length>1000)throw new Error('場面は1000件以内の配列で指定してください。');
  let next=1;
  const scenes=input.map((s,i)=>{
    if(!s||!Number.isInteger(s.from)||!Number.isInteger(s.to)||s.from!==next||s.to<s.from||s.to>plan.actions.length)throw new Error('場面の範囲は1操作目から最後まで、順番に重複・隙間なく指定してください。');
    if(typeof s.title!=='string'||!s.title.trim()||s.title.length>200)throw new Error('場面名は1〜200文字で指定してください。');
    if(s.enabled!==undefined&&typeof s.enabled!=='boolean')throw new Error('場面の出力設定はtrue / falseです。');
    next=s.to+1;
    return {id:`scene-${i+1}`,title:s.title.trim(),from:s.from,to:s.to,enabled:s.enabled!==false};
  });
  if(next!==plan.actions.length+1)throw new Error('場面の範囲に未指定の操作があります。');
  return scenes;
}

// Old checkpoints use the previous resampling path. New recordings have an
// exact frame count and lossless audio; copy video and encode audio only once.
export async function joinSegments(directory,segments,output){
  if(!segments.length)throw new Error('この場面には録画区間がありません。');
  await fs.mkdir(path.dirname(path.join(directory,output)),{recursive:true});
  const list=output.replace(/\.mp4$/,'.concat.txt');
  const relative=path.relative(path.dirname(path.join(directory,list)),directory).replaceAll('\\','/');
  const metadata=await Promise.all(segments.map(async s=>{
    try{return JSON.parse(await fs.readFile(path.join(directory,s,'recording.json'),'utf8'));}
    catch(e){if(e.code==='ENOENT')return null;throw e;}
  }));
  const copy=metadata.every(m=>m?.version===2&&m.profile===VIDEO_PROFILE&&Number.isInteger(m.frameCount)&&m.frameCount>0&&m.audioSamples===m.frameCount*1600);
  const prefix=relative?relative+'/':'';
  await fs.writeFile(path.join(directory,list),segments.map((s,i)=>`file '${prefix}${s}/movie.mp4'${copy?`\nduration ${(metadata[i].frameCount/30).toFixed(9)}`:''}`).join('\n'));
  const temporary=output.replace(/\.mp4$/,'.partial.mp4');
  if(copy){
    const audioList=output.replace(/\.mp4$/,'.audio.concat.txt');
    await fs.writeFile(path.join(directory,audioList),segments.map(s=>`file '${prefix}${s}/audio.flac'`).join('\n'));
    await runProcess(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-y','-copyts','-f','concat','-safe','0','-i',list,'-f','concat','-safe','0','-i',audioList,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','160k','-af','asetpts=N/SR/TB','-video_track_timescale','90000','-movflags','+faststart',temporary],{cwd:directory});
  }else{
    await runProcess(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-y','-f','concat','-safe','0','-i',list,'-vf','fps=30','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-af','aresample=async=1:first_pts=0','-movflags','+faststart',temporary],{cwd:directory});
  }
  await fs.rename(path.join(directory,temporary),path.join(directory,output));
  return {video:copy?'copy':'reencode'};
}
