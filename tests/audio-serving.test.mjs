import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from '../server/http.mjs';

test('unified portal is served while the creation workspace remains directly accessible',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sonara-entry-'));
  await writeFile(join(root,'index.html'),'existing audio workspace');
  await writeFile(join(root,'compose.html'),'creation workspace');
  const server=createServer({root,service:{},compositionService:{}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}`;
  try{const res=await fetch(url,{redirect:'manual'});assert.equal(res.status,200);assert.equal(await res.text(),'existing audio workspace');assert.equal(await (await fetch(url+'/compose.html')).text(),'creation workspace');assert.equal(await (await fetch(url+'/index.html')).text(),'existing audio workspace');}
  finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});

test('audio serving supplies lengths and valid byte ranges for seeking and A/B playback',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sonara-range-'));
  const bytes=Buffer.from(Array.from({length:100},(_,i)=>i));
  await writeFile(join(root,'sample.wav'),bytes);
  const server=createServer({root,service:{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/sample.wav`;
  try{
    const full=await fetch(url);assert.equal(full.headers.get('content-length'),'100');assert.deepEqual(Buffer.from(await full.arrayBuffer()),bytes);
    const head=await fetch(url,{method:'HEAD'});assert.equal(head.headers.get('content-length'),'100');assert.equal((await head.arrayBuffer()).byteLength,0);
    for(const [range,start,end] of [['bytes=12-23',12,23],['bytes=91-',91,99],['bytes=-8',92,99],['bytes=95-110',95,99]]){
      const result=await fetch(url,{headers:{Range:range}});assert.equal(result.status,206);
      assert.equal(result.headers.get('content-range'),`bytes ${start}-${end}/100`);
      assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes.subarray(start,end+1));
    }
    for(const range of ['bytes=100-','bytes=20-10','bytes=-0','bytes=0-1,4-5','bytes=-']){
      const result=await fetch(url,{headers:{Range:range}});assert.equal(result.status,416);assert.equal(result.headers.get('content-range'),'bytes */100');
    }
  }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});

test('portal remains the entry with every workspace independently accessible',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sonara-song-entry-'));await writeFile(join(root,'index.html'),'unified portal');await writeFile(join(root,'youth-song.html'),'complete song');await writeFile(join(root,'compose.html'),'personal projects');await writeFile(join(root,'audio-tools.html'),'audio tools');
  const server=createServer({root,service:{},songProjectService:{},compositionService:{}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
  try{for(const path of ['/','/index.html']){const response=await fetch(url+path,{redirect:'manual'});assert.equal(response.status,200);assert.equal(await response.text(),'unified portal');}assert.equal(await(await fetch(url+'/youth-song.html')).text(),'complete song');assert.equal(await(await fetch(url+'/audio-tools.html')).text(),'audio tools');}
  finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
