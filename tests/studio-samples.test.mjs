import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspirations,inspirationDraft,createInspirationPicker} from '../dist/studio-inspirations.mjs';
import {validateSamples,sampleCopy} from '../dist/studio-sample-library.mjs';
import {makeProject,makeTask,musicRequest} from '../dist/studio-core.mjs';
import {randomUUID} from 'node:crypto';

const artifact=JSON.parse(await readFile(new URL('../dist/studio-samples.json',import.meta.url),'utf8'));

test('random exploration covers every scenario before repeating and never mutates its source',()=>{
  const source=structuredClone(inspirations),pick=createInspirationPicker(source,()=>0);
  let previous=null;
  for(let round=0;round<4;round++){
    const ids=[];
    for(let n=0;n<source.length;n++){
      const result=pick();assert.notEqual(result.id,previous);previous=result.id;ids.push(result.id);result.idea='Changed in the new draft';
    }
    assert.equal(new Set(ids).size,source.length);
  }
  assert.deepEqual(source,inspirations);
});

test('starting from a sample creates an independent draft with no invented generated tasks or audio',()=>{
  const source=validateSamples(artifact).find(s=>s.draft.mode==='song');
  const copy=sampleCopy(source),project=makeProject(randomUUID(),copy);
  assert.equal(project.tasks.length,0);assert.equal(project.favorite,null);
  assert.equal(project.draft.lyrics,source.draft.lyrics);
  project.draft.lyrics='My own new lines';assert.notEqual(source.draft.lyrics,project.draft.lyrics);
  assert.equal(sampleCopy(source,false).lyrics,'');
});

test('public samples are real lyric drafts or instrumental briefs, with no private project records',()=>{
  const samples=validateSamples(artifact);
  assert.equal(samples.filter(s=>s.lyricsStatus==='generated-draft').length,6);
  assert.equal(samples.filter(s=>s.draft.mode==='instrumental').length,2);
  assert.ok(samples.some(s=>s.draft.language==='en'));
  for(const sample of samples){
    assert.equal(sample.musicStatus,'not-generated');
    for(const key of ['projectId','tasks','audio','history','favorite','events','apiKey'])assert.equal(Object.hasOwn(sample,key),false);
    if(sample.lyricsStatus==='generated-draft'){
      assert.ok(Number.isFinite(Date.parse(sample.provenance.generatedAt)));
      assert.ok(sample.provenance.elapsedSeconds>0);
      assert.match(sample.draft.lyrics,/\[Chorus\]/);
    }
  }
  for(const change of [d=>d.cases=[],d=>d.cases[0].musicStatus='generated',d=>d.cases[0].provenance.provider='unknown',d=>d.cases[1].id=d.cases[0].id]){
    const invalid=structuredClone(artifact);change(invalid);assert.throws(()=>validateSamples(invalid));
  }
});

test('instrumental scenarios omit vocals and songs remain unready until lyrics are written',()=>{
  for(const seed of inspirations){
    const draft=inspirationDraft(seed),project=makeProject(randomUUID(),draft);
    if(draft.mode==='instrumental'){
      const task=makeTask(project,{id:randomUUID(),requestId:randomUUID(),type:'music'}),request=musicRequest(project,task);
      assert.equal(request.lyrics,'');assert.match(request.direction.voice,/无演唱/);
      assert.equal(request.direction.emotionalArc.peak,draft.emotionPeak);
    }else assert.throws(()=>makeTask(project,{id:randomUUID(),requestId:randomUUID(),type:'music'}));
  }
});
