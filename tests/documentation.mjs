// Execute the published agent-guide example against a disposable local server.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import express from 'express';
import {apiRouter,OPERATIONS} from '../server/api.mjs';
const root=path.resolve('test-results/documentation',randomUUID());await fs.mkdir(root,{recursive:true});
const app=express(),server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}),base='http://127.0.0.1:'+server.address().port;
try{
 app.use(express.json({limit:'80mb'}));app.use('/api',await apiRouter(root,base));app.use('/outputs',express.static(path.join(root,'outputs')));app.use('/scratch',express.static(path.resolve('vendor/package/dist')));app.use('/deps',express.static(path.resolve('node_modules')));app.use(express.static(path.resolve('web')));app.use(express.static(path.resolve('vendor/package/dist')));app.get('/health',(req,res)=>res.json({ok:true,editor:'15.1.1'}));app.use((e,req,res,next)=>res.status(400).json({error:e.message}));
 const guide=await fs.readFile('docs/agent-guide.md','utf8'),source=guide.match(/```js\r?\n([\s\S]*?)\r?\n```/)[1],script=path.join(root,'make-cut.mjs');await fs.writeFile(script,source);
 const {stdout}=await promisify(execFile)(process.execPath,[script,path.resolve('PEN動作確認.sb3')],{cwd:root,env:{...process.env,STUDIO_URL:base},timeout:120000});
 const movie=stdout.trim();assert.ok(movie.startsWith(root+path.sep));assert.ok((await fs.stat(movie)).size>1000);
 const jobs=await (await fetch(base+'/api/jobs')).json();assert.equal(jobs.length,1);assert.equal(jobs[0].status,'completed');
 const docs=['README.md',...(await fs.readdir('docs')).filter(n=>n.endsWith('.md')).map(n=>'docs/'+n)];
 for(const file of docs){const text=await fs.readFile(file,'utf8');for(const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)){const target=match[1];if(/^(https?:|#)/.test(target))continue;await fs.access(path.resolve(path.dirname(file),target.split('#')[0]));}}
 const reference=await fs.readFile('web/api.html','utf8');for(const type of OPERATIONS)assert.ok(reference.includes(type),'API reference missing '+type);
 console.log('PASS published Node example: upload, structure, capture, status polling, MP4 download; documentation links and operation coverage: '+root);
}finally{await new Promise(resolve=>server.close(resolve));}
