import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ListeningService} from '../server/listening-service.mjs';
import {createServer} from '../server/http.mjs';
import {addPlayedInterval,playedSeconds,describeChoice} from '../dist/listening-core.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'sonara-listening-')),trialDirectory=join(root,'audio');await mkdir(trialDirectory);
  const variants=[];for(const id of ['A','B']){const file=id+'.wav',bytes=Buffer.alloc(100,id.charCodeAt(0));await writeFile(join(trialDirectory,file),bytes);variants.push({id,file,hash:hash(bytes),description:id==='A'?'简约':'有层次',music:{style:'retro',bpm:116,voice:'qixuan',...(id==='A'?{texture:'sparse'}:{})}});}
  await writeFile(join(trialDirectory,'manifest.json'),JSON.stringify({id:'reunion-layers-v1',duration:19,variants,factor:'accompaniment-layers'}));
  const service=await new ListeningService({root,trialDirectory}).init();return {root,trialDirectory,service};
}
const input=(s,choice='A',extra={})=>({requestId:randomUUID(),trialId:s.trial.id,revision:s.revision,choice,note:'',played:{A:7,B:8},previousRecordId:s.latest()?.id??null,...extra});
test('listening starts from stated references without inventing a reason, and survives restart',async()=>{
  const {root,trialDirectory,service:s}=await fixture(),initial=await s.snapshot();assert.equal(initial.current,null);assert.equal(initial.reason,null);assert.equal(initial.references.length,3);
  const request=input(s,'A',{note:'这一段比较舒服'}),saved=await s.choose(request);assert.equal(saved.current.reasonConfirmed,false);assert.equal(saved.current.evidenceType,'browser-reported-playback');assert.equal(saved.current.variantHashes.A,s.trial.variants[0].hash);
  const restarted=await new ListeningService({root,trialDirectory}).init();assert.equal((await restarted.snapshot()).current.id,saved.current.id);assert.equal((await restarted.choose(request)).current.id,saved.current.id);assert.equal(restarted.state.records.length,1);
});
test('choices require both auditions and remain tied to the exact audio revision',async()=>{
  const {service:s}=await fixture();for(const extra of [{played:{A:0,B:8}},{played:{A:8,B:5.9}},{played:{A:20,B:8}},{played:{A:NaN,B:8}},{revision:'old'},{choice:'favorite'},{note:'x'.repeat(241)}])await assert.rejects(s.choose(input(s,'A',extra)));
  assert.equal(s.latest(),null);await s.choose(input(s,'same'));assert.equal(s.latest().choice,'same');assert.match(describeChoice(s.latest(),s.trial),/没有形成/);
});
test('changing or withdrawing a choice preserves history without turning abstentions into a direction',async()=>{
  const {service:s}=await fixture();await s.choose(input(s,'B'));await s.choose(input(s,'neither'));assert.match(describeChoice(s.latest(),s.trial),/没有选定/);await s.choose(input(s,'clear'));assert.equal(s.state.records.length,3);assert.match(describeChoice(s.latest(),s.trial),/还没有/);await assert.rejects(s.choose(input(s,'clear')));
  await s.choose(input(s,'A'));assert.match(describeChoice(s.latest(),s.trial),/原因仍未确认/);
});
test('retry deduplication and stale tabs cannot overwrite a newer choice',async()=>{
  const {service:s}=await fixture(),a=input(s),b=input(s,'B');const results=await Promise.allSettled([s.choose(a),s.choose(b)]);assert.equal(results[0].status,'fulfilled');assert.equal(results[1].reason.status,409);await s.choose(a);assert.equal(s.state.records.length,1);await assert.rejects(s.choose({...a,choice:'B'}),e=>e.status===409);
});
test('failed persistence is not reported as saved and the same request can retry',async()=>{
  const {service:s}=await fixture(),persist=s.persist.bind(s),request=input(s);s.persist=async()=>{throw Error('disk full');};await assert.rejects(s.choose(request),/disk full/);assert.equal(s.latest(),null);s.persist=persist;await s.choose(request);assert.equal(s.latest().choice,'A');
});
test('modified audio cannot inherit an older audition or preference',async()=>{
  const {service:s,trialDirectory}=await fixture();await writeFile(join(trialDirectory,'A.wav'),'changed');await assert.rejects(s.choose(input(s)),e=>e.status===409);await assert.rejects(s.snapshot(),e=>e.status===409);assert.equal(s.latest(),null);
});
test('a phrasing comparison starts a new judgment without inheriting arrangement preference',async()=>{
  const {service:s,root,trialDirectory}=await fixture();await s.choose(input(s,'A'));
  const manifest=JSON.parse(await readFile(join(trialDirectory,'manifest.json'),'utf8'));manifest.id='reunion-phrasing-v1';manifest.factor='lyric-phrasing';await writeFile(join(trialDirectory,'manifest.json'),JSON.stringify(manifest));
  const next=await new ListeningService({root,trialDirectory}).init();assert.equal((await next.snapshot()).current,null);assert.equal(next.state.records.length,1);await assert.rejects(next.choose(input(s,'B')),e=>e.status===409);await next.choose(input(next,'same'));assert.match(describeChoice(next.latest(),next.trial),/没有听出明显改善/);await next.choose(input(next,'B'));assert.match(describeChoice(next.latest(),next.trial),/不会转成音乐风格偏好/);assert.equal(next.state.records[0].trialId,'reunion-layers-v1');
});
test('replays and seek jumps do not count as distinct listened time',()=>{
  let ranges=[];for(let i=0;i<7;i++)ranges=addPlayedInterval(ranges,i,i+1,19);assert.equal(playedSeconds(ranges),7);for(let i=0;i<7;i++)ranges=addPlayedInterval(ranges,i,i+1,19);assert.equal(playedSeconds(ranges),7);
  ranges=addPlayedInterval(ranges,7,18,19);ranges=addPlayedInterval(ranges,18,20,19);assert.equal(playedSeconds(ranges),7);ranges=addPlayedInterval(ranges,10,11,19);assert.equal(playedSeconds(ranges),8);
});
test('listening HTTP API saves and reads choices, serves seekable audio and blocks external writes',async()=>{
  const {root,service:s}=await fixture(),server=createServer({root,service:{},listeningService:s});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
  try{const snap=await(await fetch(url+'/api/listening-trial')).json();assert.equal(snap.current,null);const audio=await fetch(url+snap.trial.variants[0].audio,{headers:{Range:'bytes=10-19'}});assert.equal(audio.status,206);assert.equal((await audio.arrayBuffer()).byteLength,10);
    const body=JSON.stringify(input(s));const blocked=await fetch(url+'/api/listening-trial/choice',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body});assert.equal(blocked.status,403);assert.equal(s.latest(),null);
    const saved=await fetch(url+'/api/listening-trial/choice',{method:'POST',headers:{'Content-Type':'application/json'},body});assert.equal(saved.status,200);assert.equal((await saved.json()).current.choice,'A');const disk=JSON.parse(await readFile(join(s.directory,'state.json'),'utf8'));assert.equal(disk.records.length,1);
  }finally{await new Promise(r=>server.close(r));await s.close();}
});
