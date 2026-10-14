import JSZip from 'jszip';
import {createHash} from 'node:crypto';

// A small click-and-redraw grid, not an Othello rule engine.
export async function boardDemo(){
 const zip=new JSZip(),blocks={};let serial=0;
 const b=(opcode,inputs={},fields={})=>{
  const id='demo-'+(++serial),node=blocks[id]={opcode,next:null,parent:null,inputs:{},fields,shadow:false,topLevel:false};
  for(const [key,value] of Object.entries(inputs)){
   if(typeof value==='string'&&blocks[value]){node.inputs[key]=[2,value];blocks[value].parent=id;}
   else node.inputs[key]=[1,[typeof value==='number'?4:10,String(value)]];
  }
  return id;
 };
 const chain=ids=>{for(let i=1;i<ids.length;i++){blocks[ids[i-1]].next=ids[i];blocks[ids[i]].parent=ids[i-1];}return ids[0];};
 const variable=(name,id)=>b('data_variable',{}, {VARIABLE:[name,id]});
 const set=(name,id,value)=>b('data_setvariableto',{VALUE:value},{VARIABLE:[name,id]});
 const change=(name,id,value)=>b('data_changevariableby',{VALUE:value},{VARIABLE:[name,id]});
 const menu=(opcode,fields)=>{const id=b(opcode,{},fields);blocks[id].shadow=true;return id;};
 const root=(ids,x,y)=>{const id=chain(ids);blocks[id].topLevel=true;blocks[id].x=x;blocks[id].y=y;};
 const list={LIST:['マスの状態','board']},at=()=>b('data_itemoflist',{INDEX:variable('クローンID','index')},list);
 const coordinate=(name,id)=>b('operator_add',{NUM1:-48,NUM2:b('operator_multiply',{NUM1:b('operator_subtract',{NUM1:variable(name,id),NUM2:.5}),NUM2:24})});
 const cell=chain([
  change('クローンID','index',1),b('motion_setx',{X:coordinate('横','column')}),b('motion_sety',{Y:coordinate('縦','row')}),
  b('control_create_clone_of',{CLONE_OPTION:menu('control_create_clone_of_menu',{CLONE_OPTION:['_myself_',null]})}),change('横','column',1)
 ]);
 const row=chain([set('横','column',1),b('control_repeat',{TIMES:4,SUBSTACK:cell}),change('縦','row',1)]);
 root([b('event_whenflagclicked'),b('looks_hide'),b('data_deletealloflist',{},list),b('control_repeat',{TIMES:16,SUBSTACK:b('data_addtolist',{ITEM:'空マス'},list)}),set('クローンID','index',0),set('縦','row',1),b('control_repeat',{TIMES:4,SUBSTACK:row}),set('クローンID','index',0),set('進行状況','phase','準備完了')],100,100);
 root([b('control_start_as_clone'),b('looks_show'),b('control_forever',{SUBSTACK:b('looks_switchcostumeto',{COSTUME:at()})})],450,100);
 const place=chain([b('control_wait',{DURATION:.15}),b('data_replaceitemoflist',{INDEX:variable('クローンID','index'),ITEM:'黒マス'},list),set('最後のクリック','last',variable('クローンID','index')),set('進行状況','phase','白のターン')]);
 root([b('event_whenthisspriteclicked'),b('control_if',{CONDITION:b('operator_and',{OPERAND1:b('operator_gt',{OPERAND1:variable('クローンID','index'),OPERAND2:0}),OPERAND2:b('operator_equals',{OPERAND1:at(),OPERAND2:'空マス'})}),SUBSTACK:place})],800,100);
 const costumes=[];
 for(const [name,fill] of [['空マス',null],['白マス','#ffffff'],['黒マス','#000000']]){
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"><rect x="1" y="1" width="24" height="24" fill="#008000" stroke="#000000" stroke-width="2"/>'+(fill?'<circle cx="13" cy="13" r="10" fill="'+fill+'"/>':'')+'</svg>',assetId=createHash('md5').update(svg).digest('hex');
  zip.file(assetId+'.svg',svg);costumes.push({name,assetId,md5ext:assetId+'.svg',dataFormat:'svg',bitmapResolution:1,rotationCenterX:13,rotationCenterY:13});
 }
 const backdrop='<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"></svg>',assetId=createHash('md5').update(backdrop).digest('hex');zip.file(assetId+'.svg',backdrop);
 const stage={isStage:true,name:'Stage',variables:{phase:['進行状況','停止中'],last:['最後のクリック',0]},lists:{board:['マスの状態',[]]},broadcasts:{},blocks:{},comments:{},currentCostume:0,costumes:[{name:'背景',assetId,md5ext:assetId+'.svg',dataFormat:'svg',bitmapResolution:1,rotationCenterX:240,rotationCenterY:180}],sounds:[],volume:100,layerOrder:0,tempo:60,videoTransparency:50,videoState:'on'};
 const sprite={isStage:false,name:'マス',variables:{index:['クローンID',0],row:['縦',0],column:['横',0]},lists:{private:['マスの状態',['local']]},broadcasts:{},blocks,comments:{},currentCostume:0,costumes,sounds:[],volume:100,layerOrder:1,visible:false,x:0,y:0,size:100,direction:90,draggable:false,rotationStyle:'all around'};
 const monitors=[{id:'phase',mode:'default',opcode:'data_variable',params:{VARIABLE:'進行状況'},spriteName:null,value:'停止中',width:0,height:0,x:5,y:5,visible:true,sliderMin:0,sliderMax:100,isDiscrete:true}];
 zip.file('project.json',JSON.stringify({targets:[stage,sprite],monitors,extensions:[],meta:{semver:'3.0.0',vm:'0.2.0',agent:'Scratch Movie Studio test'}}));
 return zip.generateAsync({type:'nodebuffer'});
}
