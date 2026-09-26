import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {applyPhrasing,phrasingPrompt} from '../server/emotion-phrasing.mjs';
import {initialBrief,hash} from '../server/song-project.mjs';
import {PhrasingService} from '../server/phrasing-service.mjs';
import {createServer} from '../server/http.mjs';
const base=JSON.parse(await readFile(resolve('dist/youth-song/score.json'),'utf8'));
// Keep the fixture short while retaining actual authored note and section data.
const score={...base,duration:base.phrases[0].end,phrases:base.phrases.slice(0,1),lyrics:base.lyrics.slice(0,1)};
const raw=()=>({summary:'自动测试建议，不代表试听结论。',phrases:score.phrases.map(p=>({index:p.index,lead:.75,beats:p.notes.map((n,i)=>i===0?n.beats-.25:n.beats),focusWord:'试卷',reason:'改变起句留白，时值总长不变。',listenFor:'起句是否自然？'}))});
function wav(duration){const b=Buffer.alloc(44+Math.round(duration*44100)*6);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(44100,24);b.writeUInt32LE(264600,28);b.writeUInt16LE(6,32);b.writeUInt16LE(24,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
async function worker({path,mode}){const req=JSON.parse(await readFile(join(path,'request.json'),'utf8'));if(mode==='prepare'){for(const name of ['preview-A.wav','preview-B.wav'])await writeFile(join(path,name),wav(score.duration));await writeFile(join(path,'preview.json'),JSON.stringify({scoreHash:req.scoreHash,offset:0,duration:score.duration}));}else{const data=wav(score.duration);for(const name of ['song.wav','vocal.wav'])await writeFile(join(path,name),data);await writeFile(join(path,'result.json'),JSON.stringify({scoreHash:req.scoreHash,duration:score.duration,sampleRate:44100,bitDepth:24,peak:.5,unchangedOutsideRegions:true,lyricsAndNotePitchesPreserved:true,regions:req.changes.map(c=>({index:c.index,start:c.start,end:c.end})),files:{'song.wav':hash(data),'vocal.wav':hash(data)}}));}}
async function setup(options={}){const root=await mkdtemp(join(tmpdir(),'sonara-phrasing-'));const project={score,source:root,sourceScore:score,scoreSourceHash:'original',available:true,draft:{revision:2,brief:initialBrief(score)},fingerprints:async()=>({'score.json':'original','song.wav':'audio'})};return new PhrasingService({root,project,connection:{ready:true},composer:{phrase:async()=>raw()},worker,...options}).init();}
const request=()=>({requestId:randomUUID(),revision:2,sectionId:'all',focus:'natural'});

test('goal-driven timing changes preserve all lyrics, note pitches, harmony and untouched sections',()=>{
  const input={summary:'表达方案',phrases:base.phrases.filter(p=>p.section==='verse1').map(p=>({index:p.index,lead:.75,beats:p.notes.map((n,i)=>i===0?n.beats-.25:n.beats),focusWord:p.lyrics[0],reason:'让起句稍晚，改变叙述节奏。',listenFor:'是否更自然？'}))};
  const result=applyPhrasing(input,base,'verse1');assert.equal(result.changes.length,4);assert.equal(result.checks.quality,'unreviewed');assert.deepEqual(result.score.harmony,base.harmony);assert.deepEqual(result.score.sections,base.sections);
  for(const [i,p] of base.phrases.entries()){assert.equal(result.score.phrases[i].lyrics,p.lyrics);assert.deepEqual(result.score.phrases[i].notes.map(n=>[n.midi,n.pinyin]),p.notes.map(n=>[n.midi,n.pinyin]));if(p.section!=='verse1')assert.deepEqual(result.score.phrases[i],p);}
  assert.equal(base.phrases[0].notes[0].beats,.5);assert.ok(result.changes[0].after.tail>=.25);
});
test('invalid or fabricated changes cannot cross duration, identity or scope limits',()=>{
  for(const edit of [r=>r.phrases[0].index=1,r=>r.phrases[0].lead=0,r=>r.phrases[0].beats[0]=.2,r=>r.phrases[0].beats[0]=NaN,r=>r.phrases[0].beats[0]=3,r=>r.phrases[0].beats.pop(),r=>r.phrases[0].midi=[60],r=>r.phrases[0].focusWord='别的歌词',r=>r.phrases.push(r.phrases[0])]){const value=raw();edit(value);assert.throws(()=>applyPhrasing(value,score,'all'),e=>e.status===422);}
  const unchanged=raw();unchanged.phrases[0].lead=.5;unchanged.phrases[0].beats=score.phrases[0].notes.map(n=>n.beats);assert.throws(()=>applyPhrasing(unchanged,score,'all'));
  const prompt=phrasingPrompt({brief:initialBrief(base),score:base,sectionId:'verse1',focus:'natural'});assert.ok(prompt.includes('亲近、带一点害羞'));assert.ok(prompt.includes('SOURCE PHRASES (JSON)'));assert.ok(prompt.includes('never claim you heard'));assert.ok(!prompt.includes('"index":25'));
});

test('emotional arc reaches the model as a target, never as loudness or achieved quality',()=>{
  const brief=initialBrief(base),bridge=brief.sections.find(s=>s.id==='bridge');bridge.expression={energy:1,tension:5,listenFor:'轻声的留言是否反而更牵动人？'};
  const prompt=phrasingPrompt({brief,score:base,sectionId:'bridge',focus:'release'});assert.ok(prompt.includes('"energy":1,"tension":5'));assert.ok(prompt.includes(bridge.expression.listenFor));assert.ok(prompt.includes('NOT the acoustic voice-model tension parameter'));assert.ok(prompt.includes('question for human listening, not an achieved outcome'));
});
test('saved creative brief becomes an immutable model input; stale drafts and changed request IDs are rejected',async()=>{
  const s=await setup(),input=request();await assert.rejects(s.create({...input,revision:1}),e=>e.status===409);const j=await s.create(input);await s.completion;assert.equal(s.get(j.id).state,'draft');assert.equal((await s.create(input)).id,j.id);await assert.rejects(s.create({...input,focus:'hook'}),e=>e.status===409);s.project.draft.brief.goal.feeling='改变后的目标';assert.notEqual(s.get(j.id).brief.goal.feeling,'改变后的目标');await s.close();
});
test('singing waits for the exact score; exported result and review keep emotional fit separate from musicality',async()=>{
  const s=await setup(),j=await s.create(request());await s.completion;await assert.rejects(s.render(j.id,{scoreHash:'old'}),e=>e.status===409);await assert.rejects(s.asset(j.id,'song'));await s.render(j.id,{scoreHash:s.get(j.id).scoreHash});await s.completion;assert.equal(s.get(j.id).state,'succeeded');assert.equal(s.get(j.id).review,undefined);assert.equal((await s.asset(j.id,'song')).type,'audio/wav');
  await assert.rejects(s.review(j.id,{emotion:'closer',musicality:'better',at:500,note:'测试'}));await s.review(j.id,{emotion:'closer',musicality:'worse',at:12,note:'自动测试，不是真实评价'});assert.equal(s.get(j.id).review.emotion,'closer');assert.equal(s.get(j.id).review.musicality,'worse');const record=JSON.parse((await s.asset(j.id,'record')).data);assert.equal(record.job.scoreHash,s.get(j.id).scoreHash);await s.close();
});
test('cancellation prevents a late model response from publishing and sources are rechecked before singing',async()=>{
  let release,started;const gate=new Promise(r=>release=r),start=new Promise(r=>started=r);const s=await setup({composer:{phrase:async()=>{started();await gate;return raw();}}}),j=await s.create(request());await start;await s.cancel(j.id);release();await s.completion;assert.equal(s.get(j.id).state,'cancelled');assert.equal(s.get(j.id).prepared,undefined);await s.close();
  const t=await setup(),draft=await t.create(request());await t.completion;t.project.fingerprints=async()=>({'score.json':'changed'});await assert.rejects(t.render(draft.id,{scoreHash:t.get(draft.id).scoreHash}),e=>e.status===409);await t.close();
});
test('failed persistence never starts generation or exposes completed audio',async()=>{
  let calls=0;const s=await setup({composer:{phrase:async()=>{calls++;return raw();}}}),persist=s.persist.bind(s);s.persist=async()=>{throw Error('Disk unavailable');};await assert.rejects(s.create(request()));assert.equal(calls,0);s.persist=persist;const j=await s.create(request());await s.completion;s.persist=async value=>{if(value.state==='succeeded'||value.state==='failed')throw Error('Disk unavailable');return persist(value);};await s.render(j.id,{scoreHash:s.get(j.id).scoreHash});await s.completion;assert.equal(s.get(j.id).state,'failed');await assert.rejects(s.asset(j.id,'song'));await s.close();
});
test('HTTP exposes approved public assets with seeking and rejects cross-origin creative requests',async()=>{
  const s=await setup(),server=createServer({root:s.root,service:{},phrasingService:s});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/song-phrasing`;
  try{assert.equal((await fetch(url)).status,200);assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:JSON.stringify(request())})).status,403);const j=await s.create(request());await s.completion;const res=await fetch(`${url}/${j.id}/assets/after`,{headers:{Range:'bytes=0-11'}});assert.equal(res.status,206);assert.equal((await res.arrayBuffer()).byteLength,12);assert.equal((await fetch(`${url}/${j.id}/assets/request`)).status,404);}finally{await new Promise(r=>server.close(r));await s.close();}
});

test('late singing after cancellation is never published; restart keeps the prepared score without resubmitting',async()=>{
  let release,started;const gate=new Promise(r=>release=r),start=new Promise(r=>started=r);const s=await setup({worker:async input=>{if(input.mode==='sing'){started();await gate;}await worker(input);}}),j=await s.create(request());await s.completion;await s.render(j.id,{scoreHash:s.get(j.id).scoreHash});await start;await s.cancel(j.id);release();await s.completion;assert.equal(s.get(j.id).state,'cancelled');await assert.rejects(s.asset(j.id,'song'));assert.equal(s.get(j.id).prepared,true);
  const copied=structuredClone(s.get(j.id));copied.state='singing';await s.persist(copied);const restarted=await new PhrasingService({root:s.root,project:s.project,composer:s.composer,connection:s.connection,worker}).init();assert.equal(restarted.get(j.id).state,'interrupted');assert.equal(restarted.get(j.id).scoreHash,s.get(j.id).scoreHash);await s.close();await restarted.close();
});
