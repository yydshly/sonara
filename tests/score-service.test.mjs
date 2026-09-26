import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ScoreService,normalizeLyrics} from '../server/score-service.mjs';
import {createServer} from '../server/http.mjs';
import {scoreMidi} from '../server/score-midi.mjs';

const input=(baseVersion='B',lineIndex=1,lyrics='把思念写成一封信')=>({requestId:randomUUID(),baseVersion,lineIndex,lyrics,pinyin:['ba','si','nian','xie','cheng','yi','feng','xin']});
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const root=resolve('.');
async function output({path}){await writeFile(join(path,'song.wav'),Buffer.alloc(2000));await writeFile(join(path,'vocal.wav'),Buffer.alloc(1500));await writeFile(join(path,'result.json'),JSON.stringify({duration:26,sampleRate:44100,peak:.7,unchangedOutsideRegion:true,identicalPitchControl:true,changedRegion:{start:6,end:12}}));}
async function service(options={}){return new ScoreService({root,directory:await mkdtemp(join(tmpdir(),'sonara-score-')),runner:output,previewer:async value=>({...value,characters:[...value.lyrics]}),...options}).init();}

test('score edit rejects wrong-length and non-Chinese lyrics before rendering',async()=>{
  assert.equal(normalizeLyrics('把思念，写成一封信。'),'把思念写成一封信');
  for(const value of ['晚风','hello123','把思念写成一封信你',null])assert.throws(()=>normalizeLyrics(value));
  const s=await service();for(const change of [{lineIndex:4},{baseVersion:'../../escape'},{pinyin:['bad']}])await assert.rejects(s.create({...input(),...change}));assert.equal(s.jobs.size,0);await s.close();
});
test('one durable request deduplicates and creates an immutable lyric snapshot',async()=>{
  let runs=0;const s=await service({runner:async args=>{runs++;await output(args);}}),request=input();
  const [first,second]=await Promise.all([s.create(request),s.create(request)]);assert.equal(first.id,second.id);await s.tail;
  assert.equal(runs,1);assert.equal(s.get(first.id).state,'succeeded');assert.equal(s.version('B').lyrics[1],'把想念藏进晚风里');assert.equal(s.version(first.id).lyrics[1],request.lyrics);
  assert.equal((await s.create(request)).id,first.id);assert.equal(runs,1);
  await assert.rejects(s.create({...request,lyrics:'让晨光带我找到你'}),e=>e.status===409);
  const restarted=await new ScoreService({root,directory:s.directory,runner:output}).init();assert.equal(restarted.version(first.id).lyrics[1],request.lyrics);await s.close();await restarted.close();
});
test('later edits inherit the previous version instead of resetting earlier changes',async()=>{
  const s=await service(),first=await s.create(input());await s.tail;
  const second=await s.create(input(first.id,3,'让晨光带我找到你'));await s.tail;
  assert.equal(s.version(second.id).lyrics[1],'把思念写成一封信');assert.equal(s.version(second.id).lyrics[3],'让晨光带我找到你');assert.equal(s.version(first.id).lyrics[3],'在天亮以后遇见你');
  const request=JSON.parse(await readFile(join(s.directory,second.id,'request.json'),'utf8'));assert.equal(request.baseSong,join(s.directory,first.id,'song.wav'));await s.close();
});
test('cancellation stops publication even if a worker returns a result afterward',async()=>{
  const entered=gate(),finish=gate();const s=await service({runner:async args=>{entered.resolve();await finish.promise;await output(args);}});
  const job=await s.create(input());await entered.promise;await s.cancel(job.id);finish.resolve();await s.tail;
  assert.equal(s.get(job.id).state,'cancelled');assert.throws(()=>s.version(job.id));assert.equal(s.snapshot().versions.length,2);await s.close();
});
test('failed or unverified audio never becomes a saved playable version',async()=>{
  const s=await service({runner:async args=>{await output(args);await writeFile(join(args.path,'result.json'),JSON.stringify({duration:26,sampleRate:44100,peak:1,unchangedOutsideRegion:false,identicalPitchControl:true}));}});
  const job=await s.create(input());await s.tail;assert.equal(s.get(job.id).state,'failed');await assert.rejects(s.audio(job.id,'song'));assert.equal(s.snapshot().versions.length,2);await s.close();
});
test('a busy renderer rejects a second job and restart marks unfinished jobs interrupted',async()=>{
  const entered=gate(),finish=gate();const s=await service({runner:async args=>{entered.resolve();await finish.promise;await output(args);}});
  const job=await s.create(input());await entered.promise;await assert.rejects(s.create(input('A')),e=>e.status===409);
  const restarted=await new ScoreService({root,directory:s.directory,runner:output}).init();assert.equal(restarted.get(job.id).state,'interrupted');assert.equal(restarted.snapshot().versions.length,2);await s.cancel(job.id);finish.resolve();await s.tail;await s.close();await restarted.close();
});
test('failed initial save cannot start inference and a retry can succeed',async()=>{
  let runs=0;const s=await service({runner:async args=>{runs++;await output(args);}}),persist=s.persist.bind(s);let fail=true;
  s.persist=async job=>{if(fail){fail=false;throw Error('disk full');}await persist(job);};const request=input();await assert.rejects(s.create(request));assert.equal(runs,0);assert.equal(s.jobs.size,0);
  const retry=await s.create(request);await s.tail;assert.equal(s.get(retry.id).state,'succeeded');assert.equal(runs,1);await s.close();
});
test('failed final save is not reported as a saved successful version',async()=>{
  const s=await service(),persist=s.persist.bind(s);s.persist=async job=>{if(job.state==='succeeded')throw Error('disk full');await persist(job);};
  const job=await s.create(input());await s.tail;assert.equal(s.get(job.id).state,'failed');assert.equal(s.snapshot().versions.length,2);await s.close();
});
test('score HTTP protects requests, exports the chosen lyrics and supports audio seeking',async()=>{
  const s=await service(),server=createServer({root:join(root,'dist'),service:{},scoreService:s});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
  try{
    const denied=await fetch(`${url}/api/score/jobs`,{method:'POST',headers:{Origin:'https://unrelated.example','Content-Type':'application/json'},body:JSON.stringify(input())});assert.equal(denied.status,403);assert.equal(s.jobs.size,0);
    const job=await s.create(input());await s.tail;
    assert.match(await (await fetch(`${url}/api/score/versions/${job.id}/lyrics`)).text(),/把思念写成一封信/);
    const audio=await fetch(`${url}/api/score/versions/${job.id}/song`,{headers:{Range:'bytes=0-43'}});assert.equal(audio.status,206);assert.equal((await audio.arrayBuffer()).byteLength,44);
    const midi=Buffer.from(await (await fetch(`${url}/api/score/versions/${job.id}/midi`)).arrayBuffer());assert.equal(midi.subarray(0,4).toString(),'MThd');assert.ok(midi.includes(Buffer.from('封')));
    assert.equal((await fetch(`${url}/api/score/versions/../../request.json`)).status,404);
  }finally{await new Promise(r=>server.close(r));await s.close();}
});
test('lyric-only MIDI export keeps every note and timing event unchanged',async()=>{
  const score=JSON.parse(await readFile(join(root,'dist/score-trial/score.json'),'utf8'));
  function notes(buffer){let offset=22,tick=0,out=[];const variable=()=>{let n=0,part;do{part=buffer[offset++];n=(n<<7)|(part&127);}while(part&128);return n;};while(offset<buffer.length){tick+=variable();const type=buffer[offset++];if(type===255){offset++;const length=variable();offset+=length;}else{out.push([tick,type,buffer[offset++],buffer[offset++]]);}}return out;}
  assert.deepEqual(notes(scoreMidi(score,score.lyrics)),notes(scoreMidi(score,['让晚风替我拥抱你','把思念写成一封信',...score.lyrics.slice(2)])));
});
