import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { QUALITY_FIELDS, qualityFields, evaluationLyrics, validateEvaluation, qualityDecision, evaluationSummary } from '../dist/evaluation-core.mjs';

const version = (overrides = {}) => ({ id: 'audio-version', source: 'generated', mode: 'song', name: '真实候选', duration: 60, sections: [{ id: 'verse', lyrics: '让晚风经过' }], tracks: [{ id: 'mix', assetId: 'actual-audio', gain: 1 }], generation: { provider: 'Test provider', model: 'test-model' }, ...overrides });
const record = (overrides = {}) => ({ projectId: 'project', versionId: 'audio-version', language: 'zh', provider: 'Test provider', scores: Object.fromEntries(QUALITY_FIELDS.map(field => [field.key, 4])), listened: true, lyricsChecked: true, realAudio: true, ...overrides });

test('demo and unlistened audio cannot become a saved listening evaluation', () => {
  assert.throws(() => validateEvaluation(record({ source: 'generated' }), version({ source: 'demo' })), /器乐演示/);
  assert.throws(() => validateEvaluation(record({ listened: false }), version()), /完整试听/);
  assert.throws(() => validateEvaluation(record({ listened: 'true' }), version()), /完整试听/);
  assert.throws(() => validateEvaluation(record({ realAudio: false }), version()), /真实创作音频/);
  assert.throws(() => validateEvaluation(record({ realAudio: 1 }), version()), /真实创作音频/);
});

test('scores, attempts, time and price reject strings, coercion and non-finite values', () => {
  for (const score of ['4', true, null, 0, 6, 4.5, NaN, Infinity]) assert.throws(() => validateEvaluation(record({ scores: { ...record().scores, lyrics: score } }), version()));
  for (const attempt of ['1', false, null, 0, 4, 1.5, NaN, Infinity]) assert.throws(() => validateEvaluation(record({ attempt }), version()));
  for (const minutes of ['5', false, null, -1, NaN, Infinity]) assert.throws(() => validateEvaluation(record({ minutes }), version()));
  for (const cost of ['', '0', false, -1, NaN, Infinity]) assert.throws(() => validateEvaluation(record({ cost }), version()));
  const free = validateEvaluation(record({ cost: 0, minutes: 0, attempt: 3 }), version());
  assert.equal(free.cost, 0);
  assert.equal(validateEvaluation(record(), version()).cost, null);
});

test('version evidence is independent, immutable, and cannot be supplied by the caller', () => {
  const current = version(), saved = validateEvaluation(record({ source: 'import', versionSnapshot: { id: 'forged' } }), current);
  current.sections[0].lyrics = '后来修改的歌词';
  current.tracks[0].gain = 0.5;
  assert.equal(saved.versionSnapshot.sections[0].lyrics, '让晚风经过');
  assert.equal(saved.versionSnapshot.tracks[0].gain, 1);
  assert.equal(saved.source, 'generated');
  assert.equal(saved.versionSnapshot.id, current.id);
  assert.ok(Object.isFrozen(saved.versionSnapshot.sections[0]));
  assert.throws(() => { saved.versionSnapshot.tracks[0].gain = 2; }, TypeError);
  assert.throws(() => validateEvaluation(record({ versionId: 'different-version' }), current), /版本/);
});

test('poor audio and unconfirmed lyrics are retained without being counted as a pass', () => {
  const weak = validateEvaluation(record({ scores: { ...record().scores, vocal: 2 }, notes: '高音刺耳，下一轮减少力度。' }), version());
  assert.equal(qualityDecision(weak).passed, false);
  assert.match(qualityDecision(weak).reason, /人声表现/);
  assert.equal(weak.notes, '高音刺耳，下一轮减少力度。');
  const unchecked = validateEvaluation(record({ lyricsChecked: false }), version());
  assert.equal(qualityDecision(unchecked).label, '待核对歌词');
  assert.equal(qualityDecision(unchecked).passed, false);
});

test('lyric evidence uses the generated original or the imported current reference consistently', () => {
  const current = version({ lyricsSnapshot: { text: '[主歌]\n实际提交的歌词' }, sections: [{ name: '主歌', lyrics: '后来修改的歌词' }] });
  assert.equal(evaluationLyrics(current), '[主歌]\n实际提交的歌词');
  assert.equal(evaluationLyrics({ ...current, source: 'import' }), '[主歌]\n后来修改的歌词');
  assert.equal(evaluationLyrics(null), '');
  assert.equal(evaluationLyrics(version({ sections: [{ name: '前奏', lyrics: '  ' }] })), '');
});

