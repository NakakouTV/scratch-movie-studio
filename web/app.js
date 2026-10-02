const $=id=>document.getElementById(id);
let project,jobId,poller,previewTimer,planUrl;
async function api(url,options={}) {
  const res=await fetch('/api'+url,options);const data=await res.json();if(!res.ok)throw new Error(data.error||res.statusText);return data;
}
function error(e){$('error').hidden=false;$('error').textContent=e.message;}
function clearError(){$('error').hidden=true;}
function json(body){return {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};}
function actionText(a){const names={'tab.select':'タブを切り替え','costume.add':'背景・コスチュームを追加','costume.select':'表示する画像を選択','sound.add':'音を追加','target.select':'対象を選択','variable.create':'変数・リストを作成','procedure.create':'定義ブロックを作成','block.add':'ブロックを配置','block.input':'定数を入力','block.field':'項目を設定','broadcast.create':'メッセージを作成'};return `${names[a.type]||a.type} · ${a.opcode||a.name||a.target||a.tab||(a.index!==undefined?`${a.index+1}番目`:null)||a.mutation?.proccode||[a.field||a.input,a.value].filter(v=>v!==undefined).join(' = ')}`;}
function showProject(p){
  project=p;clearError();$('build').disabled=false;
  $('projectInfo').replaceChildren();const name=document.createElement('strong');name.textContent=p.name;$('projectInfo').append(name);
  for(const text of [`${p.summary.sprites} スプライト`,`${p.summary.blocks} ブロック`,`${p.summary.actions} 操作`]){const span=document.createElement('span');span.textContent=text;$('projectInfo').append(span);}
  $('planSummary').textContent=`${p.plan.actions.length}操作を自動生成しました。各タブで素材を追加してから、プログラムを組み立てます。`;
  $('plan').replaceChildren(...p.plan.actions.map((a,i)=>{const li=document.createElement('li');li.textContent=actionText(a);li.id='action-'+i;return li;}));
  $('warnings').textContent=p.plan.warnings.join('\n');
  showScenes(p.plan.scenes||[{id:'scene-1',title:'プログラムの制作',from:1,to:p.plan.actions.length,enabled:true}]);
  if(planUrl)URL.revokeObjectURL(planUrl);planUrl=URL.createObjectURL(new Blob([JSON.stringify(p.plan,null,2)],{type:'application/json'}));
  $('downloadPlan').href=planUrl;$('downloadPlan').download='plan.json';$('downloadPlan').hidden=false;
}
async function upload(file){if(!file)return;try{showProject(await api('/projects',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file}));}catch(e){error(e);}}
$('file').onchange=e=>upload(e.target.files[0]);
$('dropzone').ondragover=e=>{e.preventDefault();$('dropzone').classList.add('over');};
$('dropzone').ondragleave=()=>$('dropzone').classList.remove('over');
$('dropzone').ondrop=e=>{e.preventDefault();$('dropzone').classList.remove('over');upload(e.dataTransfer.files[0]);};
$('loadSample').onclick=async()=>{try{if($('samples').value)showProject(await api('/samples/load',json({name:$('samples').value})));}catch(e){error(e);}};
api('/samples').then(names=>names.forEach(n=>{const o=document.createElement('option');o.value=n;o.textContent=n;$('samples').append(o);})).catch(error);
$('build').onclick=async()=>{
  try {
    clearError();$('build').disabled=true;$('cancel').disabled=false;$('artifacts').replaceChildren();$('verification').className='muted';$('verification').textContent='再構築後に元のプログラムと比較します。';
    const job=await api('/jobs',json({projectId:project.id,speed:Number($('speed').value),minScale:Number($('minScale').value),subtitleMargin:Number($('subtitleMargin').value),demoSeconds:Number($('demoSeconds').value),record:$('record').checked,outputMode:$('outputMode').value,scenes:sceneSelection()}));
    await watchJob(job.id);await refreshHistory();
  }catch(e){error(e);$('build').disabled=false;}
};
let previewBusy=false;
async function refreshPreview(){if(previewBusy||!jobId)return;previewBusy=true;try{const r=await fetch(`/api/jobs/${jobId}/preview`);if(r.ok&&r.status!==204){const old=$('live').src;$('live').src=URL.createObjectURL(await r.blob());if(old.startsWith('blob:'))URL.revokeObjectURL(old);}}finally{previewBusy=false;}}
async function poll(){
  try {
    const j=await api('/jobs/'+jobId);$('state').className='pill '+j.status;$('state').textContent={running:'制作中',encoding:'書き出し中',completed:'完成',failed:'確認が必要',cancelled:'中止',paused:'一時停止'}[j.status]||j.status;
    if(j.kind==='cut')$('verification').textContent='独立カットは部分的な制作・実演を許すため、元sb3との完成一致比較は行いません。撮り直しは独立カット画面から行えます。';
    const active=['running','encoding'].includes(j.status);
    $('build').disabled=active||!project;$('cancel').hidden=!active;
    $('pause').hidden=!active||!j.checkpointable||j.phase==='finishing';$('pause').disabled=!!j.pauseRequested;
    $('pause').textContent=j.pauseRequested?'操作の完了後に保存します…':'途中保存して一時停止';
    $('resume').hidden=active||!j.resumable;
    $('checkpoint').textContent=j.checkpoint?`${j.checkpoint.step}操作目まで保存済み（${new Date(j.checkpoint.savedAt).toLocaleTimeString('ja-JP')}）。再開時はその次から続けます。`:j.checkpointable===false?'直接のマウス・キー入力を含む手順は途中再開に対応していません。':'最初の保存地点を準備中です。';
    if(j.kind==='cut')$('checkpoint').textContent='独立カットは保存した設定から準備をやり直して撮り直せます。';
    $('current').textContent=[j.currentScene,j.current].filter(Boolean).join(' · ');$('count').textContent=`${j.step} / ${j.total} 操作`;$('progress').max=j.total||1;$('progress').value=j.step;
    document.querySelector('#plan li.active')?.classList.remove('active');$('action-'+(j.step-1))?.classList.add('active');
    if(['completed','failed','cancelled','paused'].includes(j.status)){
      clearInterval(poller);clearInterval(previewTimer);await refreshPreview();$('build').disabled=!project;$('cancel').hidden=true;
      $('artifacts').replaceChildren(...[...j.artifacts].sort((a,b)=>(a.name==='movie.mp4'?-1:b.name==='movie.mp4'?1:0)).map(a=>{const link=document.createElement('a');link.href=a.url;link.download=a.name.split('/').at(-1);link.textContent=a.sceneId?`↓ ${a.title}`:({'movie.mp4':'↓ 全体動画を保存','scenes.json':'↓ 場面一覧','rebuilt.sb3':'↓ 完成したsb3','checkpoint.sb3':'↓ 保存地点のsb3','plan.json':'↓ 操作手順','verification.json':'↓ 検証レポート','log.json':'↓ 操作ログ'})[a.name]||a.name;return link;}));
      if(j.verification){$('verification').textContent=j.verification.ok?'✓ ブロック接続・定数・変数・素材の比較に合格しました。':`元のプログラムと${j.verification.differences.length}件の差があります。`;$('verification').className=j.verification.ok?'ok':'notice';}
      if(j.error)error(new Error(j.error));
      const movies=j.artifacts.filter(a=>a.name.endsWith('.mp4'));
      const movie=movies.find(a=>a.name==='movie.mp4')||movies[0];if(movie){$('video').poster=j.artifacts.find(a=>a.name==='preview.jpg')?.url||'';$('video').src=movie.url;$('video').hidden=false;$('live').hidden=true;}
      if(movies.length>1){const select=document.createElement('select');select.setAttribute('aria-label','再生する場面');select.append(...movies.map(m=>new Option(m.title||'全体動画',m.url)));select.value=movie.url;select.onchange=()=>{$('video').src=select.value;};$('artifacts').prepend(select);}
      await refreshHistory();
    }
  }catch(e){clearInterval(poller);clearInterval(previewTimer);error(e);$('build').disabled=false;}
}
$('cancel').onclick=async()=>{if(jobId)await api(`/jobs/${jobId}/cancel`,json({}));$('cancel').disabled=true;};
$('pause').onclick=async()=>{try{await api(`/jobs/${jobId}/pause`,json({}));$('pause').disabled=true;await poll();}catch(e){error(e);}};
$('resume').onclick=async()=>{try{clearError();$('resume').disabled=true;await api(`/jobs/${jobId}/resume`,json({}));await watchJob(jobId);}catch(e){error(e);}finally{$('resume').disabled=false;}};
async function watchJob(id){
  jobId=id;clearError();$('cancel').disabled=false;$('video').hidden=true;$('placeholder').hidden=true;$('live').hidden=false;
  $('artifacts').replaceChildren();$('verification').className='muted';$('verification').textContent='完成後に元のプログラムと比較します。';
  clearInterval(poller);clearInterval(previewTimer);poller=setInterval(poll,1000);previewTimer=setInterval(refreshPreview,1400);await poll();await refreshPreview();
}
async function refreshHistory(){
  const jobs=await api('/jobs');$('history').replaceChildren(new Option('制作を選択',''),...jobs.map(j=>new Option(`${j.name} · ${new Date(j.startedAt).toLocaleString('ja-JP')} · ${{completed:'完成',paused:'一時停止',failed:'確認が必要',running:'制作中',encoding:'保存中',cancelled:'中止'}[j.status]||j.status}`,j.id)));
  if(jobId)$('history').value=jobId;return jobs;
}
$('history').onchange=async()=>{if($('history').value)await watchJob($('history').value);};
refreshHistory().then(jobs=>{const current=jobs.find(j=>['running','encoding','paused'].includes(j.status)||j.resumable);if(current)return watchJob(current.id);}).catch(error);
let proposedScenes=[];
function showScenes(scenes){
  proposedScenes=scenes.map(s=>({...s}));
  $('sceneList').replaceChildren(...proposedScenes.map((s,i)=>{
    const row=document.createElement('div');row.className='scene-row';
    const check=document.createElement('input');check.type='checkbox';check.checked=s.enabled!==false;check.setAttribute('aria-label',`場面 ${i+1} を出力`);check.onchange=()=>{s.enabled=check.checked;};
    const name=document.createElement('input');name.type='text';name.value=s.title;name.maxLength=200;name.setAttribute('aria-label',`場面 ${i+1} の名前`);name.oninput=()=>{s.title=name.value;};
    const range=document.createElement('span');range.className='muted small';range.textContent=`${s.from}〜${s.to} 操作`;
    row.append(check,name,range);return row;
  }));
  $('sceneCount').textContent=`${scenes.length} 場面`;updateSceneVisibility();
}
function sceneSelection(){return proposedScenes.map(s=>({...s}));}
function updateSceneVisibility(){$('scenePanel').hidden=!project||!$('record').checked||$('outputMode').value==='full';$('outputMode').disabled=!$('record').checked;}
$('outputMode').onchange=updateSceneVisibility;$('record').onchange=updateSceneVisibility;
