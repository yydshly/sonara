// Shared by the server and browser; no credentials or network calls.
export const MUSIC_STYLES = {
  warm: { label: '温暖独立流行', tags: ['warm indie pop', 'acoustic piano', 'gentle percussion', 'intimate arrangement', 'melodic', '80 BPM'] },
  bright: { label: '明亮轻快流行', tags: ['upbeat acoustic pop', 'bright guitar', 'rhythmic bass', 'clear drums', 'optimistic', '108 BPM'] },
  cinematic: { label: '舒展电影感', tags: ['cinematic pop', 'expressive piano', 'warm strings', 'gradual dynamic development', 'spacious arrangement', '76 BPM'] }
};
export const VOICES = { female: 'female vocalist with clear expressive delivery', male: 'male vocalist with clear expressive delivery', any: 'expressive vocalist with clear diction' };
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export function validateGeneration(input) {
  if (!input || typeof input !== 'object') throw new Error('缺少生成内容。');
  for (const key of ['projectId', 'requestId']) if (!uuid.test(input[key] || '')) throw new Error('作品或请求编号无效。');
  if (!['song', 'instrumental'].includes(input.mode)) throw new Error('请选择歌曲或纯音乐。');
  if (!['zh', 'en'].includes(input.language)) throw new Error('请选择中文或英文。');
  if (!Object.hasOwn(MUSIC_STYLES, input.style) || !Object.hasOwn(VOICES, input.voice)) throw new Error('声音方向无效。');
  if (![30, 60, 120, 180].includes(input.duration)) throw new Error('请选择支持的作品时长。');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 80) throw new Error('作品名称需要 1–80 个字符。');
  if (typeof input.lyrics !== 'string' || input.lyrics.length > 8000) throw new Error('歌词最多 8000 个字符。');
  const lyrics = input.mode === 'song' ? input.lyrics.trim() : '';
  if (input.mode === 'song' && !lyrics) throw new Error('先填写这次希望唱出的歌词。');
  return { projectId: input.projectId, requestId: input.requestId, title: input.title.trim(), mode: input.mode, language: input.language, style: input.style, voice: input.voice, duration: input.duration, lyrics };
}
const sectionNames = { '主歌': 'Verse', '预副歌': 'Pre-Chorus', '副歌': 'Chorus', '桥段': 'Bridge', '前奏': 'Intro', '尾奏': 'Outro' };
export function parseLyrics(text) {
  const parts = []; let part = { name: '主歌', lyrics: '' };
  for (const line of text.split(/\r?\n/)) {
    const heading = line.trim().match(/^\[([^\]\r\n]{1,40})\]$/);
    if (heading) { if (part.lyrics.trim()) parts.push({ ...part, lyrics: part.lyrics.trim() }); part = { name: heading[1], lyrics: '' }; }
    else part.lyrics += line + '\n';
  }
  if (part.lyrics.trim()) parts.push({ ...part, lyrics: part.lyrics.trim() });
  return parts;
}
export function buildComposition(request, model = 'music_v2_5') {
  const styles = MUSIC_STYLES[request.style].tags;
  if (request.mode === 'instrumental') return { body: { model_id: model, prompt: `${styles.join(', ')}. Instrumental music with a coherent beginning, development and a natural ending.`, music_length_ms: request.duration * 1000, force_instrumental: true }, sections: [{ id: 'instrumental', name: '纯音乐', lyrics: '', start: 0, end: request.duration }] };
  const parts = parseLyrics(request.lyrics);
  if (!parts.length) throw new Error('歌词中还没有可演唱的内容。');
  if (parts.length > 12 || parts.length * 3 > request.duration) throw new Error('段落过多，请合并段落或增加时长。');
  const weights = parts.map(p => Math.max(1, [...p.lyrics.replace(/\s/g, '')].length));
  const total = weights.reduce((a, b) => a + b, 0), remaining = request.duration * 1000 - parts.length * 3000;
  let cursor = 0;
  const sections = parts.map((part, index) => {
    const ms = index === parts.length - 1 ? request.duration * 1000 - cursor : 3000 + Math.floor(remaining * weights[index] / total);
    if (ms > 120000) throw new Error('单个段落超过两分钟，请用 [主歌]、[副歌] 分段。');
    const result = { id: `part-${index + 1}`, name: part.name, lyrics: part.lyrics, start: cursor / 1000, end: (cursor + ms) / 1000 }; cursor += ms; return result;
  });
  return { body: { model_id: model, composition_plan: { chunks: sections.map(s => ({ text: `[${sectionNames[s.name] || s.name}]\n${s.lyrics}`, duration_ms: Math.round((s.end - s.start) * 1000), positive_styles: [...styles, VOICES[request.voice], request.language === 'zh' ? 'Mandarin Chinese vocals' : 'English vocals'], negative_styles: ['spoken narration'], context_adherence: 'high' })) } }, sections };
}
export function projectLyrics(project) {
  if (!project.working) return project.seedLyrics || '';
  return project.working.sections.filter(s => s.lyrics?.trim()).map(s => `[${s.name}]\n${s.lyrics}`).join('\n\n');
}
export function lyricsState(version) {
  if (!version?.lyricsSnapshot) return version?.source === 'demo' ? 'demo' : 'unlinked';
  const text = sections => sections.map(s => (s.lyrics || '').trim()).filter(Boolean).join('\n\n');
  return text(version.sections) === text(version.lyricsSnapshot.sections) ? 'submitted' : 'changed';
}
export const LYRICS_STATUS = {
  demo: '器乐演示没有演唱，歌词尚未生成对应音频。',
  unlinked: '这些歌词尚未与音频建立生成关联；导入音频的唱词需自行核对。',
  submitted: '已保存这段音频生成时提交的歌词。是否唱对仍需试听核对；段落位置为生成计划，非逐字对齐。',
  changed: '歌词已修改，尚未生成对应音频。当前播放仍使用之前的音频，原唱词已保留。'
};
export function generatedVersion(job, asset, id) {
  const sections = structuredClone(job.sections);
  for (const s of sections) { s.start = Math.min(s.start, asset.duration); s.end = Math.min(s.end, asset.duration); }
  const useful = sections.filter(s => s.end > s.start);
  if (useful.length) useful.at(-1).end = asset.duration;
  return { id, name: `${job.request.mode === 'song' ? '演唱' : '纯音乐'} · ${MUSIC_STYLES[job.request.style].label}`, notes: '真实服务返回的音频，音质和内容待试听评估。段落时间来自生成计划。', createdAt: new Date().toISOString(), source: 'generated', mode: job.request.mode, sampleRate: asset.sampleRate, duration: asset.duration, trim: { start: 0, end: asset.duration }, sections: useful, effects: [], tracks: [{ id: `mix-${id}`, assetId: asset.id, name: '生成的完整音频', kind: 'mix', gain: 1, muted: false, solo: false, color: '#cffa83' }], generation: { jobId: job.id, provider: job.provider, model: job.model }, lyricsSnapshot: { text: job.request.lyrics, sections: structuredClone(useful), language: job.request.language, submittedAt: job.createdAt } };
}
