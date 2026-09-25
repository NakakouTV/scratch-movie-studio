import fs from 'node:fs/promises';
const base='http://127.0.0.1:8601/api';
async function request(p,data,method='POST'){
  const r=await fetch(base+p,data===undefined?undefined:{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const result=await r.json();if(!r.ok)throw new Error(JSON.stringify(result));return result;
}
const p=await request('/samples/load',{name:'PEN動作確認.sb3'});
const s=await request('/sessions',{projectId:p.id,blank:true,timing:{move:20,drag:180,type:10,pause:40}});
try {
  await request(`/sessions/${s.id}/recording/start`,{});
  const mutation={proccode:'表示 %s 条件 %b',argumentnames:'["言葉","条件"]',argumentids:'["text","condition"]',argumentdefaults:'["",false]',warp:'false'};
  const actions=[
    {type:'target.select',target:'ペン'},
    {type:'variable.create',name:'全体の値',scope:'global',sourceId:'global',value:7},
    {type:'variable.create',name:'専用の値',scope:'local',sourceId:'local',value:12},
    {type:'procedure.create',sourceId:'definition',prototypeId:'proto',mutation,x:100,y:300},
    {type:'block.add',sourceId:'flag',opcode:'event_whenflagclicked',place:{x:100,y:100}},
    {type:'block.add',sourceId:'call',opcode:'procedures_call',mutation,place:{after:'flag'}},
    {type:'block.input',block:'call',input:'text',value:'テスト123'},
    {type:'block.add',sourceId:'if',opcode:'control_if',place:{after:'definition'}},
    {type:'block.add',sourceId:'condition',opcode:'argument_reporter_boolean',fields:{VALUE:['条件',null]},place:{parent:'if',input:'CONDITION'}},
    {type:'block.add',sourceId:'say',opcode:'looks_say',place:{parent:'if',input:'SUBSTACK'}},
    {type:'block.add',sourceId:'value',opcode:'data_variable',fields:{VARIABLE:['専用の値','local']},place:{parent:'say',input:'MESSAGE'}},
    {type:'block.add',sourceId:'say2',opcode:'looks_say',place:{x:600,y:100}},
    {type:'block.add',sourceId:'globalvalue',opcode:'data_variable',fields:{VARIABLE:['全体の値','global']},place:{parent:'say2',input:'MESSAGE'}}
  ];
  for(const a of actions){console.log(a.type,a.name||a.opcode||a.target);await request(`/sessions/${s.id}/actions`,a);}
  console.log('Actions completed',actions.length);
  const state=await request(`/sessions/${s.id}`);
  console.log('Blocks',state.blocks.length);
  const recording=await request(`/sessions/${s.id}/recording/stop`,{});console.log('Recording',recording);
  const bytes=Buffer.from(await (await fetch(base+`/sessions/${s.id}/project.sb3`)).arrayBuffer());
  await fs.writeFile('test-results/api-session.sb3',bytes);
}catch(e){await fs.writeFile('test-results/session-failure.jpg',Buffer.from(await(await fetch(base+`/sessions/${s.id}/screenshot`)).arrayBuffer()));throw e;}
finally{await request(`/sessions/${s.id}`,{},'DELETE');}
