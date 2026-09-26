// Manual listening evidence only. These decisions do not certify a provider or market demand.
export const QUALITY_FIELDS = Object.freeze([
  { key: 'lyrics', label: '歌词准确' },
  { key: 'pronunciation', label: '发音咬字' },
  { key: 'phrasing', label: '节奏断句' },
  { key: 'musicality', label: '旋律编曲' },
  { key: 'vocal', label: '人声表现' },
  { key: 'fidelity', label: '音频质量' }
].map(Object.freeze));
const INSTRUMENTAL_FIELDS = Object.freeze(QUALITY_FIELDS.filter(field => ['musicality', 'fidelity'].includes(field.key)));
const SOURCES = ['generated', 'import'];

export function qualityFields(mode = 'song') {
  if (!['song', 'instrumental'].includes(mode)) throw new Error('请选择歌词演唱或纯音乐评测。');
  return mode === 'instrumental' ? INSTRUMENTAL_FIELDS : QUALITY_FIELDS;
}

export function evaluationLyrics(version) {
  if (version?.source === 'generated' && typeof version.lyricsSnapshot?.text === 'string') return version.lyricsSnapshot.text.trim();
  return (version?.sections || []).filter(section => typeof section.lyrics === 'string' && section.lyrics.trim()).map(section => `${section.name ? `[${section.name}]\n` : ''}${section.lyrics.trim()}`).join('\n\n');
}
function hasLyrics(version) {
  return evaluationLyrics(version).split(/\r?\n/).some(line => line.trim() && !/^\[[^\]\r\n]*\]$/.test(line.trim()));
}

function text(value, label, limit, required = false) {
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw new Error(`${label}${required ? '不能为空，且' : ''}最多 ${limit} 个字符。`);
  return value.trim();
}
function finiteNumber(value, label, minimum = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) throw new Error(`${label}需要填写不小于 ${minimum} 的有效数字。`);
  return value;
}
function freezeSnapshot(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeSnapshot(child, seen);
  return Object.freeze(value);
}

export function validateEvaluation(record, version) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('缺少试听评测内容。');
  if (!version || !SOURCES.includes(version.source)) throw new Error('请选择实际生成或导入的音频；器乐演示不能作为真实音频评测。');
  const mode = record.mode ?? 'song', fields = qualityFields(mode);
  if (version.source === 'generated' && version.mode && version.mode !== mode) throw new Error('评测类型需要与生成音频的类型一致。');
  const versionId = text(record.versionId, '音频版本编号', 200, true);
  if (versionId !== version.id) throw new Error('评测版本与当前音频不一致，请重新选择。');
  if (record.listened !== true) throw new Error('请完整试听音频后再保存评测。');
  if (record.realAudio !== true) throw new Error('请确认这是真实创作音频，不是测试音或器乐演示。');
  const lyricsChecked = record.lyricsChecked ?? false;
  if (typeof lyricsChecked !== 'boolean') throw new Error('歌词核对状态无效。');
  if (mode === 'song' && lyricsChecked && !hasLyrics(version)) throw new Error('还没有可核对的参考歌词，请先补充歌词，或取消已核对状态后保存。');
  if (!['zh', 'en'].includes(record.language)) throw new Error('请选择中文或英文。');
  if (!record.scores || typeof record.scores !== 'object' || Array.isArray(record.scores)) throw new Error('请为各项试听表现评分。');
  const scores = {};
  for (const { key, label } of fields) {
    const score = record.scores[key];
    if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error(`${label}需要选择 1–5 分。`);
    scores[key] = score;
  }
  const attempt = finiteNumber(record.attempt === undefined ? 1 : record.attempt, '尝试次数', 1);
  if (!Number.isInteger(attempt) || attempt > 3) throw new Error('尝试次数需要是 1–3 的整数。');
  const minutes = finiteNumber(record.minutes === undefined ? 0 : record.minutes, '处理用时');
  const cost = record.cost == null ? null : finiteNumber(record.cost, '处理费用');
  const currency = record.currency ?? 'CNY';
  if (!['CNY', 'USD'].includes(currency)) throw new Error('费用币种需要选择人民币或美元。');
  const createdAt = record.createdAt ?? new Date().toISOString();
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) throw new Error('评测时间无效。');
  let versionSnapshot;
  try { versionSnapshot = freezeSnapshot(structuredClone(version)); }
  catch { throw new Error('无法保存音频版本证据，请重新打开作品后再试。'); }
  return {
    id: text(record.id ?? crypto.randomUUID(), '评测编号', 200, true),
    projectId: text(record.projectId, '作品编号', 200, true),
    projectTitle: text(record.projectTitle ?? '', '作品名称', 80),
    versionId,
    versionSnapshot,
    source: version.source,
    createdAt: new Date(createdAt).toISOString(),
    caseId: record.caseId == null || record.caseId === '' ? null : text(record.caseId, '评测样例编号', 80, true),
    language: record.language,
    mode,
    provider: text(record.provider, '制作来源', 80, true),
    model: text(record.model ?? '', '使用模型', 80),
    attempt, minutes, cost, currency, scores,
    notes: text(record.notes ?? '', '试听记录', 5000),
    listened: true, lyricsChecked, realAudio: true
  };
}

export function qualityDecision(record) {
  const mode = record?.mode ?? 'song';
  if (!record || !['song', 'instrumental'].includes(mode) || record.listened !== true || record.realAudio !== true || !SOURCES.includes(record.source) || record.versionSnapshot?.source !== record.source || record.versionSnapshot?.id !== record.versionId) {
    return { passed: false, label: '评测未完成', reason: '需要真实音频、完整试听和对应版本的评测证据。' };
  }
  if (record.source === 'generated' && record.versionSnapshot.mode && record.versionSnapshot.mode !== mode) return { passed: false, label: '评测未完成', reason: '评测类型与音频版本不一致。' };
  const fields = qualityFields(mode);
  if (fields.some(({ key }) => !Number.isInteger(record.scores?.[key]) || record.scores[key] < 1 || record.scores[key] > 5)) return { passed: false, label: '评测未完成', reason: '请完整记录各项试听评分。' };
  if (mode === 'song' && record.lyricsChecked !== true) return { passed: false, label: '待核对歌词', reason: '尚未逐句核对实际唱词，暂不计为通过。' };
  if (mode === 'song' && !hasLyrics(record.versionSnapshot)) return { passed: false, label: '待补参考歌词', reason: '评测快照没有可核对的参考歌词，暂不计为通过。' };
  const needsWork = fields.filter(({ key }) => record.scores[key] < 4).map(field => field.label);
  if (needsWork.length) return { passed: false, label: '仍需打磨', reason: `${needsWork.join('、')}低于 4 分，保留这次结果作为修改依据。` };
  return { passed: true, label: '本次试听通过', reason: mode === 'song' ? '已核对唱词，各项评分均达到 4 分；仅代表这次人工试听结果。' : '旋律编曲与音频质量均达到 4 分；仅代表这次纯音乐人工试听结果。' };
}

export function evaluationSummary(records = []) {
  const summary = { total: 0, passed: 0, chinese: 0, english: 0 };
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    summary.total++;
    if (!qualityDecision(record).passed) continue;
    summary.passed++;
    if ((record.mode ?? 'song') === 'song') {
      if (record.language === 'zh') summary.chinese++;
      if (record.language === 'en') summary.english++;
    }
  }
  return summary;
}
