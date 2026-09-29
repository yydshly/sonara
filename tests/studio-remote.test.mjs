import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {StudioService} from '../server/studio-service.mjs';
import {createServer} from '../server/http.mjs';
import {emptyDraft} from '../dist/studio-core.mjs';
import {RemoteWorker,validateConnection} from '../scripts/remote-worker.mjs';

const lyrics={title:'测试歌词',lyrics:'[Verse]\n那天等你走过这条街\n[Chorus]\n把晚风留给明天',direction:'仅为自动化测试结果，不是真实生成。'};
const draft=()=>({...emptyDraft(),idea:'下班路上看见一盏熟悉的灯',lyrics:lyrics.lyrics});
function wav(){const b=Buffer.alloc(32044);b.write('RIFF');b.writeUInt32LE(32036,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(32000,40);return b;}
async function setup(t,{now=Date.now,minimax,fetcher}={}){
  const directory=await mkdtemp(join(tmpdir(),'sonara-lan-')),studio=await new StudioService({directory:join(directory,'studio'),codex:{status:async()=>({ready:false})},minimax:{status:async()=>({available:false})},remoteOptions:{addresses:()=>[{name:'Test loopback',address:'127.0.0.1'}],port:0,now}}).init();
  t.after(()=>studio.close());await studio.remote.enable({address:'127.0.0.1'});
  const config={format:'sonara-worker-connection-v1',url:studio.remote.url,token:studio.remote.token};
  const worker=await new RemoteWorker({config,directory:join(directory,'worker'),minimax:minimax||{status:async()=>({available:true}),generate:async()=>lyrics,music:async()=>({data:wav()})},fetcher,log:()=>{}}).init();
  const p=await studio.create({draft:draft()});return {studio,worker,p,config,directory};
}
async function music(studio,p){return (await studio.prepare(p.id,{type:'music',requestId:randomUUID(),revision:p.revision})).tasks.at(-1);}

test('remote music requires explicit selection and returns verified audio to its frozen version',async t=>{
  const {studio,worker,p}=await setup(t),task=await music(studio,p);assert.equal(await worker.tick(),false);
  await assert.rejects(studio.run(p.id,task.id),e=>e.status===503);
  await studio.run(p.id,task.id,{execution:'remote'});await worker.tick();
  const result=studio.get(p.id);assert.equal(result.tasks[0].state,'succeeded');assert.equal(result.tasks[0].source,'minimax-code-remote');assert.equal(result.tasks[0].snapshot.lyrics,p.draft.lyrics);assert.deepEqual((await studio.audio(p.id,task.id)).data,wav());
  assert.equal(await worker.tick(),false);assert.equal(studio.status().remote.available,true);
});
test('remote lyrics are validated proposals and do not change the working draft',async t=>{
  const {studio,worker,p}=await setup(t);const input={type:'lyrics',provider:'minimax-code',execution:'remote',revision:1,requestId:randomUUID()};
  await studio.prepare(p.id,input);await assert.rejects(studio.prepare(p.id,{...input,execution:'local'}),e=>e.status===409);await worker.tick();
  assert.deepEqual(studio.get(p.id).tasks[0].output,lyrics);assert.deepEqual(studio.get(p.id).draft,p.draft);
});
test('LAN port rejects missing credentials, browsers, wrong leases and access to the project library',async t=>{
  const {studio,worker,p,config}=await setup(t),task=await music(studio,p);
  assert.equal((await fetch(config.url+'/worker/claim',{method:'POST'})).status,401);
  const headers={'Authorization':'Bearer '+config.token,'X-Sonara-Worker':worker.id,'Content-Type':'application/json'};
  assert.equal((await fetch(config.url+'/worker/claim',{method:'POST',headers:{...headers,Origin:'http://evil.example'},body:'{}'})).status,403);
  assert.equal((await fetch(config.url+'/api/studio/projects',{method:'POST',headers,body:'{}'})).status,404);
  assert.equal((await fetch(config.url+'/worker/hello',{method:'POST',headers:{...headers,'X-Sonara-Worker':randomUUID()},body:'{}'})).status,409);
  await studio.run(p.id,task.id,{execution:'remote'});const {job}=await worker.request('/worker/claim');assert.equal(Object.hasOwn(job,'project'),false);
  await assert.rejects(worker.request(worker.endpoint(job,'audio'),wav(),randomUUID(),true),e=>e.status===403);
  assert.equal(JSON.stringify(studio.status()).includes(config.token),false);
});
test('a cancelled remote task cannot be overwritten by a late file; no automatic reassignment',async t=>{
  const {studio,worker,p}=await setup(t),task=await music(studio,p);await studio.run(p.id,task.id,{execution:'remote'});
  const {job}=await worker.request('/worker/claim');assert.equal((await worker.request('/worker/claim')).job,null);
  await studio.cancel(p.id,task.id);await assert.rejects(worker.request(worker.endpoint(job,'audio'),wav(),job.lease,true),e=>e.status===409);
  assert.equal((await worker.request(worker.endpoint(job,'heartbeat'),{},job.lease)).state,'cancelled');assert.equal(studio.get(p.id).tasks[0].state,'cancelled');
});
test('lost delivery acknowledgement retries the saved result without another model call',async t=>{
  let generations=0,lost=false;const fetcher=async(url,options)=>{const r=await fetch(url,options);if(url.endsWith('/audio')&&!lost){lost=true;throw Error('lost acknowledgement');}return r;};
  const {studio,worker,p}=await setup(t,{fetcher,minimax:{status:async()=>({available:true}),music:async()=>{generations++;return {data:wav()};}}});
  const task=await music(studio,p);await studio.run(p.id,task.id,{execution:'remote'});await assert.rejects(worker.tick());assert.equal(studio.get(p.id).tasks[0].state,'succeeded');
  await worker.tick();assert.equal(generations,1);assert.equal(JSON.parse(await readFile(join(worker.directory,'tasks',task.id,'journal.json'),'utf8')).state,'delivered');
});
test('lease timeout marks uncertain work for review instead of generating it again',async t=>{
  let now=Date.now();const {studio,worker,p}=await setup(t,{now:()=>now}),task=await music(studio,p);await studio.run(p.id,task.id,{execution:'remote'});await worker.request('/worker/claim');now+=91000;await studio.remote.expire();
  assert.equal(studio.get(p.id).tasks[0].state,'interrupted');assert.equal((await worker.request('/worker/claim')).job,null);
});
test('a worker restart never re-executes a journaled running task',async t=>{
  let count=0;const {studio,worker,p}=await setup(t,{minimax:{status:async()=>({available:true}),generate:async()=>{count++;throw Error('should not execute');}}});
  await studio.prepare(p.id,{type:'lyrics',provider:'minimax-code',execution:'remote',revision:1,requestId:randomUUID()});const {job}=await worker.request('/worker/claim');
  // A crash after persisting the reservation but before completion leaves a running journal.
  const {mkdir}=await import('node:fs/promises');const folder=join(worker.directory,'tasks',job.task.id);await mkdir(folder,{recursive:true});await writeFile(join(folder,'journal.json'),JSON.stringify({connectionId:worker.connectionId,job,state:'running'}));
  await worker.recover();assert.equal(count,0);assert.equal(studio.get(p.id).tasks[0].state,'interrupted');
});
test('invalid audio and malformed lyric outputs cannot become successful remote versions',async t=>{
  const {studio,worker,p}=await setup(t),task=await music(studio,p);await studio.run(p.id,task.id,{execution:'remote'});const {job}=await worker.request('/worker/claim');
  await assert.rejects(worker.request(worker.endpoint(job,'audio'),Buffer.from('not an audio file'),job.lease,true),e=>e.status===422);
  await assert.rejects(worker.request(worker.endpoint(job,'lyrics'),lyrics,job.lease),e=>e.status===409);assert.equal(studio.get(p.id).tasks[0].state,'running');
  await studio.cancel(p.id,task.id);await studio.prepare(p.id,{type:'lyrics',provider:'minimax-code',execution:'remote',revision:1,requestId:randomUUID()});const next=(await worker.request('/worker/claim')).job;
  await assert.rejects(worker.request(worker.endpoint(next,'lyrics'),{title:'bad'},next.lease),e=>e.status===400);assert.equal(studio.get(p.id).tasks.at(-1).state,'running');
});
test('disabling pairing revokes credentials and the ZIP is only available through the local admin API',async t=>{
  const {studio,worker,p,config}=await setup(t),task=await music(studio,p);await studio.run(p.id,task.id,{execution:'remote'});
  const local=createServer({root:resolve('dist'),service:{},studioService:studio});await new Promise(r=>local.listen(0,'127.0.0.1',r));t.after(()=>{local.closeAllConnections();local.close();});const base=`http://127.0.0.1:${local.address().port}`;
  assert.equal((await fetch(base+'/api/studio/remote/package',{headers:{Origin:'https://evil.example'}})).status,403);
  const response=await fetch(base+'/api/studio/remote/package'),zip=Buffer.from(await response.arrayBuffer());assert.equal(response.headers.get('content-type'),'application/zip');assert.equal(zip.readUInt32LE(0),0x04034b50);assert.ok(zip.includes(Buffer.from(config.token)));assert.ok(zip.includes(Buffer.from('start-worker.cmd')));assert.ok(!zip.includes(Buffer.from('codex-composer.mjs')));
  await studio.remote.disable();assert.equal(studio.get(p.id).tasks[0].state,'interrupted');assert.equal(studio.status().remote.enabled,false);await studio.remote.enable({address:'127.0.0.1'});assert.notEqual(studio.remote.token,config.token);
  const invalid=await fetch(studio.remote.url+'/worker/hello',{method:'POST',headers:{Authorization:'Bearer '+config.token,'X-Sonara-Worker':worker.id,'Content-Type':'application/json'},body:'{}'});assert.equal(invalid.status,401);
});
test('worker configuration rejects public URLs, credential URLs and redirects',()=>{
  const base={format:'sonara-worker-connection-v1',token:'a'.repeat(64)};
  for(const url of ['http://example.com:4176','http://8.8.8.8:4176','http://192.168.1.1.evil.test:4176','http://user:pass@192.168.1.2:4176','http://192.168.1.2:4176/other','https://192.168.1.2:4176'])assert.throws(()=>validateConnection({...base,url}));
  assert.equal(validateConnection({...base,url:'http://192.168.1.2:4176'}).url,'http://192.168.1.2:4176');
});
