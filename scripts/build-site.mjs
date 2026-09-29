import {readdir,readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,join,dirname,extname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const target=process.env.SONARA_SITE_TARGET||'portal';
const entries={portal:'index.html',studio:'studio.html',song:'youth-song.html',lab:'sound-lab.html',score:'score-trial.html',tools:'audio-tools.html'};
if(!Object.hasOwn(entries,target))throw Error('Unknown deployment target');
const base=(process.env.SONARA_BASE_PATH||'').replace(/\/$/,'');
if(base&&!/^\/[a-zA-Z0-9_/-]+$/.test(base))throw Error('Invalid base path');
const output=resolve(root,process.env.SONARA_SITE_OUT||'build/site');
if(!output.startsWith(root+ '\\build\\')&&!output.startsWith(root+'/build/'))throw Error('Build output must be under this project build/ directory');
await mkdir(output,{recursive:true});
const replaceRoots=value=>value.replace(/(["'`])\/(?!\/)/g,(_,quote)=>quote+base+'/');
async function walk(directory){const files=[];for(const d of await readdir(directory,{withFileTypes:true})){const path=join(directory,d.name);if(d.isDirectory())files.push(...await walk(path));else files.push(path);}return files;}
for(const file of await walk(join(root,'dist'))){
  if(['.wav','.mp3','.ds','.pyc'].includes(extname(file)))continue;
  const destination=join(output,relative(join(root,'dist'),file));await mkdir(dirname(destination),{recursive:true});
  if(['.html','.mjs','.js','.css','.json'].includes(extname(file))){
    let text=await readFile(file,'utf8');
    if(['.mjs','.js'].includes(extname(file))){
      // Route media/exports to the reviewed preview assets; no fetch interception
      // can redirect native HTMLMediaElement requests on a static host.
      text=text.replace(/(\b[\w$]+(?:\.[\w$]+)*\.(?:src|href)\s*=)([^;]+);/g,(_,left,value)=>`${left}globalThis.SONARA_ASSET(${value});`);
    }
    text=replaceRoots(text);
    if(extname(file)==='.html')text=text.replace('</head>',`<script src="${base}/remote-config.js"></script><script src="${base}/remote-runtime.js"></script></head>`);
    await writeFile(destination,text);
    if(['.mjs','.js'].includes(extname(file))){const check=spawnSync(process.execPath,['--check',destination],{encoding:'utf8'});if(check.status!==0)throw Error(check.stderr);}
  }else await copyFile(file,destination);
}
for(const file of await walk(join(root,'published'))){const destination=join(output,'published',relative(join(root,'published'),file));await mkdir(dirname(destination),{recursive:true});await copyFile(file,destination);}
const config=JSON.parse(await readFile(join(root,'published/runtime-data.json'),'utf8'));config.basePath=base;
await writeFile(join(output,'remote-config.js'),'globalThis.SONARA_DEPLOYMENT='+JSON.stringify(config).replaceAll('<','\\u003c')+';');
await copyFile(join(root,'deploy/remote-runtime.js'),join(output,'remote-runtime.js'));
await copyFile(join(output,'index.html'),join(output,'portal.html'));
if(target!=='portal')await writeFile(join(output,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${base}/${entries[target]}"><title>声间</title></head><body><a href="${base}/${entries[target]}">进入声间</a></body></html>`);
for(const [id,entry] of Object.entries(entries))if(id!=='portal'){await mkdir(join(output,id),{recursive:true});await writeFile(join(output,id,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${base}/${entry}"><title>声间 · ${id}</title></head><body><a href="${base}/${entry}">打开此创作空间</a></body></html>`);}
await writeFile(join(output,'.nojekyll'),'');
await writeFile(join(output,'deployment.json'),JSON.stringify({target,base,mode:'preview',entries},null,2));
console.log(`Built ${target} with ${Object.keys(entries).length} entry points in ${relative(root,output)} (${base||'/'}).`);
