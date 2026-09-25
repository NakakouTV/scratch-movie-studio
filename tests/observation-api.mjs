import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8601';
async function request(path,data,method=data===undefined?'GET':'POST'){
  const response=await fetch(base+'/api'+path,{method,...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});
  const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
}
const project=await request('/samples/load',{name:'PEN動作確認.sb3'});
const structure=await request(`/projects/${project.id}/structure`);
const target=structure.targets.find(t=>!t.isStage),compact=target.blocks.find(b=>b.synthetic);
assert.ok(compact);
const session=await request('/sessions',{projectId:project.id,timing:{move:20,drag:160,type:1,pause:30}});
const path=`/sessions/${session.id}`,state=()=>request(path+'/state'),act=a=>request(path+'/actions',a);
try{
  assert.equal(session.state.busy,false);assert.equal(session.state.lastAction,null);
  await act(target.selectAction);
  let s=await state();assert.equal(s.selectedTab,'code');assert.equal(s.locale,'ja');assert.equal(s.modal,null);
  assert.ok(s.blocks.some(b=>b.sourceId===compact.id));
  await act({type:'workspace.focus',block:compact.id});
  s=await state();assert.equal(s.lastAction.success,true);
  const view=s.workspace;assert.deepEqual((await state()).workspace,view);
  await act({type:'tab.select',tab:'costumes'});assert.equal((await state()).selectedTab,'costumes');
  await act({type:'tab.select',tab:'sounds'});assert.equal((await state()).selectedTab,'sounds');
  await act({type:'tab.select',tab:'code'});
  await act({type:'block.add',sourceId:'observation-flag',opcode:'event_whenflagclicked',place:{x:700,y:50}});
  await act({type:'block.add',sourceId:'observation-loop',opcode:'control_forever',place:{after:'observation-flag'}});
  s=await state();const flag=s.blocks.find(b=>b.sourceId==='observation-flag'),loop=s.blocks.find(b=>b.sourceId==='observation-loop');
  assert.notEqual(flag.id,flag.sourceId);assert.equal(flag.nextSourceId,loop.sourceId);assert.equal(loop.parentSourceId,flag.sourceId);
  await act({type:'project.start'});assert.equal((await state()).running,true);
  await act({type:'project.stop'});assert.equal((await state()).running,false);
  const pending=act({type:'wait',ms:1500});
  for(let i=0;i<30;i++){s=await state();if(s.busy)break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(s.busy,true);assert.equal(s.currentAction.action.type,'wait');await pending;
  assert.equal((await state()).busy,false);
  await assert.rejects(()=>act([{type:'not-supported'},{type:'wait',ms:1}]));
  s=await state();assert.equal(s.lastAction.success,false);assert.equal(s.lastAction.action.type,'not-supported');assert.ok(s.lastAction.error);assert.equal(s.busy,false);assert.equal(s.currentAction,null);
  await request(path+'/recording/start',{});assert.equal((await state()).recording,true);
  await act({type:'wait',ms:1100});
  const output=await request(path+'/recording/stop',{});assert.ok(output.url.endsWith('movie.mp4'));assert.equal((await state()).recording,false);
  assert.deepEqual((await request(path)).blocks,(await state()).blocks);
  console.log('PASS: structure IDs, compact reporters, live tabs/running/busy/recording, source connections, success/failure results');
}finally{await request(path,{},'DELETE');}
