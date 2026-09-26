import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {initialBrief,validateBrief,compilePlan,hash} from '../server/song-project.mjs';
import {SongProjectService} from '../server/song-project-service.mjs';
import {createServer} from '../server/http.mjs';

const score={title:'自动验证素材',duration:1,sampleRate:44100,sections:[{id:'verse1',name:'主歌',start:0,end:.5,lyrics:['测试'],intention:'讲述'},{id:'chorus1',name:'副歌',start:.5,end:1,lyrics:['测试'],intention:'展开'}]};
function wav(){const b=Buffer.alloc(44+44100*6);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(44100,24);b.writeUInt32LE(44100*6,28);b.writeUInt16LE(6,32);b.writeUInt16LE(24,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
async function worker({path}){const request=JSON.parse(await readFile(join(path,'request.json'),'utf8'));const data=wav();for(const name of ['song','accompaniment'])await writeFile(join(path,name+'.wav'),data);await writeFile(join(path,'result.json'),JSON.stringify({proposalHash:request.proposal.hash,sampleRate:44100,duration:1,bitDepth:24,peak:.3,unchangedOutsideRegions:true,files:{'song.wav':hash(data),'accompaniment.wav':hash(data)}}));}
async function setup(options={}){const root=await mkdtemp(join(tmpdir(),'sonara-project-'));await mkdir(join(root,'dist/youth-song'),{recursive:true});await writeFile(join(root,'dist/youth-song/score.json'),JSON.stringify(score));for(const name of ['song','accompaniment','vocal','piano','guitar','bass','drums','strings'])await writeFile(join(root,'dist/youth-song',name+'.wav'),wav());return new SongProjectService({root,worker,...options}).init();}
async function proposal(s){const {draft}=s.snapshot();const brief=structuredClone(draft.brief);brief.sections[1].treatment='lift';return (await s.prepare({revision:draft.revision,brief})).draft.proposal;}

test('brief validation cannot silently turn narrative goals into unsupported musical edits',()=>{
  const brief=initialBrief(score);brief.goal.message='改成摇滚并重新演唱';assert.equal(compilePlan(brief,score).changes.length,0);
  brief.sections[1].treatment='lift';const p=compilePlan(brief,score);assert.equal(p.changes[0].name,'副歌');assert.equal(p.changes[0].start,.5);assert.equal(p.assessment.state,'unreviewed');assert.equal(p.pending.length,3);
  for(const edit of [b=>b.sections.pop(),b=>b.sections.reverse(),b=>b.sections[0].treatment='new-singer',b=>b.goal.style='',b=>b.goal.secret='extra',b=>b.sections[0].performance='x'.repeat(401)]){const b=initialBrief(score);edit(b);assert.throws(()=>validateBrief(b,score));}
});
test('draft persistence, stale saves and stale confirmations protect the reviewed plan',async()=>{
  const s=await setup();const old=await proposal(s);await assert.rejects(s.prepare({revision:0,brief:old.brief}),e=>e.status===409);
  const next=structuredClone(old.brief);next.goal.feeling='更克制地表达';await s.prepare({revision:1,brief:next});await assert.rejects(s.render({requestId:randomUUID(),hash:old.hash}),e=>e.status===409);
  const restart=await new SongProjectService({root:s.root,worker}).init();assert.equal(restart.snapshot().draft.brief.goal.feeling,'更克制地表达');await s.close();await restart.close();
});
test('confirmed versions are immutable, idempotent, downloadable and require explicit listening feedback',async()=>{
  const s=await setup(),p=await proposal(s),input={requestId:randomUUID(),hash:p.hash};const j=await s.render(input);await s.completion;assert.equal(s.get(j.id).state,'succeeded');assert.equal(s.get(j.id).review,undefined);
  assert.equal((await s.render(input)).id,j.id);assert.equal(s.jobs.size,1);await assert.rejects(s.render({...input,hash:'changed'}),e=>e.status===409);
  const next=structuredClone(p.brief);next.goal.message='下一稿不同的目标';await s.prepare({revision:1,brief:next});assert.notEqual(s.get(j.id).proposal.brief.goal.message,next.goal.message);
  const record=JSON.parse((await s.asset(j.id,'record')).data);assert.equal(record.version.proposal.hash,p.hash);assert.equal(record.sourceAssets.length,9);assert.equal((await s.asset(j.id,'song')).type,'audio/wav');
  await assert.rejects(s.review(j.id,{verdict:'closer',note:''}));await s.review(j.id,{verdict:'unsure',note:'自动测试的记录，不是真人评价'});assert.equal(s.get(j.id).review.verdict,'unsure');await s.close();
});
test('cancelled or failed renders cannot publish even if a late worker produces files',async()=>{
  let release,started;const gate=new Promise(r=>release=r),start=new Promise(r=>started=r);const s=await setup({worker:async input=>{started();await gate;await worker(input);}});const p=await proposal(s);const j=await s.render({requestId:randomUUID(),hash:p.hash});await start;await s.cancel(j.id);release();await s.completion;assert.equal(s.get(j.id).state,'cancelled');await assert.rejects(s.asset(j.id,'song'));await s.close();
  const failing=await setup({worker:async()=>{throw Error('Test failure');}});const fp=await proposal(failing),fj=await failing.render({requestId:randomUUID(),hash:fp.hash});await failing.completion;assert.equal(failing.get(fj.id).state,'failed');await assert.rejects(failing.asset(fj.id,'song'));await failing.close();
});
test('source replacement invalidates a confirmed proposal and tampered output is not published',async()=>{
  const s=await setup(),p=await proposal(s);await writeFile(join(s.source,'piano.wav'),'changed');await assert.rejects(s.render({requestId:randomUUID(),hash:p.hash}),e=>e.status===409);await s.close();
  const broken=await setup({worker:async input=>{await worker(input);await writeFile(join(input.path,'song.wav'),'broken');}}),bp=await proposal(broken),j=await broken.render({requestId:randomUUID(),hash:bp.hash});await broken.completion;assert.equal(broken.get(j.id).state,'failed');await broken.close();
});
test('HTTP project flow uses same-origin checks and byte ranges for rendered comparison',async()=>{
  const s=await setup(),server=createServer({root:join(s.root,'dist'),service:{},songProjectService:s});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
  try{
    const snap=await (await fetch(url+'/api/song-project')).json();assert.equal(snap.draft.revision,0);
    const denied=await fetch(url+'/api/song-project/prepare',{method:'POST',headers:{Origin:'https://example.org','Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);
    const p=await proposal(s),j=await s.render({requestId:randomUUID(),hash:p.hash});await s.completion;
    const audio=await fetch(`${url}/api/song-project/${j.id}/assets/song`,{headers:{Range:'bytes=0-11'}});assert.equal(audio.status,206);assert.equal((await audio.arrayBuffer()).byteLength,12);
    assert.equal((await fetch(`${url}/api/song-project/${j.id}/assets/request`)).status,404);
  }finally{await new Promise(r=>server.close(r));await s.close();}
});

test('failed saves neither start a worker nor publish success; incomplete folders survive restart',async()=>{
  let calls=0;const s=await setup({worker:async input=>{calls++;await worker(input);}}),p=await proposal(s),save=s.save.bind(s);s.save=async()=>{throw Error('Disk unavailable');};
  await assert.rejects(s.render({requestId:randomUUID(),hash:p.hash}));assert.equal(calls,0);assert.equal(s.jobs.size,0);
  s.save=save;const restart=await new SongProjectService({root:s.root,worker}).init();assert.equal(restart.jobs.size,0);await restart.close();
  s.save=async(file,value)=>{if(value.state==='succeeded'||value.state==='failed')throw Error('Disk unavailable');return save(file,value);};
  const j=await s.render({requestId:randomUUID(),hash:p.hash});await s.completion;assert.equal(s.get(j.id).state,'failed');await assert.rejects(s.asset(j.id,'song'));await s.close();
  const again=await new SongProjectService({root:s.root,worker}).init();assert.equal(again.get(j.id).state,'interrupted');await again.close();
});

test('shutdown during source checks cannot schedule a new worker',async()=>{
  const s=await setup(),p=await proposal(s);let release,started;const gate=new Promise(r=>release=r),start=new Promise(r=>started=r),fingerprints=s.fingerprints.bind(s);s.fingerprints=async()=>{started();await gate;return fingerprints();};
  const rendering=s.render({requestId:randomUUID(),hash:p.hash});await start;const closed=s.close();release();await assert.rejects(rendering,e=>e.status===503);await closed;assert.equal(s.jobs.size,0);
});

test('legacy goals acquire independent expression targets without changing a frozen proposal',async()=>{
  const s=await setup(),p=await proposal(s),draft=structuredClone(s.draft);
  for(const section of draft.brief.sections)delete section.expression;
  const {hash:oldHash,...oldProposal}=draft.proposal;draft.proposal.hash=hash(oldProposal);const frozen=structuredClone(draft.proposal);
  await s.save('draft.json',draft);await s.close();
  const restored=await new SongProjectService({root:s.root,worker}).init();
  assert.deepEqual(restored.draft.brief.sections[0].expression,{energy:2,tension:2,listenFor:'是否像在讲一段真实的放学记忆，而不是念词？'});
  assert.deepEqual(restored.draft.proposal,frozen);assert.equal(restored.draft.revision,draft.revision);
  for(const edit of [b=>b.sections[0].expression.energy=0,b=>b.sections[0].expression.tension=6,b=>b.sections[0].expression.energy=1.5,b=>b.sections[0].expression.listenFor='',b=>b.sections[0].expression.detectedQuality=100]){const b=initialBrief(score);edit(b);assert.throws(()=>validateBrief(b,score));}
  await restored.close();
});

test('listening judgments bind independently to an audio version, a section, a time and an immutable target',async()=>{
  const s=await setup(),input={requestId:randomUUID(),revision:0,sectionId:'verse1',version:'original',at:.2,emotion:'met',musicality:'gap',sound:'unsure',note:'自动测试的听感占位，不是真人评价'};
  const saved=await s.observe(input);assert.equal(saved.source.kind,'original');assert.equal(saved.musicality,'gap');assert.equal(saved.sound,'unsure');assert.equal((await s.observe(input)).id,saved.id);assert.equal(s.observations.length,1);
  await assert.rejects(s.observe({...input,note:'changed'}),e=>e.status===409);
  for(const update of [{at:.5},{at:-.1},{at:NaN},{sound:'better'},{sectionId:'unknown'},{note:' '},{version:randomUUID()},{version:'phrasing:'+randomUUID()}])await assert.rejects(s.observe({...input,...update,requestId:randomUUID()}));
  const next=structuredClone(s.draft.brief);next.sections[0].emotion='更沉静';next.sections[0].expression={energy:1,tension:4,listenFor:'安静中是否听出了悬念？'};
  await s.prepare({revision:0,brief:next});assert.notEqual(s.observations[0].target.section.emotion,'更沉静');assert.equal(s.observations[0].target.section.expression.tension,2);
  await assert.rejects(s.observe({...input,requestId:randomUUID()}),e=>e.status===409);
  const restarted=await new SongProjectService({root:s.root,worker}).init();assert.deepEqual(restarted.observations[0],saved);await restarted.close();await s.close();
});

test('listening records publish only after persistence and reject unfinished or mismatched versions',async()=>{
  const s=await setup(),p=await proposal(s),v=await s.render({requestId:randomUUID(),hash:p.hash});await s.completion;
  const input={requestId:randomUUID(),revision:1,sectionId:'chorus1',version:v.id,at:.6,emotion:'gap',musicality:'met',sound:'gap',note:'自动测试，不是真人评价'};
  const mix=await s.observe(input);assert.equal(mix.source.proposalHash,p.hash);
  const voice={id:randomUUID(),number:4,state:'succeeded',scoreHash:'test-score'};
  await assert.rejects(s.observe({...input,requestId:randomUUID(),version:`phrasing:${voice.id}`},{...voice,state:'singing'}));
  await assert.rejects(s.observe({...input,requestId:randomUUID(),version:`phrasing:${voice.id}`},{...voice,id:randomUUID()}));
  const heard=await s.observe({...input,requestId:randomUUID(),version:`phrasing:${voice.id}`},voice);assert.equal(heard.source.label,'P4 乐句演唱');assert.equal(heard.source.scoreHash,'test-score');
  const save=s.save.bind(s);s.save=async()=>{throw Error('Disk full');};await assert.rejects(s.observe({...input,requestId:randomUUID()}));assert.equal(s.observations.length,2);s.save=save;await s.close();
});

test('HTTP observations enforce same origin and bind known versions',async()=>{
  const s=await setup(),server=createServer({root:join(s.root,'dist'),service:{},songProjectService:s});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/song-project/observations`;
  const input={requestId:randomUUID(),revision:0,sectionId:'verse1',version:'original',at:.2,emotion:'met',musicality:'unsure',sound:'gap',note:'HTTP 自动测试记录，不是真人评价'};
  try{assert.equal((await fetch(url,{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:JSON.stringify(input)})).status,403);const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(res.status,200);assert.equal((await res.json()).target.section.id,'verse1');}
  finally{await new Promise(r=>server.close(r));await s.close();}
});

test('singing comparison records bind to verified audio; missing or replaced takes are rejected',async()=>{
  const s=await setup(),id='vocal-alignment-v1',path=join(s.source,id);
  const input={requestId:randomUUID(),revision:0,sectionId:'chorus1',version:id,at:.6,emotion:'unsure',musicality:'unsure',sound:'unsure',note:'自动验证占位，不是真人试听'};
  assert.equal(s.snapshot().vocalStudy,null);await assert.rejects(s.observe(input),e=>e.status===409);
  await mkdir(path);const audio=wav();await writeFile(join(path,'song.wav'),audio);await writeFile(join(path,'vocal.wav'),audio);
  const sourceHashes={};for(const name of ['score.json','song.wav','vocal.wav','accompaniment.wav'])sourceHashes[name]=hash(await readFile(join(s.source,name)));
  const result={id,status:'rendered',policy:'vowel-onset-v1',start:.5,end:1,scoreAndLyricsUnchanged:true,backingUnchanged:true,outsideRegionUnchanged:true,sourceHashes,files:{'song.wav':hash(audio),'vocal.wav':hash(audio)}};
  await writeFile(join(path,'result.json'),JSON.stringify(result));
  const restored=await new SongProjectService({root:s.root,worker}).init();assert.equal(restored.snapshot().vocalStudy.id,id);
  const saved=await restored.observe(input);assert.equal(saved.source.kind,'vocal-alignment');assert.equal(saved.source.audioHash,hash(audio));
  await writeFile(join(path,'song.wav'),'changed');assert.equal(await restored.readVocalStudy(),null);await assert.rejects(restored.observe({...input,requestId:randomUUID()}),e=>e.status===409);
  await writeFile(join(path,'song.wav'),audio);await writeFile(join(s.source,'accompaniment.wav'),'changed source');assert.equal(await restored.readVocalStudy(),null);
  await restored.close();await s.close();
});

test('arrangement comparisons preserve provenance and reject an unknown style or changed vocal',async()=>{
  const s=await setup(),path=join(s.source,'arrangement-study-v1'),audio=wav();
  await mkdir(join(s.source,'vocal-alignment-v1'));
  for(const name of ['song.wav','vocal.wav'])await writeFile(join(s.source,'vocal-alignment-v1',name),audio);
  const sourceHashes={};for(const name of ['score.json','song.wav','accompaniment.wav','vocal-alignment-v1/song.wav','vocal-alignment-v1/vocal.wav'])sourceHashes[name]=hash(await readFile(join(s.source,name)));
  const arrangements=[];
  for(const id of ['folk','retro','ballad']){await mkdir(join(path,id),{recursive:true});for(const name of ['song.wav','accompaniment.wav'])await writeFile(join(path,id,name),audio);arrangements.push({id,name:id,feeling:'Test feeling',detail:'Test arrangement',start:.5,end:1,outsideRegionUnchanged:true,vocalPreserved:true,files:{'song.wav':hash(audio),'accompaniment.wav':hash(audio)}});}
  await writeFile(join(path,'result.json'),JSON.stringify({id:'arrangement-study-v1',status:'rendered',sampleRate:44100,duration:1,sourceHashes,arrangements}));
  const restored=await new SongProjectService({root:s.root,worker}).init();assert.equal(restored.snapshot().arrangementStudies.length,3);
  const input={requestId:randomUUID(),revision:0,sectionId:'chorus1',version:'arrangement:folk',at:.6,emotion:'unsure',musicality:'unsure',sound:'unsure',note:'自动测试，非真人评价'};
  const saved=await restored.observe(input);assert.equal(saved.source.kind,'arrangement');assert.equal(saved.source.backingHash,hash(audio));
  await assert.rejects(restored.observe({...input,requestId:randomUUID(),version:'arrangement:../../private'}),e=>e.status===409);
  await writeFile(join(s.source,'vocal-alignment-v1/vocal.wav'),'replaced');assert.deepEqual(await restored.readArrangementStudies(),[]);
  await assert.rejects(restored.observe({...input,requestId:randomUUID()}),e=>e.status===409);
  await s.close();await restored.close();
});
