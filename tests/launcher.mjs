import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// Use an npm stub so testing the launcher never starts a second server.
const bytes=await fs.readFile('起動.cmd');
await fs.mkdir('.runtime',{recursive:true});
const directory=await fs.mkdtemp(path.resolve('.runtime/launcher-'));
const project=path.join(directory,'日本語 project'),bin=path.join(directory,'bin');
await fs.mkdir(project);await fs.mkdir(bin);
await fs.writeFile(path.join(project,'起動.cmd'),bytes);
await fs.writeFile(path.join(bin,'npm.cmd'),[
  '@echo off',
  'if not "%~1"=="start" exit /b 91',
  'if not exist "launcher-marker.txt" exit /b 92',
  'echo LAUNCHER_NPM_OK',
  'exit /b 23',''
].join('\r\n'));
await fs.writeFile(path.join(project,'launcher-marker.txt'),'test');
const env={...process.env};
const pathKey=Object.keys(env).find(k=>k.toLowerCase()==='path')||'PATH';
env[pathKey]=bin+path.delimiter+(env[pathKey]||'');
const result=spawnSync(process.env.ComSpec||'cmd.exe',['/d','/c',`call "${path.join(project,'起動.cmd')}"`],{
  cwd:directory,env,input:'\r\n',encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true,timeout:15000
});
if(result.error)throw result.error;
if(process.argv.includes('--diagnose')){
  console.log(JSON.stringify({status:result.status,stdout:result.stdout,stderr:result.stderr}));
}else{
  assert.ok([...bytes].every(n=>n<128),'Launcher must contain only ASCII');
  assert.ok(bytes.toString().includes('\r\n'),'Launcher must use CRLF');
  assert.ok(!/(?<!\r)\n/.test(bytes.toString()),'Bare LF is not allowed');
  assert.equal(result.status,23,result.stderr||result.stdout);
  assert.match(result.stdout,/LAUNCHER_NPM_OK/);
  assert.equal(result.stderr,'');
  console.log('PASS Windows launcher: Japanese/spaced path, different working directory, npm start, exit code, ASCII and CRLF');
}