test('missing or heading-only reference lyrics cannot be confirmed but low-scored unconfirmed results remain saveable', () => {
  for (const candidate of [version({ sections: [] }), version({ sections: [{ name: '主歌', lyrics: '[Verse]\n\n[Chorus]' }] }), version({ lyricsSnapshot: { text: '[主歌]\n\n[副歌]' } })]) {
    assert.throws(() => validateEvaluation(record(), candidate), /参考歌词/);
    const unchecked = validateEvaluation(record({ lyricsChecked: false, scores: { ...record().scores, lyrics: 1 } }), candidate);
    assert.equal(qualityDecision(unchecked).passed, false);
    assert.equal(unchecked.scores.lyrics, 1);
  }
  const previousRecord = validateEvaluation(record(), version());
  const missingReference = { ...previousRecord, versionSnapshot: version({ sections: [] }) };
  assert.equal(qualityDecision(missingReference).passed, false);
  assert.equal(qualityDecision(missingReference).label, '待补参考歌词');
});

test('instrumental evaluations score music and audio quality without pretending to verify vocals', () => {
  assert.deepEqual(qualityFields('instrumental').map(field => field.key), ['musicality', 'fidelity']);
  const instrumental = validateEvaluation(record({ mode: 'instrumental', lyricsChecked: false, scores: { musicality: 5, fidelity: 4 } }), version({ mode: 'instrumental' }));
  assert.equal(qualityDecision(instrumental).passed, true);
  assert.equal(instrumental.scores.vocal, undefined);
  assert.throws(() => validateEvaluation(record({ mode: 'instrumental' }), version()), /类型/);
  assert.throws(() => validateEvaluation(record(), version({ mode: 'instrumental' })), /类型/);
  assert.equal(validateEvaluation(record({ mode: 'instrumental' }), version({ source: 'import', mode: undefined })).mode, 'instrumental');
});

test('language counts include passed songs only; every failed attempt remains visible', () => {
  const saved = overrides => validateEvaluation(record(overrides), version(overrides?.mode ? { mode: overrides.mode } : {}));
  const cases = [saved(), saved({ language: 'en' }), saved({ language: 'zh', scores: { ...record().scores, lyrics: 2 } }), saved({ language: 'en', lyricsChecked: false }), saved({ mode: 'instrumental' })];
  assert.deepEqual(evaluationSummary(cases), { total: 5, passed: 3, chinese: 1, english: 1 });
  assert.deepEqual(evaluationSummary([]), { total: 0, passed: 0, chinese: 0, english: 0 });
});

test('decision cannot grant a pass to incomplete or mismatched stored evidence', () => {
  const saved = validateEvaluation(record(), version());
  for (const broken of [{}, { ...saved, listened: false }, { ...saved, source: 'demo' }, { ...saved, versionSnapshot: null }, { ...saved, versionId: 'elsewhere' }, { ...saved, scores: { lyrics: 5 } }, { ...saved, mode: 'instrumental' }]) assert.equal(qualityDecision(broken).passed, false);
  assert.equal(qualityDecision(saved).passed, true);
});

test('required provenance and user text have bounded fields and useful defaults', () => {
  for (const invalid of [{ provider: '' }, { provider: 'x'.repeat(81) }, { model: 'x'.repeat(81) }, { notes: 'x'.repeat(5001) }, { currency: 'EUR' }, { language: 'de' }, { createdAt: 'invalid date' }, { projectId: '' }, { projectTitle: 'x'.repeat(81) }, { lyricsChecked: 'true' }]) assert.throws(() => validateEvaluation(record(invalid), version()));
  const saved = validateEvaluation(record({ provider: '  Test provider  ', projectTitle: '  晚风来信  ' }), version());
  assert.ok(saved.id);
  assert.ok(Number.isFinite(Date.parse(saved.createdAt)));
  assert.equal(saved.provider, 'Test provider');
  assert.equal(saved.projectTitle, '晚风来信');
  assert.equal(validateEvaluation(record(), version()).projectTitle, '');
  assert.equal(saved.mode, 'song');
  assert.equal(saved.attempt, 1);
  assert.equal(saved.minutes, 0);
  assert.equal(saved.currency, 'CNY');
  assert.equal(saved.model, '');
  assert.equal(saved.notes, '');
  assert.equal(saved.caseId, null);
});

test('public benchmark fixtures stay identical to the authored unrun source cases', async () => {
  const source = await readFile(new URL('../evaluation/music-cases.json', import.meta.url), 'utf8');
  const published = await readFile(new URL('../dist/music-cases.json', import.meta.url), 'utf8');
  assert.equal(published, source);
  const fixture = JSON.parse(published);
  assert.equal(fixture.status, 'not_run');
  assert.equal(fixture.results.length, 0);
  assert.equal(fixture.cases.filter(item => item.language === 'zh').length, 4);
  assert.equal(fixture.cases.filter(item => item.language === 'en').length, 4);
});
