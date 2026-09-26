import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const runtime=await readFile(new URL('../deploy/remote-runtime.js',import.meta.url),'utf8');
function preview(){
  const calls=[],context={URL,Request,Response,location:{href:'https://example.test/sonara/compose.html',origin:'https://example.test'},document:{addEventListener(){}},fetch:async(...args)=>{calls.push(args);return new Response('audio');},SONARA_DEPLOYMENT:{basePath:'/sonara',snapshots:{'/api/compositions':{connection:{ready:false},jobs:[]}},assets:{'/api/compositions/demo/assets/song':'/published/demo/song.mp3','/youth-song/song.wav':'/published/song.mp3'}}};
  vm.runInNewContext(runtime,context);return {context,calls};
}
test('preview reads real published data and rejects backend writes without making network calls',async()=>{
  const {context,calls}=preview();const data=await(await context.fetch('/sonara/api/compositions')).json();assert.equal(data.connection.ready,false);assert.equal(calls.length,0);
  const write=await context.fetch('/sonara/api/compositions',{method:'POST',body:'story'});assert.equal(write.status,503);assert.match((await write.json()).error,/远端展示版/);assert.equal(calls.length,0);
  assert.equal((await context.fetch('/sonara/api/private-job')).status,404);assert.equal(calls.length,0);
});
test('subpath deployment routes native media and downloads without changing external URLs',async()=>{
  const {context,calls}=preview();assert.equal(context.SONARA_ASSET('/sonara/api/compositions/demo/assets/song'),'/sonara/published/demo/song.mp3');assert.equal(context.SONARA_ASSET('/youth-song/song.wav'),'/sonara/published/song.mp3');assert.equal(context.SONARA_ASSET('https://elsewhere.test/youth-song/song.wav'),'https://elsewhere.test/youth-song/song.wav');
  await context.fetch('/sonara/api/compositions/demo/assets/song',{headers:{Range:'bytes=0-43'}});assert.equal(calls[0][0],'/sonara/published/demo/song.mp3');assert.equal(calls[0][1].headers.Range,'bytes=0-43');
});
test('published snapshot contains only selected completed demonstrations and no saved user judgments',async()=>{
  const config=JSON.parse(await readFile(new URL('../published/runtime-data.json',import.meta.url),'utf8'));
  assert.deepEqual(config.snapshots['/api/compositions'].jobs.map(j=>j.id).sort(),['566a9bad-5785-459a-8f6d-78c271e970be','940817ab-94bc-477b-87c3-ec3a09845892'].sort());
  assert.equal(config.snapshots['/api/compositions'].connection.ready,false);assert.equal(config.snapshots['/api/score'].ready,false);assert.equal(config.snapshots['/api/song-project'].observations.length,0);assert.equal(config.snapshots['/api/listening-trial'].current,null);
  assert.ok(Object.values(config.assets).every(path=>path.startsWith('/published/')&&!path.includes('..')));
});
