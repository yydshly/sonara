import { esc, uid, clone, MAX_SECONDS } from './core.mjs';
import { MUSIC_STYLES, validateGeneration, buildComposition, projectLyrics, generatedVersion } from './generation-core.mjs';
const labels = { queued: '等待处理', running: '正在生成音频', succeeded: '音频已返回 · 待试听', failed: '生成未完成', interrupted: '结果未确认', cancelled: '已取消等待' };
export function generationBanner(state) {
  const connected = state.musicService?.configured;
  const jobs = state.jobsProject === state.project.id ? state.generationJobs || [] : [];
  return `<section class="generation-banner" id="generation-status" aria-label="歌曲生成状态"><div class="flex between"><div><span class="badge ${connected ? 'lime' : 'amber'}">${connected ? '在线整曲 · 待音质评测' : '在线整曲 · 等待连接'}</span><p>${esc(state.musicService?.message || '正在检查本机生成服务…')}</p></div><div class="flex"><button class="btn compact" data-act="generation-open">${connected ? '生成演唱 / 纯音乐' : '准备歌词与声音'}</button><button class="btn quiet compact" data-act="generation-connection">连接状态</button></div></div>${jobs.slice(0, 3).map(j => `<div class="generation-job"><div><strong>${esc(labels[j.state] || j.state)}</strong><span class="small muted"> · ${j.request.duration} 秒 · ${esc(MUSIC_STYLES[j.request.style]?.label || '')}</span>${j.error ? `<p class="small">${esc(j.error)}</p>` : ''}</div><div class="flex">${j.state === 'succeeded' ? `<button class="btn compact" data-act="generation-result" data-job="${j.id}">查看结果</button>` : ['queued', 'running'].includes(j.state) ? `<button class="btn quiet compact" data-act="generation-cancel" data-job="${j.id}">停止等待</button>` : ''}</div></div>`).join('')}${jobs.length > 3 ? '<button class="btn quiet compact" data-act="generation-history">查看全部生成记录</button>' : ''}</section>`;
}
export function createGenerations({ state, player, storage, modal, closeModal, save, flush, render, stopForChange, preserveDraft, toast, download }) {
  state.musicService ||= { configured: false, message: '正在检查本机生成服务…' };
  let polling, refreshing = null, stopped = false, submitted = false, openRequest = null;
  const $ = selector => document.querySelector(selector);
  async function api(path, options = {}) {
    let response;
    try { response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(20000) }); }
    catch { throw new Error('未能确认本机服务是否收到请求。已保留请求编号，重试会查询同一次任务。'); }
    let value; try { value = await response.json(); } catch { throw new Error('本机生成服务尚未启动，请重新启动工作台。'); }
    if (!response.ok) throw new Error(value.error || '本机服务暂时不可用。');
    return value;
  }
  function updateBanner() { const target = $('#generation-status'); if (target) target.outerHTML = generationBanner(state); }
  async function refresh() {
    if (!state.project) return;
    if (refreshing) { await refreshing; if (state.jobsProject !== state.project.id) return refresh(); return; }
    const projectId = state.project.id;
    refreshing = (async () => {
      try {
        const [status, jobs] = await Promise.all([api('/api/music/status'), api(`/api/generations?projectId=${encodeURIComponent(projectId)}`)]);
        state.musicService = status;
        if (state.project.id === projectId) { state.generationJobs = jobs; state.jobsProject = projectId; }
      } catch { state.musicService = { configured: false, message: '本机生成服务无法连接，请检查工作台是否已重新启动。' }; }
      finally { updateBanner(); }
    })();
    try { await refreshing; } finally { refreshing = null; }
  }
  async function poll() { if (stopped) return; await refresh(); polling = setTimeout(poll, state.generationJobs?.some(j => ['queued', 'running'].includes(j.state)) ? 3000 : 15000); }
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(polling); });
  async function open() {
    await refresh();
    const p = state.project, pending = await storage.get('meta', `generation-pending:${p.id}`);
    openRequest = pending?.value || null;
    const d = clone(openRequest || p.generationDraft || { mode: 'song', style: 'warm', voice: 'any', duration: 60, lyrics: projectLyrics(p) });
    if (!openRequest && p.generationDraft && p.generationDraft.baseLyrics !== projectLyrics(p)) d.lyrics = projectLyrics(p);
    submitted = false;
    const locked = openRequest ? 'disabled' : '';
    modal('让歌词有真实的声音', `<form id="generation-form"><div class="dialog-body"><div class="notice">${esc(state.musicService.message)}${openRequest ? '<br>上次提交尚未确认。下方保留原请求内容，点击确认会复用同一编号，避免重复生成。' : ''}</div><div class="form-grid"><label>这次想做什么<select name="mode" id="generation-mode" ${locked}><option value="song" ${d.mode === 'song' ? 'selected' : ''}>按歌词生成演唱</option><option value="instrumental" ${d.mode === 'instrumental' ? 'selected' : ''}>生成纯音乐（无歌词）</option></select></label><label>时长<select name="duration" ${locked}>${[[30, '30 秒 · 方向短样'], [60, '1 分钟 · 短篇作品'], [120, '2 分钟 · 完整作品'], [180, '3 分钟 · 完整作品']].map(([n, label]) => `<option value="${n}" ${Number(d.duration) === n ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>声音方向<select name="style" ${locked}>${Object.entries(MUSIC_STYLES).map(([key, value]) => `<option value="${key}" ${d.style === key ? 'selected' : ''}>${value.label}</option>`).join('')}</select></label><label id="generation-voice">人声感觉<select name="voice" ${locked}>${[['any', '让作品决定'], ['female', '清晰有表现力的女声'], ['male', '清晰有表现力的男声']].map(([key, label]) => `<option value="${key}" ${d.voice === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><label id="generation-lyrics">本次提交的歌词 · ${p.language === 'en' ? 'English' : '中文'}<textarea name="lyrics" rows="9" maxlength="8000" ${locked} placeholder="可以用 [主歌]、[副歌] 或 [Verse]、[Chorus] 分段。短样请使用少量歌词。">${esc(d.lyrics || '')}</textarea></label><p>仅提交上方确认的歌词与所选声音方向。项目里的故事保留作创作参考。每次生成都是新的候选，暂不保证沿用现有旋律或音色。</p><p>生成会把上述内容发送到 ElevenLabs，并按你的服务账户计费。未连接时只保存准备内容。没有自动重试。</p><div class="form-error" id="form-error" role="alert"></div></div><div class="dialog-footer">${!openRequest ? '<button type="button" class="btn quiet" data-act="generation-save">只保存准备内容</button>' : ''}<button class="btn primary" id="generation-submit" ${!state.musicService.configured ? 'disabled' : ''}>${openRequest ? '确认上次请求' : '提交生成 · 保留原版'}</button></div></form>`);
    modeChanged();
  }
  function modeChanged() { const mode = openRequest?.mode || $('#generation-mode')?.value; if ($('#generation-lyrics')) $('#generation-lyrics').hidden = mode === 'instrumental'; if ($('#generation-voice')) $('#generation-voice').hidden = mode === 'instrumental'; }
  function formValues() { const data = new FormData($('#generation-form')); return { mode: String(data.get('mode')), duration: Number(data.get('duration')), style: String(data.get('style')), voice: String(data.get('voice')), lyrics: String(data.get('lyrics') || '') }; }
  async function submit() {
    if (submitted) return;
    const p = state.project;
    const request = openRequest || validateGeneration({ ...formValues(), projectId: p.id, requestId: uid(), title: p.title, language: p.language });
    buildComposition(request);
    submitted = true; const button = $('#generation-submit'); button.disabled = true; button.textContent = '正在确认任务…';
    try {
      p.generationDraft = { ...request, baseLyrics: projectLyrics(p) }; save(); await flush();
      await storage.put('meta', { id: `generation-pending:${p.id}`, value: request });
      openRequest = request;
      const job = await api('/api/generations', { method: 'POST', body: JSON.stringify(request) });
      await storage.put('meta', { id: `generation-pending:${p.id}`, value: null });
      openRequest = null;
      if (state.project === p) { closeModal(); await refresh(); render(); toast(labels[job.state] || '生成任务已保存。'); }
    } finally { submitted = false; if (button.isConnected) { button.disabled = !state.musicService.configured; button.textContent = openRequest ? '确认同一次请求' : '提交生成 · 保留原版'; } }
  }
  async function result(id) {
    const job = await api(`/api/generations/${id}`);
    if (job.request.projectId !== state.project.id) throw new Error('这个结果属于另一个作品。');
    const added = state.project.versions.some(v => v.generation?.jobId === job.id);
    modal('试听这次生成', `<div class="dialog-body"><span class="badge lime">${esc(labels[job.state])}</span><p>生成服务：${esc(job.provider)} · ${esc(job.model)}。收到音频不代表作品已通过质量评测，请核对歌词、发音和整体效果。</p>${job.state === 'succeeded' ? `<audio controls preload="metadata" src="/api/generations/${job.id}/audio" aria-label="生成的音频试听"></audio><button class="btn primary" data-act="generation-import" data-job="${job.id}" ${added ? 'disabled' : ''}>${added ? '已加入作品，版本记录中可找回' : '加入作品 · 保留现有版本'}</button><a class="btn" href="/api/generations/${job.id}/audio" download="${job.id}.mp3">下载服务返回的原始 MP3</a>` : `<p>${esc(job.error || '')}</p>`}<details><summary>这次提交的歌词与声音方向</summary><p>${esc(MUSIC_STYLES[job.request.style].label)} · ${job.request.duration} 秒</p><pre class="submitted-lyrics">${esc(job.request.lyrics || '纯音乐：没有提交歌词。')}</pre></details><div class="form-error" id="form-error" role="alert"></div></div>`);
  }
  async function importResult(el) {
    el.disabled = true;
    const p = state.project;
    try {
      const job = await api(`/api/generations/${el.dataset.job}`);
      if (job.request.projectId !== p.id || job.state !== 'succeeded') throw new Error('这次音频还不能加入当前作品。');
      if (p.versions.some(v => v.generation?.jobId === job.id)) throw new Error('这个结果已在版本记录中。');
      const response = await fetch(`/api/generations/${job.id}/audio`); if (!response.ok) throw new Error('音频读取失败，请稍后重试。');
      const file = new File([await response.blob()], `${job.request.title}-${job.id}.mp3`, { type: 'audio/mpeg' });
      const asset = { id: uid(), name: file.name, ...await player.decode(file) };
      if (asset.duration > MAX_SECONDS) throw new Error('音频超过当前作品时长限制。');
      await storage.put('assets', asset);
      if (state.project !== p) { toast('已保留生成结果，请回到原作品中加入。'); return; }
      stopForChange(); preserveDraft(); const oldId = p.working?.id;
      const version = generatedVersion(job, asset, uid()); p.working = version; p.versions.push(clone(version)); p.compareId = oldId || version.id; p.stage = 3;
      state.tab = job.request.mode === 'instrumental' ? 'stems' : 'lyrics'; save(); await flush(); closeModal(); render(); toast('真实音频已加入，原版本与生成时的歌词均已保留。');
    } finally { if (el.isConnected) el.disabled = false; }
  }
  async function action(el) {
    if (el.dataset.act === 'generation-open') return open();
    if (el.dataset.act === 'generation-connection') { await refresh(); return modal('音乐生成连接', `<div class="dialog-body"><span class="badge ${state.musicService.configured ? 'lime' : 'amber'}">${state.musicService.configured ? '已配置 · 尚待实测' : '尚未连接'}</span><p>${esc(state.musicService.message)}</p><p>当前提供 ElevenLabs 音乐接口作为首个候选。它尚未通过中英文音质评测，后续可以替换。</p><p>在本机 sonara 文件夹中，将 .env.example 复制为 .env，填入 ELEVENLABS_API_KEY 后重新启动工作台。密钥只由本机服务读取。</p><p>未点击提交前不会向音乐服务发送内容。生成记录与返回的原始音频保存在本机服务目录；加入作品后也会保存在此浏览器。</p><button class="btn" data-act="generation-open">准备生成内容</button></div>`); }
    if (el.dataset.act === 'generation-save') { state.project.generationDraft = { ...formValues(), baseLyrics: projectLyrics(state.project) }; save(); await flush(); closeModal(); toast('生成准备已保存到这个作品，尚未发送。'); }
    if (el.dataset.act === 'generation-result') return result(el.dataset.job);
    if (el.dataset.act === 'generation-import') return importResult(el);
    if (el.dataset.act === 'generation-cancel') { await api(`/api/generations/${el.dataset.job}/cancel`, { method: 'POST', body: '{}' }); await refresh(); }
    if (el.dataset.act === 'generation-history') { await refresh(); modal('生成记录', `<div class="dialog-body">${state.generationJobs.map(j => `<button class="project-item" data-act="generation-result" data-job="${j.id}"><span>${esc(j.request.title)} · ${esc(labels[j.state])}</span></button>`).join('')}</div>`); }
    if (el.dataset.act === 'generation-lyrics-snapshot') { const snapshot = state.project.working?.lyricsSnapshot; if (snapshot) modal('生成时提交的歌词', `<div class="dialog-body"><p>这份文字随音频版本保留，不会被后续草稿覆盖。是否实际唱对需要试听核对。</p><pre class="submitted-lyrics">${esc(snapshot.text || '纯音乐：未提交歌词。')}</pre><button class="btn" data-act="generation-open">用当前草稿重新生成</button></div>`); }
    if (['download-original', 'generation-save-original', 'generation-save-wav'].includes(el.dataset.act)) {
      el.disabled = true;
      try {
        const p = state.project, v = p.working; let blob, name;
        if (el.dataset.act === 'generation-save-wav') { blob = await player.wav(clone(v)); name = `${p.title}-${v.name}.wav`; }
        else {
          for (const t of v.tracks) if (t.assetId) { const asset = await storage.get('assets', t.assetId); if (asset?.originalBlob) { blob = asset.originalBlob; name = asset.originalName || asset.name; break; } }
          if (!blob) throw new Error('旧版导入没有保存原始文件，请重新导入以保留原文件。');
        }
        if (el.dataset.act === 'download-original') return download(blob, name);
        const response = await fetch(`/api/exports?filename=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
        const saved = await response.json(); if (!response.ok) throw new Error(saved.error || '保存失败，请重试。');
        modal('音频已保存到本机', `<div class="dialog-body"><span class="badge lime">已写入磁盘 · ${(saved.bytes / 1024 / 1024).toFixed(2)} MB</span><p>文件保存在运行工作台的这台电脑，可复制下方路径找到音频。</p><label>文件位置<input readonly value="${esc(saved.path)}" aria-label="已保存的音频位置"></label><p>${el.dataset.act === 'generation-save-original' ? '原文件直接保存，没有重新编码；未应用当前混音与裁剪。' : '已应用当前音轨设置与裁剪。监听音量不影响这个文件。'}</p></div>`);
        toast('音频已实际写入本机作品文件夹。');
      } finally { if (el.isConnected) el.disabled = false; }
    }
  }
  document.addEventListener('change', e => { if (e.target.id === 'generation-mode') modeChanged(); });
  return { action, submit, start: poll, refresh };
}
