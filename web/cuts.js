const $=id=>document.getElementById(id);
let project,current,timer;
const json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function api(url,options){const response=await fetch('/api'+url,options),body=await response.json();if(!response.ok)throw new Error(body.error);return body;}
function error(e){$('error').hidden=false;$('error').textContent=e.message;}
function clear(){$('error').hidden=true;}
$('recipe').value=JSON.stringify({start:'project',setup:[],actions:[{type:'wait',ms:1000}]},null,2);
$('source').onchange=async e=>{try{
  clear();const file=e.target.files[0];if(!file)return;
  project=await api('/projects',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file});
  project.plan=await api(`/projects/${project.id}/cut-plan`);
  const structure=await api(`/projects/${project.id}/structure`);
  project.structure=structure;
  $('presentationTarget').replaceChildren(...structure.targets.map(t=>new Option(t.name,t.name)));
  $('presentationTarget').value=structure.targets.find(t=>!t.isStage)?.name??structure.targets[0].name;$('presentationTarget').disabled=false;$('presentationSample').disabled=false;
  $('comparisonSample').disabled=(structure.targets.find(t=>t.name===$('presentationTarget').value)?.costumes.length??0)<2;
  const boardTarget=structure.targets.find(t=>!t.isStage&&t.blocks.some(b=>b.opcode==='control_start_as_clone'))??structure.targets.find(t=>!t.isStage);
  const boardLists=structure.targets.flatMap(t=>t.lists.map(v=>({...v,target:t.name}))),boardList=boardLists.find(v=>v.scope==='global'&&v.name==='マスの状態')??boardLists.find(v=>v.scope==='global')??boardLists[0];
  project.boardExample=boardTarget&&boardList?{target:boardTarget.name,clones:boardTarget.blocks.some(b=>b.opcode==='control_start_as_clone'),list:{name:boardList.name,id:boardList.id,scope:boardList.scope,target:boardList.target}}:null;
  $('boardSample').disabled=!project.boardExample;
  project.monitorExamples=structure.targets.flatMap(t=>[...t.variables.map(v=>({...v,kind:'variable'})),...t.lists.map(v=>({...v,kind:'list'}))].map(v=>({kind:v.kind,name:v.name,id:v.id,scope:v.scope,target:t.name})));
  $('monitorTarget').replaceChildren(...project.monitorExamples.map((v,i)=>new Option(`${v.scope==='global'?'全体':v.target} / ${v.kind==='list'?'リスト':'変数'} / ${v.name}`,String(i))));
  const firstList=project.monitorExamples.findIndex(v=>v.kind==='list');if(firstList>=0)$('monitorTarget').value=String(firstList);
  $('monitorTarget').disabled=$('monitorSample').disabled=!project.monitorExamples.length;
  $('paintTarget').replaceChildren(...structure.targets.map(t=>{const option=new Option(t.name,t.name);option.dataset.isStage=String(t.isStage);return option;}));
  $('paintTarget').value=structure.targets.find(t=>!t.isStage)?.name??structure.targets[0].name;$('paintTarget').disabled=false;$('paintSample').disabled=false;
  $('sourceName').textContent=file.name;$('render').disabled=false;$('range').disabled=false;$('to').value=project.plan.actions.length;
  $('plan').replaceChildren(...project.plan.actions.map(a=>{const li=document.createElement('li');li.textContent=`${a.type} ${a.opcode||a.target||a.name||''} ${a.sourceId||''}`;return li;}));
  $('status').textContent='範囲またはカット設定を指定してください。';
}catch(e){error(e);}};
$('range').onclick=()=>{try{
  const from=Number($('from').value),to=Number($('to').value);
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>project.plan.actions.length)throw new Error('制作手順内の開始・終了番号を指定してください。');
  $('recipe').value=JSON.stringify({start:'blank',setup:project.plan.actions.slice(0,from-1),actions:project.plan.actions.slice(from-1,to)},null,2);
}catch(e){error(e);}};
$('render').onclick=async()=>{try{clear();const recipe=JSON.parse($('recipe').value);await watch((await api('/cuts',json({...recipe,projectId:project.id,title:$('title').value,editorZoom:Number($('editorZoom').value),subtitleMargin:Number($('subtitleMargin').value),beforeMs:Number($('before').value)*1000,afterMs:Number($('after').value)*1000}))).id);}catch(e){error(e);}};
$('paintSample').onclick=()=>{
  clear();$('title').value='空マス・白マス・黒マスの作画';
  $('recipe').value=JSON.stringify({start:'blank',clearAssets:true,setup:[{type:'target.select',target:$('paintTarget').value,isStage:$('paintTarget').selectedOptions[0].dataset.isStage==='true'}],actions:[
   {type:'costume.create',name:'空マス'},{type:'paint.view',scale:4},
   {type:'paint.shape',shape:'rectangle',x:-12,y:12,width:24,height:24,fill:'#008000',stroke:'#000000',strokeWidth:0},
   {type:'paint.style',strokeWidth:4},{type:'costume.duplicate',name:'白マス'},{type:'paint.view',scale:4},
   {type:'paint.shape',shape:'ellipse',x:-10,y:10,width:20,height:20,fill:'#ffffff',stroke:null,strokeWidth:0},
   {type:'costume.duplicate',name:'黒マス'},{type:'paint.select',index:1},{type:'paint.style',fill:'#000000'}
  ]},null,2);
 };
