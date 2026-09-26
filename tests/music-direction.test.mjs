import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CompositionService} from '../server/composition-service.mjs';
import {validateComposition,compositionPrompt} from '../server/composition-score.mjs';
import {validateMusicDirection} from '../server/music-direction.mjs';
import {applyRevision} from '../server/composition-revision.mjs';
const music={style:'rock',bpm:132,voice:'qixuan'};
const raw=(bpm=132)=>({title:'风格验证',description:'自动验证用词曲',bpm,phrases:Array.from({length:4},()=>({lyrics:'晚风吹过我们身旁',chords:['C','Am'],notes:[.5,.75,.75,.5,.5,1,1,2].map((beats,i)=>({midi:[60,62,64,65,67,65,62,60][i],beats,pinyin:'wo'}))}))});
const input=(settings=music)=>({requestId:randomUUID(),idea:'沿着海岸骑车，把积压的心事大声唱出来',music:settings});
const wav=()=>{const b=Buffer.alloc(1500);b.write('RIFF');b.write('WAVE',8);return b;};
async function service({prove=true,...options}={}){return new CompositionService({root:resolve('.'),directory:await mkdtemp(join(tmpdir(),'sonara-music-')),composer:{status:async()=>({ready:true}),compose:async({music})=>raw(music.bpm)},prepare:async path=>{await writeFile(join(path,'guide.wav'),wav());await writeFile(join(path,'accompaniment.wav'),wav());},worker:async({path,mode})=>{if(mode==='check')return;const score=JSON.parse(await readFile(join(path,'score.json'),'utf8'));let arrangement;try{arrangement=JSON.parse(await readFile(join(path,'rearrangement.json'),'utf8'));}catch{}for(const n of ['song','vocal'])await writeFile(join(path,n+'.wav'),wav());await writeFile(join(path,'result.json'),JSON.stringify({sampleRate:44100,duration:score.duration,bitDepth:24,peak:.6,...(arrangement&&prove?{reusedVocal:arrangement.reuseVocal,scoreNotesPreserved:true}:{})}));},...options}).init();}
async function ready(s){const j=await s.create(input());await s.tail;assert.equal(s.get(j.id).state,'draft');await s.render(j.id);await s.tail;assert.equal(s.get(j.id).state,'succeeded');return s.get(j.id);}

