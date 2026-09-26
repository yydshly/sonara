import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateExpressiveScore,applyExpressiveRevision,expressivePrompt} from '../server/expressive-score.mjs';
import {scoreMidi} from '../server/score-midi.mjs';
import {CompositionService} from '../server/composition-service.mjs';

const raw=()=>({title:'旧日历',description:'在旧物中承认遗憾',emotionalArc:'平静回忆，转为祝福',music:{style:'folk',bpm:108,voice:'qixuan'},phrases:[2,3,2,1].map(bars=>({lyrics:'旧日历里',intent:'平静地说出画面',bars,chords:Array(bars).fill('C'),syllables:[...'旧日历里'].map((lyric,i)=>({lyric,pinyin:['jiu','ri','li','li'][i],offset:.5+i*.75,notes:i===0?[{midi:60,beats:.25},{midi:62,beats:.25}]:[{midi:64,beats:.5}],breathinessDb:0,velocity:1}))})),arrangement:[{instrument:'piano',role:'疏落地回答人声',notes:[{beat:0,beats:2,midi:60,velocity:55}]},{instrument:'bass',role:'稳住落点',notes:[{beat:0,beats:2,midi:36,velocity:65}]}]});
const score=()=>validateExpressiveScore(raw());
test('independent phrase lengths and melisma preserve one character and one pronunciation per syllable',()=>{
  const s=score();assert.deepEqual(s.phrases.map(p=>p.endBeat-p.startBeat),[8,12,8,4]);assert.equal(s.phrases[1].startBeat,8);assert.equal(s.phrases[2].startBeat,20);
  assert.equal(s.phrases[0].notes.length,5);assert.equal(s.phrases[0].syllables.length,4);assert.equal(s.phrases[0].notes[1].continuation,true);assert.equal(s.phrases[0].notes[1].pinyin,'jiu');
  const midi=scoreMidi(s,s.lyrics);assert.equal(midi.toString('utf8').split('旧').length-1,4,'a continued note must not repeat its lyric MIDI event');assert.deepEqual(s.arrangementTracks.bass.notes,raw().arrangement[1].notes);
});
test('rejects collisions, out-of-region backing, unsafe curves, unavailable voice and changes to user choices',()=>{
  for(const alter of [r=>r.phrases[0].syllables[1].offset=.5,r=>r.phrases[0].syllables[0].notes[0].beats=4,r=>r.phrases[0].syllables[0].notes[0].midi=80,r=>r.phrases[0].syllables[0].breathinessDb=2,r=>r.phrases[0].syllables[0].velocity=NaN,r=>r.phrases[0].syllables[0].lyric='它',r=>r.arrangement[0].notes[0].beat=32,r=>r.arrangement[0].instrument='../file',r=>r.phrases[0].extra=true]){const r=raw();alter(r);assert.throws(()=>validateExpressiveScore(r));}
  assert.throws(()=>validateExpressiveScore(raw(),null,['ria']));assert.throws(()=>validateExpressiveScore(raw(),{...raw().music,bpm:116}));
});
test('sustained notes remain available when musically intended; length is not a universal short-tail rule',()=>{
  const r=raw();r.phrases[0].syllables[3].notes[0].beats=3;assert.equal(validateExpressiveScore(r).phrases[0].notes.at(-1).beats,3);
  assert.match(expressivePrompt('故事',null,null,['qixuan']),/A long note is allowed when meaningful/);
});
test('performance revision is bounded to controls and does not mutate source, notes or backing',()=>{
  const base=score(),copy=JSON.stringify(base),request={mode:'performance',lineIndex:2};
  const patch={description:'以更轻的气声收住',intent:'轻轻承认遗憾',controls:base.phrases[2].syllables.map(()=>({breathinessDb:.4,velocity:.98}))};
  const {score:next,difference}=applyExpressiveRevision(base,patch,request);
  assert.equal(JSON.stringify(base),copy);assert.deepEqual(next.phrases[2].notes,base.phrases[2].notes);assert.deepEqual(next.arrangementTracks,base.arrangementTracks);assert.equal(difference.region.start,base.phrases[2].start);assert.equal(difference.region.end,base.phrases[2].end);
  for(const i of [0,1,3])assert.deepEqual(next.phrases[i],base.phrases[i]);
  assert.throws(()=>applyExpressiveRevision(base,{...patch,bpm:140},request));assert.throws(()=>applyExpressiveRevision(base,{...patch,controls:patch.controls.slice(1)},request));
  assert.throws(()=>applyExpressiveRevision(base,{...patch,controls:patch.controls.map(()=>({breathinessDb:0,velocity:1}))},request),/没有实际/);
});
test('joint phrase revision can change character count while holding boundaries and accompaniment',()=>{
  const base=score(),s=structuredClone(base.authored.phrases[0].syllables);s.push({lyric:'你',pinyin:'ni',offset:4,notes:[{midi:60,beats:1}],breathinessDb:0,velocity:1});
  const out=applyExpressiveRevision(base,{description:'多加一个叙事对象',intent:'看见旧物时想起你',lyrics:'旧日历里你',syllables:s},{mode:'phrasing',lineIndex:0});
  assert.equal(out.score.phrases[0].syllables.length,5);assert.deepEqual(out.difference.region,{start:base.phrases[0].start,end:base.phrases[0].end});assert.deepEqual(out.score.arrangementTracks,base.arrangementTracks);
});
test('lyric and melody revision respect syllables rather than assuming every character has one note',()=>{
  const base=score();const lyrics=applyExpressiveRevision(base,{description:'换成新的叙事',lyrics:'那日历里',pinyin:['na','ri','li','li']},{mode:'lyrics',lineIndex:0}).score;
  assert.equal(lyrics.phrases[0].notes[0].lyric,'那');assert.equal(lyrics.phrases[0].notes[1].pinyin,'na');assert.deepEqual(lyrics.phrases[0].notes.map(n=>n.midi),base.phrases[0].notes.map(n=>n.midi));
  const melody=applyExpressiveRevision(base,{description:'降低起音',pitches:[59,62,64,64,64]},{mode:'melody',lineIndex:0}).score;assert.equal(melody.phrases[0].notes[0].midi,59);assert.deepEqual(melody.lyrics,base.lyrics);
});
test('auto direction stays idempotent after model chooses music, survives restart, and requires confirming revisions',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sonara-expression-'));let received;
  const fakeWav=()=>{const b=Buffer.alloc(1500);b.write('RIFF');b.write('WAVE',8);return b;};
  const options={root:resolve('.'),directory:dir,composer:{status:async()=>({ready:true}),compose:async args=>{received=args;return raw();},revise:async({base})=>({description:'减少气声',intent:'收住情绪',controls:base.phrases[0].syllables.map(()=>({breathinessDb:-.5,velocity:1.01}))})},prepare:async path=>{for(const name of ['guide.wav','accompaniment.wav'])await writeFile(join(path,name),fakeWav());},worker:async({path,mode})=>{if(mode==='check')return;const s=JSON.parse(await readFile(join(path,'score.json'),'utf8'));let revision;try{revision=JSON.parse(await readFile(join(path,'revision.json'),'utf8'));}catch{}for(const name of ['song.wav','vocal.wav'])await writeFile(join(path,name),fakeWav());await writeFile(join(path,'result.json'),JSON.stringify({sampleRate:44100,duration:s.duration,bitDepth:24,peak:.6,...(revision?{unchangedOutsideRegion:true,identicalPitchControl:true,otherPerformanceCurvesPreserved:true,changedRegion:{start:s.phrases[0].start,end:s.phrases[0].end}}:{})}));}};
  let service=await new CompositionService(options).init();const request={requestId:randomUUID(),idea:'翻到旧日历时想起未成行的旅行',creationMode:'expressive',music:null};const j=await service.create(request);await service.tail;
  assert.equal(received.creationMode,'expressive');assert.deepEqual(received.availableVoices,['ria','qixuan']);assert.equal(service.get(j.id).state,'draft');assert.equal(service.get(j.id).music,undefined);assert.equal((await service.create(request)).id,j.id);await assert.rejects(service.create({...request,creationMode:undefined}),e=>e.status===409);
  await service.render(j.id);await service.tail;await service.close();service=await new CompositionService(options).init();assert.equal((await service.create(request)).id,j.id);
  await assert.rejects(service.rearrange(j.id,{requestId:randomUUID(),music:{style:'rock',bpm:120,voice:'qixuan'}}),/逐音符/);
  const r=await service.revise(j.id,{requestId:randomUUID(),mode:'performance',lineIndex:0,instruction:'保留词曲，减少气声'});await service.tail;assert.equal(service.get(r.id).state,'draft');assert.equal(service.get(r.id).creationMode,'expressive');await assert.rejects(service.render(r.id),e=>e.status===409);await service.render(r.id,{scoreHash:service.get(r.id).scoreHash});await service.tail;assert.equal(service.get(r.id).state,'succeeded');await service.close();
});