$('boardSample').onclick=()=>{
 const b=project.boardExample;if(!b)return;clear();$('title').value='盤面クリックの実演';
 const conditions=[{type:'list',...b.list,property:'length',value:64}];if(b.clones)conditions.push({type:'cloneCount',target:b.target,value:64});
 $('recipe').value=JSON.stringify({start:'project',setup:[{type:'project.start'},{type:'runtime.wait',conditions,timeoutMs:10000},{type:'board.configure',rows:8,columns:8,cellWidth:24,cellHeight:24,target:b.target}],actions:[{type:'board.click',row:1,column:1},{type:'runtime.wait',conditions:[{type:'list',...b.list,index:1,value:'黒マス'}],timeoutMs:10000}]},null,2);
};
$('monitorSample').onclick=()=>{try{
 const ref=project.monitorExamples[Number($('monitorTarget').value)];if(!ref)return;
 const index=Number($('monitorIndex').value);if(ref.kind==='list'&&(!Number.isInteger(index)||index<1||index>200000))throw new Error('リストの項目番号は1以上の整数です。');
 clear();$('title').value='モニターの表示・配置';
 const setup=$('monitorStart').checked?[{type:'project.start'},...(ref.kind==='list'?[{type:'runtime.wait',conditions:[{type:'list',scope:ref.scope,target:ref.target,id:ref.id,property:'length',op:'gte',value:index}],timeoutMs:10000}]:[])]:[];
 const actions=[{type:'monitor.show',...ref},{type:'monitor.layout',...ref,x:12,y:50,...(ref.kind==='list'?{width:180,height:220}:{mode:'default'})},...(ref.kind==='list'?[{type:'monitor.scroll',...ref,index,align:'center',duration:600}]:[]),{type:'wait',ms:1000}];
 $('recipe').value=JSON.stringify({start:'project',setup,actions},null,2);
}catch(e){error(e);}};
$('presentationTarget').onchange=()=>{$('comparisonSample').disabled=(project?.structure.targets.find(t=>t.name===$('presentationTarget').value)?.costumes.length??0)<2;};
$('presentationSample').onclick=()=>{try{
 clear();const t=project.structure.targets.find(t=>t.name===$('presentationTarget').value),name=$('presentationName').value.trim();if(!name)throw new Error('変数名を入力してください。');const scope=t.isStage?'global':'local';$('title').value='説明の節目・'+name;
 $('recipe').value=JSON.stringify({start:'blank',setupSpeed:10,setup:[t.selectAction],narration:{markers:[{id:'four',atMs:15000,text:'4にします'}]},sync:{late:'error',toleranceMs:120},timing:{move:250,drag:600,type:75,pan:200,pause:80},beats:[
  {id:'create',text:name+'という変数を作ります',before:[{type:'variables',scope,target:t.name,names:[]}],beforeMs:300,actions:[{type:'variable.create',name,scope,monitor:{visible:false},cues:{'dialog.opened':{holdMs:300},'name.entered':{framing:{kind:'variableName'},holdMs:500},'scope.selected':{framing:{kind:t.isStage?'dialog':'variableScope',editorZoom:1.5},holdMs:800}}}],after:[{type:'variables',scope,target:t.name,names:[name]}],afterMs:600},
  {id:'number',text:'値を4にします',actions:[{type:'block.add',sourceId:'explain-value',opcode:t.isStage?'control_wait':'motion_movesteps',place:{x:250,y:220}},{type:'block.input',block:'explain-value',input:t.isStage?'DURATION':'STEPS',value:'4',cues:{'target.visible':{framing:{kind:'input',block:'explain-value',input:t.isStage?'DURATION':'STEPS',scale:1.2}},'value.before':{at:'four'},'value.entered':{holdMs:500,mode:'freeze'}}}],afterMs:600}
 ]},null,2);
}catch(e){error(e);}};
$('comparisonSample').onclick=()=>{const t=project.structure.targets.find(t=>t.name===$('presentationTarget').value);if(t.costumes.length<2)return;clear();$('title').value='コスチューム名の比較';$('recipe').value=JSON.stringify({start:'project',setup:[t.selectAction],beats:t.costumes.slice(0,2).map((c,i)=>({id:'name-'+i,text:c.name,actions:[{type:'costume.select',index:i},{type:'view.focus',subject:{kind:'costumeName',editorZoom:1.5}}],afterMs:1000,mode:'freeze'}))},null,2);};
$('markerFile').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>2*1024*1024)throw new Error('目印JSONは2MB以下です。');const raw=JSON.parse(await file.text()),markers=Array.isArray(raw)?raw:raw.markers;if(!Array.isArray(markers)||markers.some(m=>typeof m.id!=='string'||!Number.isFinite(m.atMs)||m.atMs<0))throw new Error('idとatMsを持つ目印の配列を指定してください。');const recipe=JSON.parse($('recipe').value);recipe.narration={...recipe.narration,markers};$('recipe').value=JSON.stringify(recipe,null,2);clear();$('status').textContent=`音声の目印を${markers.length}件取り込みました。`;}catch(e){error(e);}};
async function history(){const jobs=(await api('/jobs')).filter(j=>j.kind==='cut');const selected=$('history').value;$('history').replaceChildren(...jobs.map(j=>new Option(`${j.name} · ${j.status} · ${new Date(j.startedAt).toLocaleString('ja-JP')}`,j.id)));if(jobs.some(j=>j.id===selected))$('history').value=selected;return jobs;}
async function poll(){try{
  const j=await api('/jobs/'+current),active=['running','encoding'].includes(j.status);
  $('status').textContent=`${j.name} · ${j.current}\n${j.step} / ${j.total} 操作`;$('cancel').hidden=!active;$('render').disabled=active||!project;$('retake').disabled=active;
  if(!active){clearInterval(timer);if(j.error)error(new Error(j.error));$('links').replaceChildren(...j.artifacts.map(a=>{const link=document.createElement('a');link.href=a.url;link.textContent=a.name;link.download=a.name;return link;}));const movie=j.artifacts.find(a=>a.name==='movie.mp4');if(movie){$('movie').poster=j.artifacts.find(a=>a.name==='start.jpg')?.url||'';$('movie').src=movie.url;$('movie').hidden=false;}await history();$('history').value=current;}
  if(!active){const timeline=j.artifacts.find(a=>a.name==='timeline.json');if(timeline){const data=await (await fetch(timeline.url)).json();$('timingReport').textContent=[...data.events.filter(e=>['beat-start','marker','hold-start','beat-end'].includes(e.type)).map(e=>`${(e.atMs/1000).toFixed(2)}秒 / ${e.frame}f · ${e.beat??''} ${e.text??''} · ${e.type}${e.marker?' '+e.marker:''}${e.lateMs!==undefined?' 遅れ'+Math.round(e.lateMs)+'ms':''}`),...data.warnings.map(w=>'確認: '+JSON.stringify(w))].join('\n');$('timingDetails').hidden=false;}}
}catch(e){clearInterval(timer);error(e);}}
async function watch(id){current=id;clearInterval(timer);$('movie').hidden=true;$('timingDetails').hidden=true;$('links').replaceChildren();timer=setInterval(poll,1000);await poll();}
$('cancel').onclick=async()=>{try{await api(`/jobs/${current}/cancel`,json({}));}catch(e){error(e);}};
$('open').onclick=async()=>{if($('history').value){clear();await watch($('history').value);}};
$('retake').onclick=async()=>{try{clear();if(!$('history').value)throw new Error('撮り直すカットを選択してください。');await watch((await api(`/cuts/${$('history').value}/retake`,json({}))).id);}catch(e){error(e);}};
history().then(jobs=>{const active=jobs.find(j=>['running','encoding'].includes(j.status));if(active)return watch(active.id);}).catch(error);
