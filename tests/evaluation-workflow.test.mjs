import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvaluations } from '../dist/evaluations.mjs';
import { createProject, clone, uid, makeSnapshot, versionDirty } from '../dist/core.mjs';
import { QUALITY_FIELDS, qualityDecision, evaluationSummary, evaluationLyrics } from '../dist/evaluation-core.mjs';

// Controller-only fixtures: no audio is generated, heard, or written to real browser storage.
function harness(t, options = {}) {
  const descriptors = Object.fromEntries(['document', 'FormData'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const listeners = new Map();
  globalThis.document = { addEventListener: (type, listener) => listeners.set(type, listener), querySelector: () => { throw new Error('Unexpected DOM lookup'); } };
  globalThis.FormData = class {
    constructor(form) { this.fields = new Map(Object.entries(form.fields)); }
    get(key) { return this.fields.get(key) ?? null; }
    has(key) { return this.fields.has(key); }
  };
  t.after(() => { for (const [key, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ cases: [] }), { headers: { 'content-type': 'application/json' } }));

  const project = createProject({ title: '工作流证据测试', language: 'zh', demo: false });
  const initialVersion = {
    id: uid(), name: '候选一', source: options.source || 'generated', mode: options.source === 'import' ? undefined : 'song',
    duration: 12, sampleRate: 48000, trim: { start: 2, end: 10 },
    sections: [{ id: 'verse', name: '主歌', start: 0, end: 12, lyrics: '当前草稿里的歌词' }],
    lyricsSnapshot: { text: '[主歌]\n生成时实际提交的歌词', sections: [{ id: 'verse', name: '主歌', lyrics: '生成时实际提交的歌词' }] },
    generation: { provider: 'Fixture provider', model: 'fixture-model' }, effects: [],
    tracks: [{ id: 'mix', name: '测试素材引用', kind: 'mix', assetId: 'fixture-asset', gain: 1, muted: false, solo: false }]
  };
  project.versions = [clone(initialVersion)];
  project.working = clone(initialVersion);
  project.working.tracks[0].gain = 0.85;
  project.working.trim = { start: 3, end: 11 };
  project.benchmarkCaseId = 'ZH-01';
  const state = { project, projects: [clone(project)], evaluations: [], musicCases: [], page: 'studio', tab: 'lyrics', ab: 'B' };
  const stores = { projects: new Map([[project.id, clone(project)]]), meta: new Map(), assets: new Map([['fixture-asset', { id: 'fixture-asset' }]]) };
  const calls = { modals: [], toasts: [], closed: 0, rendered: 0, stopped: 0, preserved: 0, saved: 0, downloaded: [] };
  const controls = { failPut: null };
  const storage = {
    async get(store, id) { return clone(stores[store].get(id)); },
    async put(store, value) {
      if (controls.failPut?.(store, value)) throw new Error('模拟本机存储失败');
      stores[store].set(value.id, clone(value));
      return value;
    }
  };
  let saveChain = Promise.resolve();
  const player = { offset: 0 };
  const controller = createEvaluations({
    state, storage, player,
    modal: (title, body) => calls.modals.push({ title, body }),
    closeModal: () => { calls.closed++; },
    render: () => { calls.rendered++; },
    toast: message => calls.toasts.push(message),
    stopForChange: () => { calls.stopped++; state.ab = 'B'; },
    preserveDraft: () => { calls.preserved++; if (versionDirty(state.project)) makeSnapshot(state.project, '暂存的调整', '控制器测试中的真实草稿保留逻辑'); },
    save: () => { calls.saved++; const snapshot = clone(state.project); saveChain = saveChain.then(() => storage.put('projects', snapshot)); },
    flush: async () => { await saveChain; },
    download: (blob, name) => calls.downloaded.push({ blob, name })
  });
  const action = (act, data = {}) => controller.action({ dataset: { act, ...data }, isConnected: true, disabled: false });
  const form = (overrides = {}) => {
    const button = { disabled: false, isConnected: true };
    return { fields: { provider: 'Fixture provider', model: 'fixture-model', attempt: '2', minutes: '4.5', cost: '', currency: 'CNY', notes: '第二句发音不清楚，需要重做。', listened: 'on', realAudio: 'on', lyricsChecked: 'on', ...Object.fromEntries(QUALITY_FIELDS.map(field => [`score-${field.key}`, field.key === 'pronunciation' ? '2' : '4'])), ...overrides }, button,
      querySelector(selector) { assert.equal(selector, 'button[type=submit]'); return button; } };
  };
  return { state, stores, storage, controls, calls, player, controller, action, form };
}

test('a low-scored listening record survives persistence, detail, and exact snapshot restore while later edits remain', async t => {
  const h = harness(t);
  const assessed = clone(h.state.project.working);
  await h.action('evaluation-new');
  assert.match(h.calls.modals.at(-1).body, /生成时实际提交的歌词/);
  await h.controller.submit(h.form());
  const persisted = h.stores.meta.get('audio-evaluations').value[0];
  assert.equal(persisted.projectTitle, '工作流证据测试');
  assert.equal(persisted.caseId, 'ZH-01');
  assert.equal(persisted.minutes, 4.5);
  assert.equal(persisted.cost, null);
  assert.deepEqual(persisted.versionSnapshot, assessed);
  assert.equal(qualityDecision(persisted).passed, false);
  assert.deepEqual(evaluationSummary([persisted]), { total: 1, passed: 0, chinese: 0, english: 0 });

  h.state.evaluations = [];
  await h.controller.load();
  assert.deepEqual(h.state.evaluations, [persisted]);
  await h.action('evaluation-detail', { record: persisted.id });
  assert.match(h.calls.modals.at(-1).body, /工作流证据测试/);
  assert.match(h.calls.modals.at(-1).body, /生成时实际提交的歌词/);
  assert.match(h.calls.modals.at(-1).body, /仍需打磨/);
  const immutableEvidence = JSON.stringify(h.state.evaluations);
  h.state.project.working.tracks[0].gain = 0.2;
  h.state.project.working.sections[0].lyrics = '评测后继续写下的新歌词';
  h.state.project.working.trim = { start: 0, end: 12 };
  await h.action('evaluation-restore', { record: persisted.id });

  assert.deepEqual(h.state.project.working.tracks, assessed.tracks);
  assert.deepEqual(h.state.project.working.trim, assessed.trim);
  assert.deepEqual(h.state.project.working.sections, assessed.sections);
  assert.equal(evaluationLyrics(h.state.project.working), evaluationLyrics(assessed));
  assert.ok(h.state.project.versions.some(v => v.tracks[0].gain === 0.2 && v.sections[0].lyrics === '评测后继续写下的新歌词'));
  assert.equal(h.player.offset, 3);
  assert.equal(h.state.ab, 'B');
  assert.equal(h.state.page, 'studio');
  assert.equal(h.stores.meta.get('last-project').value, h.state.project.id);
  assert.deepEqual(h.stores.projects.get(h.state.project.id).working, h.state.project.working);
  assert.equal(JSON.stringify(h.state.evaluations), immutableEvidence);
  assert.equal(qualityDecision(h.state.evaluations[0]).passed, false);
});

test('failed record storage leaves the form retryable and never claims the evaluation was saved', async t => {
  const h = harness(t), form = h.form();
  await h.action('evaluation-new');
  h.controls.failPut = (store, value) => store === 'meta' && value.id === 'audio-evaluations';
  await assert.rejects(h.controller.submit(form), /存储失败/);
  assert.equal(h.state.evaluations.length, 0);
  assert.equal(h.stores.meta.has('audio-evaluations'), false);
  assert.deepEqual(h.calls.toasts, []);
  assert.equal(h.calls.closed, 0);
  assert.equal(h.calls.rendered, 0);
  assert.equal(form.button.disabled, false);
  h.controls.failPut = null;
  await h.controller.submit(form);
  assert.equal(h.state.evaluations.length, 1);
  assert.equal(h.stores.meta.get('audio-evaluations').value.length, 1);
  assert.equal(h.calls.closed, 1);
});

test('a missing snapshot asset cannot switch away from the current project or alter either project', async t => {
  const h = harness(t);
  await h.action('evaluation-new');
  await h.controller.submit(h.form());
  const record = h.state.evaluations[0];
  const other = createProject({ title: '仍在创作的另一个项目', demo: false });
  h.state.project = other;
  const beforeCurrent = clone(other), beforeSaved = clone(h.stores.projects.get(record.projectId));
  h.stores.assets.delete('fixture-asset');
  const previousToastCount = h.calls.toasts.length, previousCloseCount = h.calls.closed;
  await assert.rejects(h.action('evaluation-restore', { record: record.id }), /音频素材/);
  assert.equal(h.state.project, other);
  assert.deepEqual(h.state.project, beforeCurrent);
  assert.deepEqual(h.stores.projects.get(record.projectId), beforeSaved);
  assert.equal(h.calls.stopped, 0);
  assert.equal(h.calls.preserved, 0);
  assert.equal(h.calls.saved, 0);
  assert.equal(h.calls.toasts.length, previousToastCount);
  assert.equal(h.calls.closed, previousCloseCount);
});

test('listening to baseline A cannot open a form that silently rates current B', async t => {
  const h = harness(t);
  h.state.ab = 'A';
  await assert.rejects(h.action('evaluation-new'), /A 基准/);
  assert.equal(h.calls.modals.length, 0);
  await h.controller.submit(h.form());
  assert.equal(h.state.evaluations.length, 0);
  assert.equal(h.stores.meta.has('audio-evaluations'), false);
  h.state.ab = 'B';
  await h.action('evaluation-new');
  assert.equal(h.calls.modals.length, 1);
});

test('an imported instrumental uses its selected mode and only music and fidelity scores', async t => {
  const h = harness(t, { source: 'import' });
  await h.action('evaluation-new');
  const form = h.form({ mode: 'instrumental', 'score-musicality': '5', 'score-fidelity': '4' });
  delete form.fields.lyricsChecked;
  for (const field of ['lyrics', 'pronunciation', 'phrasing', 'vocal']) delete form.fields[`score-${field}`];
  await h.controller.submit(form);
  const record = h.state.evaluations[0];
  assert.equal(record.mode, 'instrumental');
  assert.deepEqual(record.scores, { musicality: 5, fidelity: 4 });
  assert.equal(record.lyricsChecked, false);
  assert.equal(qualityDecision(record).passed, true);
  assert.deepEqual(evaluationSummary([record]), { total: 1, passed: 1, chinese: 0, english: 0 });
});
