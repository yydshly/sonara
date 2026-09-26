import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import { GenerationService } from '../server/generation-service.mjs';
import { createServer } from '../server/http.mjs';
import { validateGeneration, buildComposition, generatedVersion, lyricsState } from '../dist/generation-core.mjs';
import { editingSampleRate } from '../dist/audio-format.mjs';
import { renderMix, encodeWav } from '../dist/audio-core.mjs';
import { Player } from '../dist/player.mjs';
const input = (overrides = {}) => ({ projectId: randomUUID(), requestId: randomUUID(), title: '测试作品', mode: 'song', language: 'zh', style: 'warm', voice: 'any', duration: 60, lyrics: '[主歌]\n把今天折进旧口袋\n沿着街灯走回来\n[副歌]\n让晚风经过\n照见真实的我', ...overrides });
// Synthetic transport fixture only, not a playable vocal or quality sample.
const mp3Fixture = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200)]);
const fixtureResponse = () => new Response(mp3Fixture, { headers: { 'content-type': 'audio/mpeg', 'song-id': 'fixture-id' } });
async function service(options = {}) { return new GenerationService({ directory: await mkdtemp(join(tmpdir(), 'sonara-test-')), apiKey: 'test-only-secret', fetchImpl: async () => fixtureResponse(), ...options }).init(); }