test('style settings validate before scheduling, and a model cannot silently change the selected BPM',async()=>{
  for(const value of [{...music,bpm:145},{...music,bpm:71},{...music,bpm:100.5},{...music,voice:'other'},{...music,style:'other'},{...music,secret:'x'},[]])assert.throws(()=>validateMusicDirection(value));
  assert.throws(()=>validateComposition(raw(88),music),/选定速度不同/);
  const s=await service();for(const value of [{...music,bpm:500},{...music,style:'other'}])await assert.rejects(s.create(input(value)));assert.equal(s.jobs.size,0);await s.close();
  assert.match(compositionPrompt('骑车',null,music),/132/);assert.match(compositionPrompt('骑车',null,music),/short energetic phrases/);
});
test('short rhythms, fourteen syllables and exact chosen tempo produce aligned score positions',()=>{
  const r=raw(144);r.phrases[0].lyrics='晚风吹过我们身旁一起骑车远方';r.phrases[0].notes=Array.from({length:14},()=>({midi:60,beats:.5,pinyin:'wo'}));
  const s=validateComposition(r,{...music,bpm:144});assert.equal(s.phrases[0].notes.length,14);assert.equal(s.phrases[1].start,8*60/144);assert.equal(s.phrases[0].notes.at(-1).beat,7);assert.equal(s.voice,'绮萱 Qixuan');
});
test('music settings persist, deduplicate and survive a local lyric revision',async()=>{
  let received;const s=await service({composer:{status:async()=>({ready:true}),compose:async args=>{received=args;return raw(args.music.bpm);}}}),request=input(),original=structuredClone(request),j=await s.create(request);request.music={...music,bpm:100};await s.tail;
  assert.deepEqual(received.music,original.music);assert.deepEqual(s.get(j.id).music,original.music);assert.deepEqual(JSON.parse((await s.asset(j.id,'score')).data).music,original.music);
  assert.equal((await s.create(original)).id,j.id);await assert.rejects(s.create(request),e=>e.status===409);
  const revision=applyRevision(s.get(j.id).score,{description:'换成清晨画面',lyrics:'晨风吹过我们身旁',pinyin:['chen','feng','chui','guo','wo','men','shen','pang']},{mode:'lyrics',lineIndex:0});assert.deepEqual(revision.score.music,original.music);await s.close();
});
test('rearranging retimes the score without model calls or changing lyric, pitch and beat content',async()=>{
  const s=await service(),base=await ready(s),original=JSON.stringify(base.score);s.composer.compose=()=>{throw Error('must not call model');};s.connection.ready=false;
  const request=input({style:'folk',bpm:100,voice:'ria'}),a=await s.rearrange(base.id,request);assert.equal((await s.rearrange(base.id,request)).id,a.id);await s.tail;const next=s.get(a.id);
  assert.equal(next.state,'draft');assert.equal(next.version,2);assert.equal(next.difference.reuseVocal,false);assert.equal(next.score.phrases[1].start,4.8);
  const content=s=>s.phrases.map(p=>[p.lyrics,p.chords,p.notes.map(n=>[n.midi,n.beats,n.beat,n.pinyin])]);assert.deepEqual(content(next.score),content(base.score));assert.equal(JSON.stringify(base.score),original);
  await assert.rejects(s.render(next.id),e=>e.status===409);await assert.rejects(s.render(next.id,{scoreHash:'stale'}),e=>e.status===409);await assert.rejects(s.rearrange(base.id,{...request,music:{...request.music,bpm:110}}),e=>e.status===409);
  await s.render(next.id,{scoreHash:next.scoreHash});await s.tail;assert.equal(s.get(next.id).state,'succeeded');assert.equal(JSON.stringify(base.score),original);await s.close();
});
test('style-only revisions reuse vocals, while changing voice requires resinging',async()=>{
  const s=await service(),base=await ready(s);await assert.rejects(s.rearrange(base.id,input()),/没有变化/);
  const a=await s.rearrange(base.id,input({...music,style:'folk'}));await s.tail;assert.equal(s.get(a.id).difference.reuseVocal,true);await s.render(a.id,{scoreHash:s.get(a.id).scoreHash});await s.tail;assert.equal(s.get(a.id).state,'succeeded');
  const b=await s.rearrange(a.id,input({...music,style:'folk',voice:'ria'}));await s.tail;assert.equal(s.get(b.id).difference.reuseVocal,false);await s.close();
});
test('unproven preservation cannot publish an arrangement as successful',async()=>{
  const s=await service({prove:false}),base=await ready(s),a=await s.rearrange(base.id,input({...music,style:'ballad'}));await s.tail;await s.render(a.id,{scoreHash:s.get(a.id).scoreHash});await s.tail;assert.equal(s.get(a.id).state,'failed');assert.equal(s.get(base.id).state,'succeeded');await assert.rejects(s.asset(a.id,'song'));await s.close();
});
test('sparse accompaniment survives creation and rearrangement while invalid textures are rejected',async()=>{
  const sparse={style:'retro',bpm:116,voice:'qixuan',texture:'sparse'};
  assert.deepEqual(validateMusicDirection(sparse),sparse);assert.deepEqual(validateMusicDirection({...music,texture:'standard'}),music);assert.throws(()=>validateMusicDirection({...music,texture:'sparse'}));assert.throws(()=>validateMusicDirection({...sparse,texture:'unknown'}));assert.match(compositionPrompt('老朋友重逢',null,sparse),/不加入清音吉他/);
  const s=await service(),draft=await s.create(input(sparse));await s.tail;assert.deepEqual(s.get(draft.id).score.music,sparse);await s.render(draft.id);await s.tail;
  const next=await s.rearrange(draft.id,input({style:'retro',bpm:116,voice:'qixuan'}));await s.tail;assert.equal(s.get(next.id).difference.reuseVocal,true);assert.equal(s.get(next.id).score.music.texture,undefined);assert.equal(s.get(draft.id).score.music.texture,'sparse');await s.close();
});
test('changing arrangement retains the rests established by lyric phrasing',async()=>{
  const s=await service({composer:{status:async()=>({ready:true}),compose:async({music})=>{const r=raw(music.bpm);r.phrases[0].notes[3].restAfter=.5;r.phrases[0].notes[7].beats=1.5;return r;}}}),base=await ready(s);
  const revised=await s.rearrange(base.id,input({...music,style:'retro'}));await s.tail;const next=s.get(revised.id);assert.equal(next.state,'draft');assert.equal(next.score.phrases[0].notes[3].restAfter,.5);assert.equal(next.score.phrases[0].notes[4].beat,base.score.phrases[0].notes[4].beat);assert.equal(next.difference.reuseVocal,true);await s.close();
});
