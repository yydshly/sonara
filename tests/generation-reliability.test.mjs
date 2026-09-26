import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GenerationService } from '../server/generation-service.mjs';

const request = () => ({ projectId: randomUUID(), requestId: randomUUID(), title: '可靠性验证', mode: 'song', language: 'zh', style: 'warm', voice: 'any', duration: 30, lyrics: '[主歌]\n让晚风经过\n[副歌]\n照见真实的我' });
const gate = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
// This is only a transport fixture; it is not playable audio or vocal-quality evidence.
const response = () => new Response(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200)]), { headers: { 'content-type': 'audio/mpeg' } });
async function service(options = {}) { return new GenerationService({ directory: await mkdtemp(join(tmpdir(), 'sonara-reliability-')), apiKey: 'test-only', fetchImpl: async () => response(), ...options }).init(); }
const turn = () => new Promise(resolve => setImmediate(resolve));

test('duplicate submission waits for the first request to reach disk', async () => {
  const s = await service(), blocked = gate(), persist = s.persist.bind(s), input = request();
  let firstWrite = true, accepted = 0;
  s.persist = async job => { if (firstWrite) { firstWrite = false; await blocked.promise; } return persist(job); };
  const first = s.create(input).then(job => { accepted++; return job; });
  const second = s.create(input).then(job => { accepted++; return job; });
  await turn(); assert.equal(accepted, 0);
  blocked.resolve(); const [a, b] = await Promise.all([first, second]);
  assert.equal(a.id, b.id); assert.equal(JSON.parse(await readFile(join(s.directory, `${a.id}.json`))).request.requestId, input.requestId);
  await s.tail; assert.equal(s.pendingCreates.size, 0); assert.equal(s.writes.size, 0);
});

test('failed initial persistence rejects every duplicate and a later retry submits once', async () => {
  let calls = 0; const s = await service({ fetchImpl: async () => { calls++; return response(); } });
  const blocked = gate(), persist = s.persist.bind(s), input = request(); let firstWrite = true;
  s.persist = async job => { if (firstWrite) { firstWrite = false; await blocked.promise; } return persist(job); };
  const results = Promise.allSettled([s.create(input), s.create(input)]);
  blocked.reject(new Error('simulated disk failure'));
  assert.deepEqual((await results).map(result => result.status), ['rejected', 'rejected']);
  assert.equal(s.jobs.size, 0); assert.equal(s.pendingCreates.size, 0); assert.equal(calls, 0);
  const retry = await s.create(input); await s.tail;
  assert.equal(s.get(retry.id).state, 'succeeded'); assert.equal(calls, 1);
});

test('conflicting duplicate is rejected while the original request is still being saved', async () => {
  const s = await service(), blocked = gate(), persist = s.persist.bind(s), input = request(); let firstWrite = true;
  s.persist = async job => { if (firstWrite) { firstWrite = false; await blocked.promise; } return persist(job); };
  const first = s.create(input);
  await assert.rejects(s.create({ ...input, duration: 60 }), error => error.status === 409);
  blocked.resolve(); await first; await s.tail; assert.equal(s.jobs.size, 1);
});

test('late persistence error cannot overwrite a completed cancellation', async () => {
  let calls = 0; const s = await service({ fetchImpl: async () => { calls++; return response(); } });
  const entered = gate(), release = gate(), persist = s.persist.bind(s); let blocked = false;
  s.persist = async job => {
    if (job.state === 'running' && !blocked) { blocked = true; entered.resolve(); await release.promise; throw new Error('simulated running-state write failure'); }
    return persist(job);
  };
  const job = await s.create(request()); await entered.promise;
  await s.cancel(job.id); release.resolve(); await s.tail;
  assert.equal(s.get(job.id).state, 'cancelled'); assert.equal(calls, 0);
  assert.equal(JSON.parse(await readFile(join(s.directory, `${job.id}.json`))).state, 'cancelled');
});

test('provider server errors stay uncertain and retrying the same request never resubmits', async () => {
  let calls = 0; const s = await service({ fetchImpl: async () => { calls++; return new Response('private failure detail', { status: 503 }); } }), input = request();
  const job = await s.create(input); await s.tail;
  assert.equal(s.get(job.id).state, 'interrupted'); assert.match(s.get(job.id).error, /无法确认/);
  assert.equal((await s.create(input)).id, job.id); await s.tail; assert.equal(calls, 1);
  assert.ok(!JSON.stringify(s.get(job.id)).includes('private failure detail'));
});

test('shutdown includes initial saves and prevents a provider call after acceptance', async () => {
  let calls = 0; const s = await service({ fetchImpl: async () => { calls++; return response(); } });
  const blocked = gate(), persist = s.persist.bind(s); let firstWrite = true;
  s.persist = async job => { if (firstWrite) { firstWrite = false; await blocked.promise; } return persist(job); };
  const acceptance = s.create(request()), closing = s.close();
  blocked.resolve(); const job = await acceptance; await closing;
  assert.equal(calls, 0); assert.equal(s.get(job.id).state, 'interrupted');
  assert.equal(JSON.parse(await readFile(join(s.directory, `${job.id}.json`))).state, 'interrupted');
  await assert.rejects(s.create(request()), error => error.status === 503);
});

test('shutdown interrupts all jobs when one job cannot be saved', async () => {
  const started = gate(); let calls = 0;
  const s = await service({ fetchImpl: (_url, options) => { calls++; started.resolve(); return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); } });
  const running = await s.create(request()); await started.promise;
  const queued = await s.create(request()), persist = s.persist.bind(s);
  s.persist = job => s.closed && job.id === running.id ? Promise.reject(new Error('simulated disk failure')) : persist(job);
  await s.close();
  assert.equal(calls, 1); assert.equal(s.get(running.id).state, 'interrupted'); assert.equal(s.get(queued.id).state, 'interrupted');
  assert.equal(JSON.parse(await readFile(join(s.directory, `${queued.id}.json`))).state, 'interrupted');
});