test('Chinese and English lyrics survive the provider composition plan unchanged', () => {
  for (const lyrics of ['[主歌]\n把今天折进旧口袋\n[副歌]\n让晚风经过', '[Verse]\nFold the day into my coat\n[Chorus]\nLet the night wind carry me']) {
    const r = validateGeneration(input({ lyrics })), plan = buildComposition(r);
    assert.equal(plan.body.composition_plan.chunks.reduce((n, s) => n + s.duration_ms, 0), 60000);
    assert.equal(plan.sections.map(s => s.lyrics).join('\n'), lyrics.replace(/^\[.*\]\n/gm, ''));
    assert.ok(plan.body.composition_plan.chunks.every(c => c.duration_ms >= 3000 && c.duration_ms <= 120000));
    assert.equal(plan.body.prompt, undefined);
  }
});
test('instrumental requests do not transmit lyrics and use the instrumental flag', () => {
  const r = validateGeneration(input({ mode: 'instrumental' })), plan = buildComposition(r);
  assert.equal(r.lyrics, ''); assert.equal(plan.body.force_instrumental, true); assert.equal(plan.body.composition_plan, undefined);
});
test('invalid generation requests fail before a provider call', () => {
  for (const bad of [{ duration: 0 }, { mode: 'tts' }, { lyrics: '' }, { style: '__proto__' }, { projectId: '../../secret' }, { lyrics: 'a'.repeat(8001) }]) assert.throws(() => validateGeneration(input(bad)));
  assert.throws(() => buildComposition(validateGeneration(input({ lyrics: '[Verse]', duration: 30 }))));
});
test('missing credentials cannot create a job or invoke the provider', async () => {
  let calls = 0; const s = await service({ apiKey: '', fetchImpl: () => { calls++; } });
  await assert.rejects(s.create(input()), /尚未配置/); assert.equal(calls, 0); assert.equal(s.jobs.size, 0); assert.equal(s.status().configured, false);
});
test('concurrent duplicate requests create one durable job and one provider call', async () => {
  let calls = 0; const s = await service({ fetchImpl: async () => { calls++; return fixtureResponse(); } }), request = input();
  const [a, b] = await Promise.all([s.create(request), s.create(request)]); await s.tail;
  assert.equal(a.id, b.id); assert.equal(calls, 1); assert.equal(s.get(a.id).state, 'succeeded');
  assert.deepEqual(await s.audio(a.id), mp3Fixture);
  const record = await readFile(join(s.directory, `${a.id}.json`), 'utf8'); assert.ok(!record.includes('test-only-secret')); assert.ok(!JSON.stringify(s.status()).includes('test-only-secret'));
  await assert.rejects(s.create({ ...request, duration: 30 }), /内容已变化/);
  const restarted = await service({ directory: s.directory, fetchImpl: async () => { throw Error('must not call'); } });
  assert.equal((await restarted.create(request)).id, a.id); await restarted.tail;
});
test('provider rejection exposes safe status and never retries or stores success', async () => {
  let calls = 0; const s = await service({ fetchImpl: async () => { calls++; return new Response('private upstream details test-only-secret', { status: 401 }); } });
  const job = await s.create(input()); await s.tail;
  assert.equal(calls, 1); assert.equal(s.get(job.id).state, 'failed'); assert.match(s.get(job.id).error, /密钥无效/); assert.ok(!JSON.stringify(s.get(job.id)).includes('test-only-secret'));
  await assert.rejects(s.audio(job.id), /尚未准备/);
});
test('non-audio successful HTTP response is rejected as a generation failure', async () => {
  const s = await service({ fetchImpl: async () => new Response('not audio'.repeat(50)) }), job = await s.create(input()); await s.tail;
  assert.equal(s.get(job.id).state, 'failed');
});
test('cancel during a request cannot later become a successful result', async () => {
  let release, started; const running = new Promise(r => { started = r; });
  const s = await service({ fetchImpl: () => { started(); return new Promise(r => { release = r; }); } });
  const job = await s.create(input()); await running; await s.cancel(job.id); release(fixtureResponse()); await s.tail;
  assert.equal(s.get(job.id).state, 'cancelled'); assert.equal(JSON.parse(await readFile(join(s.directory, `${job.id}.json`))).state, 'cancelled');
});
test('queued cancellation prevents the queued provider call', async () => {
  let release, calls = 0; const s = await service({ fetchImpl: () => { calls++; return new Promise(r => { release = r; }); } });
  await s.create(input()); const queued = await s.create(input()); await s.cancel(queued.id);
  while (!release) await new Promise(r => setImmediate(r)); release(fixtureResponse()); await s.tail; assert.equal(calls, 1);
});
test('network errors and server restart retain uncertain jobs without auto retry', async () => {
  let calls = 0; const s = await service({ fetchImpl: async () => { calls++; throw Error('network private test-only-secret'); } });
  const job = await s.create(input()); await s.tail; assert.equal(s.get(job.id).state, 'interrupted');
  const saved = s.publicJob(s.get(job.id)); saved.state = 'running'; await writeFile(join(s.directory, `${job.id}.json`), JSON.stringify(saved));
  const restarted = await service({ directory: s.directory, fetchImpl: async () => { calls++; return fixtureResponse(); } });
  assert.equal(restarted.get(job.id).state, 'interrupted'); await restarted.tail; assert.equal(calls, 1);
});
test('lyric edits mark stale audio while the original submitted snapshot stays immutable', () => {
  const request = input(), sections = buildComposition(request).sections;
  const version = generatedVersion({ id: randomUUID(), request, sections, provider: 'test', model: 'test', createdAt: '2026-09-26' }, { id: 'asset', duration: 60, sampleRate: 48000 }, 'version');
  assert.equal(lyricsState(version), 'submitted'); version.sections[0].lyrics = '新的歌词'; assert.equal(lyricsState(version), 'changed'); assert.equal(version.lyricsSnapshot.text, request.lyrics);
  assert.equal(lyricsState({ source: 'import' }), 'unlinked'); assert.equal(lyricsState({ source: 'demo' }), 'demo');
});
test('source WAV sample rate survives editing metadata and 24-bit export', () => {
  const mix = { left: new Float32Array(480).fill(.99), right: new Float32Array(480).fill(-.25), duration: .01, sampleRate: 48000 };
  const wav = encodeWav(mix, 0, .01, 24), view = new DataView(wav);
  assert.equal(editingSampleRate(wav), 48000); assert.equal(view.getUint16(34, true), 24); assert.equal(wav.byteLength, 44 + 480 * 6);
  assert.equal(editingSampleRate(encodeWav({ ...mix, sampleRate: 96000, duration: .005 })), 96000);
  assert.equal(editingSampleRate(new ArrayBuffer(5)), 48000);
});
test('ordinary peaks remain intact and actual overload blocks edited export', async () => {
  const v = { duration: 1, tracks: [{ id: 'a', gain: 1 }], effects: [] }, source = new Float32Array(100).fill(.99);
  const mix = renderMix(v, { a: source }, 100); assert.equal(mix.left[0], source[0]); assert.equal(mix.clippedSamples, 0);
  v.tracks[0].gain = 1.8; const clipped = renderMix(v, { a: source }, 100); assert.equal(clipped.clippedSamples, 100);
  const p = Object.create(Player.prototype); p.render = async () => ({ mix: clipped }); await assert.rejects(p.wav(v), /过载/);
});
test('local HTTP server rejects cross-origin generation, rebinding hosts and private files', async t => {
  const s = await service({ apiKey: '' }), server = createServer({ root: fileURLToPath(new URL('../dist', import.meta.url)), service: s, exportDirectory: join(s.directory, 'exports') });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/music/status`)).status, 200);
  const hostStatus=await new Promise((resolve,reject)=>{http.get(`${base}/api/music/status`,{headers:{host:'malicious.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});assert.equal(hostStatus,403);
  assert.equal((await fetch(`${base}/api/generations`, { method: 'POST', headers: { Origin: 'https://malicious.example', 'Content-Type': 'application/json' }, body: JSON.stringify(input()) })).status, 403);
  for (const path of ['/.env', '/.local/generations/file.json', '/server/generation-service.mjs']) assert.equal((await fetch(base + path)).status, 404);
  assert.equal((await fetch(`${base}/api/generations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input()) })).status, 503);
  assert.equal(s.jobs.size, 0);
  const savedResponse = await fetch(`${base}/api/exports?filename=original.mp3`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: mp3Fixture });
  assert.equal(savedResponse.status, 201); const saved = await savedResponse.json();
  assert.deepEqual(await readFile(saved.path), mp3Fixture); assert.ok(saved.path.startsWith(join(s.directory, 'exports')));
  assert.equal((await fetch(`${base}/api/exports?filename=script.exe`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: mp3Fixture })).status, 400);
});
