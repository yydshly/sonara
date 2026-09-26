import http from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ServiceError } from './generation-service.mjs';
import { scoreMidi } from './score-midi.mjs';
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mid': 'audio/midi', '.txt': 'text/plain; charset=utf-8' };
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" };
function json(res, status, body) { res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new ServiceError('仅接受 JSON 请求。', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 64000) throw new ServiceError('请求内容过大。', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new ServiceError('请求内容无法读取。'); }
}
function sendFile(req,res,data,type){
  const fileHeaders={...headers,'Content-Type':type,'Accept-Ranges':'bytes'};
  if(req.method==='GET'&&req.headers.range){
    const range=req.headers.range.match(/^bytes=(\d*)-(\d*)$/);let start,end;
    if(range&&(range[1]||range[2])){
      if(!range[1]){const count=Number(range[2]);start=count>0?Math.max(0,data.length-count):NaN;end=data.length-1;}
      else{start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),data.length-1):data.length-1;}
    }
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=data.length||end<start){res.writeHead(416,{...fileHeaders,'Content-Range':`bytes */${data.length}`,'Content-Length':0});return res.end();}
    res.writeHead(206,{...fileHeaders,'Content-Range':`bytes ${start}-${end}/${data.length}`,'Content-Length':end-start+1});return res.end(data.subarray(start,end+1));
  }
  res.writeHead(200,{...fileHeaders,'Content-Length':data.length});res.end(req.method==='HEAD'?undefined:data);
}
export function createServer({ root, service, scoreService, compositionService, songProjectService, phrasingService, listeningService, exportDirectory = resolve(root, '../.local/exports') }) {
  return http.createServer(async (req, res) => {
    try {
      const port = req.socket.localPort, allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!allowedHosts.includes(req.headers.host)) throw new ServiceError('只允许从本机工作台访问。', 403);
      const expectedOrigin = `http://${req.headers.host}`;
      if (req.headers.origin && req.headers.origin !== expectedOrigin) throw new ServiceError('请从本机工作台发起请求。', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new ServiceError('禁止跨站请求。', 403);
      const url = new URL(req.url, expectedOrigin), pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/api/')) {
        if(listeningService&&pathname.startsWith('/api/listening-trial')){
          if(req.method==='GET'&&pathname==='/api/listening-trial')return json(res,200,await listeningService.snapshot());
          if(req.method==='POST'&&pathname==='/api/listening-trial/choice')return json(res,200,await listeningService.choose(await body(req)));
          const audio=pathname.match(/^\/api\/listening-trial\/audio\/([AB])$/);
          if(['GET','HEAD'].includes(req.method)&&audio){const file=await listeningService.asset(audio[1]);return sendFile(req,res,file.data,file.type);}
        }
        if(phrasingService&&pathname.startsWith('/api/song-phrasing')){
          if(req.method==='GET'&&pathname==='/api/song-phrasing')return json(res,200,phrasingService.snapshot());
          if(req.method==='POST'&&pathname==='/api/song-phrasing')return json(res,202,await phrasingService.create(await body(req)));
          const action=pathname.match(/^\/api\/song-phrasing\/([a-f\d-]{36})\/(render|cancel|review)$/);
          if(req.method==='POST'&&action)return json(res,200,await phrasingService[action[2]](action[1],await body(req)));
          const asset=pathname.match(/^\/api\/song-phrasing\/([a-f\d-]{36})\/assets\/(score|midi|lyrics|before|after|song|vocal|record)$/);
          if(['GET','HEAD'].includes(req.method)&&asset){const file=await phrasingService.asset(asset[1],asset[2]);return sendFile(req,res,file.data,file.type);}
        }
        if(songProjectService&&pathname.startsWith('/api/song-project')){
          if(req.method==='GET'&&pathname==='/api/song-project')return json(res,200,songProjectService.snapshot());
          if(req.method==='POST'&&pathname==='/api/song-project/prepare')return json(res,200,await songProjectService.prepare(await body(req)));
          if(req.method==='POST'&&pathname==='/api/song-project/observations'){const input=await body(req);const version=typeof input?.version==='string'&&input.version.startsWith('phrasing:')?phrasingService?.get(input.version.slice(8)):undefined;return json(res,200,await songProjectService.observe(input,version));}
          if(req.method==='POST'&&pathname==='/api/song-project/render')return json(res,202,await songProjectService.render(await body(req)));
          const action=pathname.match(/^\/api\/song-project\/([a-f\d-]{36})\/(cancel|review)$/);
          if(req.method==='POST'&&action)return json(res,200,await songProjectService[action[2]](action[1],await body(req)));
          const asset=pathname.match(/^\/api\/song-project\/([a-f\d-]{36})\/assets\/(song|accompaniment|record)$/);
          if(['GET','HEAD'].includes(req.method)&&asset){const file=await songProjectService.asset(asset[1],asset[2]);return sendFile(req,res,file.data,file.type);}
        }
        if(compositionService&&pathname.startsWith('/api/compositions')){
          if(req.method==='GET'&&pathname==='/api/compositions')return json(res,200,compositionService.snapshot());
          if(req.method==='POST'&&pathname==='/api/compositions')return json(res,202,await compositionService.create(await body(req)));
          const action=pathname.match(/^\/api\/compositions\/([a-f\d-]{36})\/(render|cancel|revise|rearrange)$/);
          if(req.method==='POST'&&action){const input=await body(req);return json(res,200,await compositionService[action[2]](action[1],input));}
          const asset=pathname.match(/^\/api\/compositions\/([a-f\d-]{36})\/assets\/(score|lyrics|midi|arrangement|instruments|guide|backing|song|vocal)$/);
          if(['GET','HEAD'].includes(req.method)&&asset){const file=await compositionService.asset(asset[1],asset[2]);return sendFile(req,res,file.data,file.type);}
        }
        if(scoreService&&pathname.startsWith('/api/score')){
          if(req.method==='GET'&&pathname==='/api/score')return json(res,200,scoreService.snapshot());
          if(req.method==='POST'&&pathname==='/api/score/preview')return json(res,200,await scoreService.preview(await body(req)));
          if(req.method==='POST'&&pathname==='/api/score/jobs')return json(res,202,await scoreService.create(await body(req)));
          const cancel=pathname.match(/^\/api\/score\/jobs\/([a-f\d-]{36})\/cancel$/);
          if(req.method==='POST'&&cancel){await body(req);return json(res,200,await scoreService.cancel(cancel[1]));}
          const asset=pathname.match(/^\/api\/score\/versions\/(A|B|[a-f\d-]{36})\/(song|vocal|lyrics|midi)$/);
          if(['GET','HEAD'].includes(req.method)&&asset){
            const [,id,kind]=asset,version=scoreService.version(id);
            if(kind==='lyrics')return sendFile(req,res,Buffer.from(version.lyrics.join('\n')+'\n'),'text/plain; charset=utf-8');
            if(kind==='midi')return sendFile(req,res,scoreMidi(scoreService.score,version.lyrics),'audio/midi');
            return sendFile(req,res,await scoreService.audio(id,kind),'audio/wav');
          }
        }
        if (req.method === 'POST' && pathname === '/api/exports') {
          if (!['audio/wav', 'audio/mpeg', 'application/octet-stream'].includes(req.headers['content-type'])) throw new ServiceError('音频文件类型无效。', 415);
          const requested = url.searchParams.get('filename') || 'audio.wav';
          const extension = extname(requested).toLowerCase();
          if (!/^\.(wav|mp3|m4a|ogg|flac|aac|opus|aiff|aif|webm)$/.test(extension)) throw new ServiceError('请选择常用音频格式。');
          const name = requested.slice(0, -extension.length).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 100) + extension;
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 100 * 1024 * 1024) throw new ServiceError('导出文件超过 100 MB，请先裁剪。', 413); chunks.push(chunk); }
          if (size < 44) throw new ServiceError('没有可保存的音频。');
          await mkdir(exportDirectory, { recursive: true });
          const path = resolve(exportDirectory, `${randomUUID()}-${name}`);
          await writeFile(path, Buffer.concat(chunks), { flag: 'wx', mode: 0o600 });
          return json(res, 201, { path, bytes: size, name });
        }
        if (req.method === 'GET' && pathname === '/api/music/status') return json(res, 200, service.status());
        if (req.method === 'GET' && pathname === '/api/generations') return json(res, 200, service.list(url.searchParams.get('projectId')));
        if (req.method === 'POST' && pathname === '/api/generations') return json(res, 202, await service.create(await body(req)));
        const match = pathname.match(/^\/api\/generations\/([a-f\d-]{36})(?:\/(audio|cancel))?$/);
        if (match && req.method === 'GET' && !match[2]) return json(res, 200, service.publicJob(service.get(match[1])));
        if (match && req.method === 'POST' && match[2] === 'cancel') { await body(req); return json(res, 200, await service.cancel(match[1])); }
        if (match && req.method === 'GET' && match[2] === 'audio') { const audio = await service.audio(match[1]); res.writeHead(200, { ...headers, 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length, 'Content-Disposition': `attachment; filename="sonara-${match[1]}.mp3"` }); return res.end(audio); }
        throw new ServiceError('没有这个服务接口。', 404);
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new ServiceError('请求方式不支持。', 405);
      const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!path.startsWith(root + sep)) throw new ServiceError('无法访问该文件。', 403);
      if (!(await stat(path)).isFile()) throw new ServiceError('找不到文件。', 404);
      return sendFile(req,res,await readFile(path),mime[extname(path)]||'application/octet-stream');
    } catch (e) { json(res, e instanceof ServiceError ? e.status : e.code === 'ENOENT' ? 404 : 500, { error: e instanceof ServiceError ? e.message : e.code === 'ENOENT' ? '找不到文件。' : '本机服务处理失败，请检查服务状态。' }); }
  });
}
