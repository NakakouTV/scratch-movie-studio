import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runProcess} from '../server/recorder.mjs';
const version='15.1.1',file=`scratch-scratch-gui-${version}.tgz`;
await fs.mkdir('vendor',{recursive:true});
try{await fs.access('vendor/package/dist/scratch-gui.js');console.log('Official Scratch editor already installed.');}
catch{
  console.log(`Downloading official @scratch/scratch-gui ${version}…`);
  const meta=await (await fetch(`https://registry.npmjs.org/@scratch%2fscratch-gui/${version}`)).json();
  const r=await fetch(meta.dist.tarball);if(!r.ok)throw new Error(`Download failed: ${r.status}`);
  const bytes=Buffer.from(await r.arrayBuffer());
  const actual='sha512-'+createHash('sha512').update(bytes).digest('base64');if(actual!==meta.dist.integrity)throw new Error('Package integrity verification failed');
  await fs.writeFile(file,bytes);await runProcess('tar',['-xf',file,'-C','vendor']);
}
console.log((await runProcess(process.env.FFMPEG_PATH||'ffmpeg',['-version'])).split('\n')[0]);
console.log('Ready. Run npm start and open http://127.0.0.1:8601');
