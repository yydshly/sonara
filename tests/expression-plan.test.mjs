import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {applyExpression,expressionPrompt} from '../server/expression-plan.mjs';
import {initialBrief,hash} from '../server/song-project.mjs';
import {PhrasingService} from '../server/phrasing-service.mjs';
const base=JSON.parse(await readFile(resolve('dist/youth-song/score.json'),'utf8'));
const bridge=base.phrases.filter(p=>p.section==='bridge');
const raw=()=>({summary:'自动测试表达方案，不是试听结论。',phrases:bridge.map(p=>({index:p.index,lyrics:p.lyrics,pinyin:p.notes.map(n=>n.pinyin),lead:.5,beats:p.notes.map(n=>n.beats),delivery:{breathinessDb:p.notes.map((_,i)=>i===2?.5:0),tensionDb:p.notes.map((_,i)=>i===2?-.5:0),velocity:p.notes.map(()=>1)},focusWord:p.lyrics.slice(0,2),reason:'在个别字上尝试更松的发声，等待试听判断。',listenFor:'重点字是否自然，句尾有没有过虚？'}))});
test('model delivery changes are independent of timing and keep lyrics, notes and all unselected phrases',()=>{
  const result=applyExpression(raw(),base,'bridge');assert.equal(result.changes.length,2);assert.ok(result.changes.every(c=>!c.timingChanged&&!c.lyricChanged&&c.voiceChanged));assert.equal(result.checks.quality,'unreviewed');
  assert.deepEqual(result.score.harmony,base.harmony);for(const p of base.phrases){const after=result.score.phrases.find(q=>q.index===p.index);if(p.section!=='bridge')assert.deepEqual(after,p);assert.deepEqual(after.notes,p.notes);}
  const other=raw();other.phrases[0].delivery.tensionDb[2]=.5;assert.notEqual(applyExpression(other,base,'bridge').scoreHash,result.scoreHash);
});
test('resonant lyric proposals require explicit permission, aligned pronunciation and protect the title',()=>{
  const input=raw();input.phrases[0].lyrics='若有天你经过旧操场';input.phrases[0].pinyin[1]='you';input.phrases[0].focusWord='旧操场';assert.throws(()=>applyExpression(input,base,'bridge'));
  const result=applyExpression(input,base,'bridge',{rewriteLyrics:true});assert.equal(result.checks.lyricsPreserved,false);assert.equal(result.score.lyrics[20],'若有天你经过旧操场');assert.equal(result.score.sections.find(s=>s.id==='bridge').lyrics[0],input.phrases[0].lyrics);assert.equal(result.changes[0].before.lyrics,bridge[0].lyrics);assert.equal(result.score.phrases[20].notes[1].lyric,'有');assert.equal(result.score.phrases[20].notes[1].pinyin,'you');
  const title=base.phrases.find(p=>p.lyrics===base.title),one={...base,phrases:[title]},patch=raw();patch.phrases=[{...patch.phrases[0],index:title.index,lyrics:'那条放学后的街',pinyin:title.notes.map(n=>n.pinyin),beats:title.notes.map(n=>n.beats),delivery:{breathinessDb:title.notes.map(()=>.5),tensionDb:title.notes.map(()=>0),velocity:title.notes.map(()=>1)}}];assert.throws(()=>applyExpression(patch,one,'all',{rewriteLyrics:true}));
});
test('invalid acoustic controls, scope, lyric lengths and no-op proposals are rejected',()=>{
  for(const edit of [r=>r.phrases[0].delivery.breathinessDb[0]=10,r=>r.phrases[0].delivery.tensionDb[0]=NaN,r=>r.phrases[0].delivery.velocity[0]=2,r=>r.phrases[0].delivery.velocity.pop(),r=>r.phrases[0].delivery.gain=5,r=>r.phrases[0].index=0,r=>r.phrases[0].pinyin[0]='x;exec',r=>r.phrases[0].lyrics='字数不对',r=>r.phrases.pop(),r=>r.phrases[0].notes=[]]){const input=raw();edit(input);assert.throws(()=>applyExpression(input,base,'bridge'));}
  const same=raw();for(const p of same.phrases){p.delivery.breathinessDb.fill(0);p.delivery.tensionDb.fill(0);}assert.throws(()=>applyExpression(same,base,'bridge'));assert.throws(()=>applyExpression(raw(),base,'bridge',{rewriteLyrics:true}));
  const prompt=expressionPrompt({brief:initialBrief(base),score:base,sectionId:'bridge',focus:'release',rewriteLyrics:true,feedback:'尾字太紧'});assert.ok(prompt.includes('recognisable human actions'));assert.ok(prompt.includes('Do NOT equate'));assert.ok(prompt.includes('尾字太紧'));assert.ok(prompt.includes('Never claim to have listened'));
});
function wav(duration){const b=Buffer.alloc(44+Math.round(duration*44100)*6);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(44100,24);b.writeUInt32LE(264600,28);b.writeUInt16LE(6,32);b.writeUInt16LE(24,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
test('expression plans freeze model inputs, require their exact control hash, and verify execution evidence',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sonara-expression-')),small={...base,duration:1,phrases:bridge.map((p,i)=>({...p,start:i*.5,end:(i+1)*.5,notes:p.notes.map(n=>({...n,start:i*.5+(n.start-p.start)}))}))};
  const project={source:root,score:small,scoreSourceHash:'base',available:true,draft:{revision:3,brief:initialBrief(base)},fingerprints:async()=>({'score.json':'base'})};let captured,verified=false;
  const worker=async({path,mode})=>{const request=JSON.parse(await readFile(join(path,'request.json'),'utf8'));const data=wav(1);if(mode==='prepare'){for(const name of ['preview-A.wav','preview-B.wav'])await writeFile(join(path,name),data);await writeFile(join(path,'preview.json'),JSON.stringify({scoreHash:request.scoreHash,offset:0,duration:1}));}else{for(const name of ['song.wav','vocal.wav'])await writeFile(join(path,name),data);await writeFile(join(path,'result.json'),JSON.stringify({scoreHash:request.scoreHash,duration:1,sampleRate:44100,bitDepth:24,peak:.5,unchangedOutsideRegions:true,lyricsMatchApprovedScore:true,notePitchesPreserved:true,regions:request.changes.map(({index,start,end})=>({index,start,end})),expressionEvidence:request.changes.map(c=>({index:c.index,acousticInputsVerified:verified,requested:c.delivery,curves:Object.fromEntries(['breathinessDb','tensionDb','velocity'].map(k=>[k,{controlledFrames:20,beforeHash:'b'.repeat(64),afterHash:'a'.repeat(64)}]))})),files:{'song.wav':hash(data),'vocal.wav':hash(data)}}));}};
  const service=await new PhrasingService({root,project,connection:{ready:true},composer:{phrase:async input=>{captured=input;return raw();}},worker}).init();
  const request={requestId:randomUUID(),revision:3,sectionId:'all',focus:'release',expression:true,rewriteLyrics:false,feedback:'轻声讲述'};
  const j=await service.create(request);await service.completion;assert.equal(service.get(j.id).state,'draft');assert.equal(captured.feedback,request.feedback);assert.equal(captured.expression,true);assert.equal((await service.create(request)).id,j.id);await assert.rejects(service.create({...request,rewriteLyrics:true}),e=>e.status===409);
  const old=service.get(j.id).scoreHash;await assert.rejects(service.render(j.id,{scoreHash:'outdated'}),e=>e.status===409);await service.render(j.id,{scoreHash:old});await service.completion;assert.equal(service.get(j.id).state,'failed');await assert.rejects(service.asset(j.id,'song'));verified=true;await service.render(j.id,{scoreHash:old});await service.completion;assert.equal(service.get(j.id).state,'succeeded');assert.match((await service.asset(j.id,'lyrics')).data.toString(),/旧操场/);
  await service.close();
});
