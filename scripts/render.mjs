import fs from 'node:fs/promises';
import path from 'node:path';
const file=process.argv[2];if(!file)throw new Error('使い方: npm run render -- project.sb3 [speed]');
const base=process.env.STUDIO_URL||'http://127.0.0.1:8601';
async function request(url,options){const r=await fetch(base+'/api'+url,options);const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}
const p=await request('/projects',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(path.basename(file))},body:await fs.readFile(file)});
const j=await request('/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:p.id,speed:Number(process.argv[3]||1)})});
let status,last;
do{status=await request('/jobs/'+j.id);if(status.current!==last){console.log(`${status.step}/${status.total} ${status.current}`);last=status.current;}if(['running','encoding'].includes(status.status))await new Promise(r=>setTimeout(r,1500));}while(['running','encoding'].includes(status.status));
console.log(JSON.stringify(status,null,2));if(status.status!=='completed')process.exitCode=1;
