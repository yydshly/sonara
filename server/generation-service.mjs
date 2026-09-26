import { mkdir, readdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateGeneration, buildComposition } from '../dist/generation-core.mjs';
export class ServiceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export class GenerationService {
  constructor({ directory, apiKey = '', model = 'music_v2_5', fetchImpl = fetch, timeoutMs = 10 * 60 * 1000 }) {
    if (!['music_v2', 'music_v2_5'].includes(model)) throw new Error('SONARA_MUSIC_MODEL must be music_v2 or music_v2_5.');
    Object.assign(this, { directory, apiKey, model, fetchImpl, timeoutMs });
    this.jobs = new Map(); this.controllers = new Map(); this.writes = new Map(); this.pendingCreates = new Map(); this.tail = Promise.resolve(); this.closed = false;
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f\d-]{36}\.json$/.test(name)) continue;
      const job = JSON.parse(await readFile(join(this.directory, name), 'utf8'));
      this.jobs.set(job.id, job);
      if (['queued', 'running'].includes(job.state)) { job.state = 'interrupted'; job.error = '服务曾中断。未自动重新生成，避免重复扣费；请先核查供应商记录。'; await this.persist(job); }
    }
    return this;
  }
  status() { return { provider: 'ElevenLabs', model: this.model, configured: !!this.apiKey, qualityVerified: false, message: this.apiKey ? '已配置连接，账户权限与音质仍需实际验证。' : '尚未连接音乐生成服务。可以先保存歌词和生成设置。' }; }
  async persist(job) {
    job.updatedAt = new Date().toISOString();
    const path = join(this.directory, `${job.id}.json`), temp = `${path}.${randomUUID()}.tmp`;
    const data = JSON.stringify(job, null, 2);
    const write = (this.writes.get(job.id) || Promise.resolve()).catch(() => {}).then(async () => { await writeFile(temp, data, { mode: 0o600 }); await rename(temp, path); });
    this.writes.set(job.id, write);
    try { await write; } finally { if (this.writes.get(job.id) === write) this.writes.delete(job.id); }
  }
  publicJob(job) { return structuredClone(job); }
  list(projectId) { return [...this.jobs.values()].filter(j => j.request.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30).map(j => this.publicJob(j)); }
  get(id) { const job = this.jobs.get(id); if (!job) throw new ServiceError('找不到这次生成。', 404); return job; }
  async create(input) {
    if (this.closed) throw new ServiceError('服务正在关闭，请稍后重试。', 503);
    let request; try { request = validateGeneration(input); } catch (e) { throw new ServiceError(e.message); }
    // A repeated request must await durable acceptance, not just an in-memory reservation.
    const pending = this.pendingCreates.get(request.requestId);
    if (pending) {
      if (JSON.stringify(pending.request) !== JSON.stringify(request)) throw new ServiceError('同一次请求的内容已变化，请重新打开生成窗口。', 409);
      return this.publicJob(await pending.promise);
    }
    const old = [...this.jobs.values()].find(j => j.request.requestId === request.requestId);
    if (old) { if (JSON.stringify(old.request) !== JSON.stringify(request)) throw new ServiceError('同一次请求的内容已变化，请重新打开生成窗口。', 409); return this.publicJob(old); }
    if (!this.apiKey) throw new ServiceError('尚未配置音乐生成服务，未发送歌词，也未产生生成请求。', 503);
    if ([...this.jobs.values()].filter(j => ['queued', 'running'].includes(j.state)).length >= 3) throw new ServiceError('已有三项任务等待处理，请完成后再生成。', 429);
    let plan; try { plan = buildComposition(request, this.model); } catch (e) { throw new ServiceError(e.message); }
    const job = { id: randomUUID(), provider: 'ElevenLabs', model: this.model, createdAt: new Date().toISOString(), state: 'queued', request, sections: plan.sections, providerRequest: plan.body };
    this.jobs.set(job.id, job);
    const acceptance = this.persist(job).then(() => {
      this.tail = this.tail.then(() => this.run(job)).catch(async () => {
        // Cancellation remains final even if an older queued write fails afterward.
        if (job.state !== 'cancelled') { job.state = 'interrupted'; job.error = '本机保存异常，请核查生成记录，不会自动重新提交。'; }
        try { await this.persist(job); } catch {}
      });
      return job;
    }, error => { this.jobs.delete(job.id); throw error; });
    this.pendingCreates.set(request.requestId, { request, promise: acceptance });
    try { return this.publicJob(await acceptance); }
    finally { if (this.pendingCreates.get(request.requestId)?.promise === acceptance) this.pendingCreates.delete(request.requestId); }
  }
  async run(job) {
    if (job.state !== 'queued' || this.closed) return;
    job.state = 'running'; await this.persist(job);
    if (job.state !== 'running' || this.closed) return;
    const controller = new AbortController(); this.controllers.set(job.id, controller);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl('https://api.elevenlabs.io/v1/music?output_format=mp3_48000_192', { method: 'POST', headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(job.providerRequest), signal: controller.signal });
      if (!response.ok) {
        const messages = { 401: '服务密钥无效，请检查本机配置。', 402: '账户额度不足，请检查服务账户。', 403: '账户没有音乐生成权限，请检查服务套餐。', 422: '服务未接受本次内容或参数，请调整后手动重试。', 429: '服务请求过多或额度受限，请稍后手动重试。' };
        await response.body?.cancel();
        // An upstream timeout/server error does not prove that generation or billing stopped.
        if (response.status >= 500 || response.status === 408) throw new Error('Uncertain provider outcome');
        throw new ServiceError(messages[response.status] || `音乐服务返回错误（${response.status}）。未自动重试，请先核查账户记录。`, 502);
      }
      const chunks = []; let size = 0;
      if (!response.body) throw new Error('Empty response');
      for await (const chunk of response.body) { size += chunk.length; if (size > 25 * 1024 * 1024) { controller.abort(); throw new ServiceError('返回音频超过本轮大小限制，请核查供应商记录。', 502); } chunks.push(chunk); }
      const audio = Buffer.concat(chunks), mp3 = audio.subarray(0, 3).toString() === 'ID3' || (audio[0] === 255 && (audio[1] & 224) === 224);
      if (audio.length < 100 || !mp3) throw new ServiceError('服务没有返回有效的 MP3 音频，未将其记为生成成功。', 502);
      if (job.state !== 'running') return;
      await writeFile(join(this.directory, `${job.id}.mp3`), audio, { mode: 0o600 });
      if (job.state !== 'running') return;
      job.state = 'succeeded'; job.bytes = audio.length; job.contentType = 'audio/mpeg'; job.providerSongId = response.headers.get('song-id') || null; job.finishedAt = new Date().toISOString();
    } catch (error) {
      if (job.state !== 'running') return;
      job.state = error instanceof ServiceError ? 'failed' : 'interrupted';
      job.error = error instanceof ServiceError ? error.message : '连接中断或等待超时，无法确认供应商是否已完成或扣费。不会自动重试，请先核查账户。';
    } finally { clearTimeout(timer); this.controllers.delete(job.id); await this.persist(job); }
  }
  async cancel(id) {
    const job = this.get(id); if (!['queued', 'running'].includes(job.state)) return this.publicJob(job);
    const started = job.state === 'running'; job.state = 'cancelled'; job.error = started ? '已停止本机等待。供应商可能仍在处理或计费，请检查账户记录。' : '已取消等待，未发送到音乐服务。';
    this.controllers.get(id)?.abort(); await this.persist(job); return this.publicJob(job);
  }
  async audio(id) { const job = this.get(id); if (job.state !== 'succeeded') throw new ServiceError('音频尚未准备好。', 409); return readFile(join(this.directory, `${job.id}.mp3`)); }
  async close() {
    this.closed = true;
    const saves = [];
    for (const job of this.jobs.values()) if (['queued', 'running'].includes(job.state)) {
      job.state = 'interrupted'; job.error = '服务已停止，未自动重新生成。请核查供应商记录。';
      this.controllers.get(job.id)?.abort(); saves.push(this.persist(job));
    }
    // Abort every task even when saving one task fails, and include in-flight acceptance.
    await Promise.allSettled([...saves, ...[...this.pendingCreates.values()].map(entry => entry.promise)]);
    await this.tail;
  }
}
