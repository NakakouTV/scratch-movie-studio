import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {apiRouter} from './api.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const port = Number(process.env.PORT || 8601);
app.use((req,res,next)=>{
  const origin=req.get('Origin');
  if(origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(origin))return res.status(403).json({error:'別のサイトからの操作は受け付けません。'});
  next();
});
app.use(express.json({limit:'80mb'}));
app.use('/api',await apiRouter(ROOT,`http://127.0.0.1:${port}`));
app.use('/outputs',express.static(path.join(ROOT,'outputs')));
app.use('/scratch', express.static(path.join(ROOT,'vendor/package/dist')));
app.use('/deps', express.static(path.join(ROOT,'node_modules')));
app.use(express.static(path.join(ROOT,'web')));
app.use(express.static(path.join(ROOT,'vendor/package/dist')));
app.get('/health', (req,res) => res.json({ok:true, editor:'15.1.1'}));
app.use((error,req,res,next)=>{console.error(error.message);res.status(400).json({error:error.message});});
app.listen(port,'127.0.0.1', () => console.log(`Scratch Movie Studio: http://127.0.0.1:${port}`));
