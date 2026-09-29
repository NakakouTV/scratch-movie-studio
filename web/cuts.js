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
  $('sourceName').textContent=file.name;$('render').disabled=false;$('range').disabled=false;$('to').value=project.plan.actions.length;
  $('plan').replaceChildren(...project.plan.actions.map(a=>{const li=document.createElement('li');li.textContent=`${a.type} ${a.opcode||a.target||a.name||''} ${a.sourceId||''}`;return li;}));
  $('status').textContent='範囲またはカット設定を指定してください。';
}catch(e){error(e);}};
$('range').onclick=()=>{try{
  const from=Number($('from').value),to=Number($('to').value);
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>project.plan.actions.length)throw new Error('制作手順内の開始・終了番号を指定してください。');
  $('recipe').value=JSON.stringify({start:'blank',setup:project.plan.actions.slice(0,from-1),actions:project.plan.actions.slice(from-1,to)},null,2);
}catch(e){error(e);}};
$('render').onclick=async()=>{try{clear();const recipe=JSON.parse($('recipe').value);await watch((await api('/cuts',json({...recipe,projectId:project.id,title:$('title').value,beforeMs:Number($('before').value)*1000,afterMs:Number($('after').value)*1000}))).id);}catch(e){error(e);}};
async function history(){const jobs=(await api('/jobs')).filter(j=>j.kind==='cut');const selected=$('history').value;$('history').replaceChildren(...jobs.map(j=>new Option(`${j.name} · ${j.status} · ${new Date(j.startedAt).toLocaleString('ja-JP')}`,j.id)));if(jobs.some(j=>j.id===selected))$('history').value=selected;return jobs;}
async function poll(){try{
  const j=await api('/jobs/'+current),active=['running','encoding'].includes(j.status);
  $('status').textContent=`${j.name} · ${j.current}\n${j.step} / ${j.total} 操作`;$('cancel').hidden=!active;$('render').disabled=active||!project;$('retake').disabled=active;
  if(!active){clearInterval(timer);if(j.error)error(new Error(j.error));$('links').replaceChildren(...j.artifacts.map(a=>{const link=document.createElement('a');link.href=a.url;link.textContent=a.name;link.download=a.name;return link;}));const movie=j.artifacts.find(a=>a.name==='movie.mp4');if(movie){$('movie').poster=j.artifacts.find(a=>a.name==='start.jpg')?.url||'';$('movie').src=movie.url;$('movie').hidden=false;}await history();$('history').value=current;}
}catch(e){clearInterval(timer);error(e);}}
async function watch(id){current=id;clearInterval(timer);$('movie').hidden=true;$('links').replaceChildren();timer=setInterval(poll,1000);await poll();}
$('cancel').onclick=async()=>{try{await api(`/jobs/${current}/cancel`,json({}));}catch(e){error(e);}};
$('open').onclick=async()=>{if($('history').value){clear();await watch($('history').value);}};
$('retake').onclick=async()=>{try{clear();if(!$('history').value)throw new Error('撮り直すカットを選択してください。');await watch((await api(`/cuts/${$('history').value}/retake`,json({}))).id);}catch(e){error(e);}};
history().then(jobs=>{const active=jobs.find(j=>['running','encoding'].includes(j.status));if(active)return watch(active.id);}).catch(error);
