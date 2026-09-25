import JSZip from 'jszip';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const block=(opcode,next=null,parent=null,inputs={},fields={})=>({opcode,next,parent,inputs,fields,shadow:false,topLevel:!parent,...(!parent?{x:80,y:80}:{})});
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="9" fill="#ffab19"/></svg>';
const backdrop='<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="white"/></svg>';
const asset=(name,assetId)=>({name,assetId,dataFormat:'svg',md5ext:assetId+'.svg',bitmapResolution:1,rotationCenterX:10,rotationCenterY:10});
const base={targets:[{isStage:true,name:'Stage',variables:{score:['点数',7]},lists:{items:['履歴',['開始','描画']]},broadcasts:{message:'描画する'},blocks:{},comments:{},currentCostume:0,costumes:[{...asset('背景','background'),rotationCenterX:240,rotationCenterY:180}],sounds:[],volume:100,layerOrder:0,tempo:60,videoTransparency:50,videoState:'off'},{isStage:false,name:'ペン',variables:{local:['長さ',100]},lists:{},broadcasts:{},blocks:{},comments:{},currentCostume:0,costumes:[asset('点','dot')],sounds:[],volume:100,layerOrder:1,visible:true,x:0,y:0,size:100,direction:90,draggable:false,rotationStyle:'all around'}],monitors:[],extensions:['pen'],meta:{semver:'3.0.0',vm:'15.1.1'}};
const t=base.targets[1];
t.blocks={
  flag:block('event_whenflagclicked','clear'),
  clear:block('pen_clear','color','flag'),
  color:block('pen_setPenColorToColor','size','clear',{COLOR:[1,[9,'#123456']]}),
  size:block('pen_setPenSizeTo','down','color',{SIZE:[1,[4,'3']]}),
  down:block('pen_penDown','repeat','size'),
  repeat:block('control_repeat','up','down',{TIMES:[1,[6,'4']],SUBSTACK:[2,'move']}),
  move:block('motion_movesteps','turn','repeat',{STEPS:[3,[12,'長さ','local'],[4,'10']]}),
  turn:block('motion_turnright',null,'move',{DEGREES:[1,[4,'90']]}),
  up:block('pen_penUp','say','repeat'),
  say:block('looks_say','beep','up',{MESSAGE:[1,[10,'できました！']]}),
  beep:block('sound_playuntildone',null,'say',{SOUND_MENU:[1,'sound-menu']}),
  'sound-menu':{...block('sound_sounds_menu',null,'beep',{}, {SOUND_MENU:['確認音',null]}),shadow:true}
};
const zip=new JSZip();
for(const target of base.targets)for(const c of target.costumes){const content=c.assetId==='dot'?svg:backdrop;c.assetId=createHash('md5').update(content).digest('hex');c.md5ext=c.assetId+'.svg';zip.file(c.md5ext,content);}
const rate=22050,samples=11025,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(2*Math.PI*660*i/rate)*7000*Math.min(1,i/150,(samples-i)/150)),44+i*2);
const soundId=createHash('md5').update(wav).digest('hex');zip.file(soundId+'.wav',wav);
t.sounds=[{name:'確認音',assetId:soundId,dataFormat:'wav',format:'',rate,sampleCount:samples,md5ext:soundId+'.wav'}];
zip.file('project.json',JSON.stringify(base));
await fs.writeFile('PEN動作確認.sb3',await zip.generateAsync({type:'nodebuffer'}));
console.log('Created PEN動作確認.sb3');
