import http from 'node:http';
import {networkInterfaces} from 'node:os';
import {randomBytes,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {StudioError,isActive,validateLyricsOutput} from '../dist/studio-core.mjs';
import {workerPackage} from './worker-package.mjs';

const uuid=/^[a-f\d-]{36}$/i;
export function privateIPv4(address){return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);}
export function lanAddresses(){
  return Object.entries(networkInterfaces()).flatMap(([name,items])=>items.filter(i=>i.family==='IPv4'&&!i.internal&&privateIPv4(i.address)).map(i=>({name,address:i.address,virtual:/vmware|vethernet|virtual|docker|wsl/i.test(name)}))).sort((a,b)=>Number(a.virtual)-Number(b.virtual));
}
async function bytes(req,limit){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>limit)throw new StudioError('请求过大。',413);chunks.push(c);}return Buffer.concat(chunks);}
async function jsonBody(req){if(req.headers['content-type']!=='application/json')throw new StudioError('需要 JSON 请求。',415);try{return JSON.parse((await bytes(req,64000)).toString());}catch(e){if(e instanceof StudioError)throw e;throw new StudioError('请求内容无法读取。');}}
const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};

// Separate, opt-in LAN port. The normal workspace remains loopback-only.
export class StudioRemote {
  constructor(studio,{addresses=lanAddresses,port=4176,now=Date.now,staleMs=90000}={}){
    Object.assign(this,{studio,addresses,port,now,staleMs});this.server=null;this.worker=null;this.seen=new Map();this.changing=false;this.stopping=false;
  }
  status(){const enabled=!!this.server&&!this.stopping,online=enabled&&!!this.worker&&this.now()-this.worker.lastSeen<this.staleMs;
    return {enabled,addresses:this.addresses(),url:enabled?this.url:null,online,available:online&&this.worker.available,
      worker:this.worker?{name:this.worker.name,lastSeen:new Date(this.worker.lastSeen).toISOString()}:null,
      message:!enabled?'未开启局域网连接':!online?'等待另一台 Windows 电脑连接':this.worker.available?'另一台电脑已连接；登录与音乐工具需通过实际任务验证':'另一台电脑已连接，但未检测到 MiniMax Code 入口'};
  }
  async enable({address}={}){
    if(this.changing||this.server)throw new StudioError('连接已开启或正在切换，请先关闭后重试。',409);
    if(!this.addresses().some(i=>i.address===address))throw new StudioError('请选择这台电脑的局域网地址。');
    this.changing=true;const server=http.createServer((req,res)=>this.handle(req,res));
    server.requestTimeout=120000;server.headersTimeout=15000;
    try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(this.port,address,resolve);});
      this.token=randomBytes(32).toString('hex');this.url=`http://${address}:${server.address().port}`;this.worker=null;this.seen.clear();this.stopping=false;this.server=server;
      this.timer=setInterval(()=>this.expire().catch(()=>{}),10000);this.timer.unref();return this.status();
    }catch{server.close();throw new StudioError('无法开启局域网连接，请检查地址或 4176 端口是否被占用。',503);}finally{this.changing=false;}
  }
  async disable(){
    if(this.changing)throw new StudioError('连接正在切换，请稍后再试。',409);this.changing=true;this.stopping=true;
    try{clearInterval(this.timer);this.token=null;const server=this.server;this.server=null;
      if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
      await this.studio.transaction(async()=>{for(const original of this.studio.projects.values()){
        const p=structuredClone(original);let changed=false;for(const t of p.tasks)if(t.execution==='remote'&&isActive(t)){t.state='interrupted';t.error='局域网连接已关闭，未自动重新生成。请核查另一台电脑保留的结果。';changed=true;}
        if(changed){p.updatedAt=new Date().toISOString();await this.studio.commit(p);}
      }});this.worker=null;this.seen.clear();return this.status();
    }finally{this.changing=false;}
  }
  async package(){if(!this.server||!this.token)throw new StudioError('请先开启局域网连接。',409);return workerPackage({format:'sonara-worker-connection-v1',url:this.url,token:this.token});}
  authorize(req){
    if(!this.server||this.stopping||req.headers.origin||req.headers['sec-fetch-site'])throw new StudioError('仅允许已配对的连接程序访问。',403);
    if(req.headers.host!==new URL(this.url).host)throw new StudioError('连接地址不匹配。',403);
    const supplied=req.headers.authorization||'',expected=`Bearer ${this.token}`;
    if(supplied.length!==expected.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))throw new StudioError('配对已失效，请重新下载连接包。',401);
    const id=req.headers['x-sonara-worker'];if(typeof id!=='string'||!uuid.test(id))throw new StudioError('连接程序标识无效。',403);return id;
  }
  async handle(req,res){try{
    const id=this.authorize(req),path=new URL(req.url,this.url).pathname;
    if(req.method!=='POST')throw new StudioError('此接口仅接受连接程序任务请求。',405);
    if(path==='/worker/hello'){
      const input=await jsonBody(req);if(this.worker&&this.worker.id!==id)throw new StudioError('已配对另一台电脑。请在平台关闭连接后重新配对。',409);
      this.worker={id,name:String(input.name||'Windows 生成电脑').replace(/[\x00-\x1f]/g,'').slice(0,80),available:input.available===true,lastSeen:this.now()};return send(res,200,{ok:true});
    }
    if(this.worker?.id!==id)throw new StudioError('请先完成连接。',401);this.worker.lastSeen=this.now();
    if(path==='/worker/claim'){await jsonBody(req);return send(res,200,{job:await this.claim(id)});}
    const match=path.match(/^\/worker\/tasks\/([a-f\d-]{36})\/([a-f\d-]{36})\/(heartbeat|lyrics|audio|failure)$/);
    if(!match)throw new StudioError('接口不存在。',404);
    const [,projectId,taskId,action]=match,lease=req.headers['x-sonara-lease'];
    const task=this.authorizedTask(projectId,taskId,id,lease);
    if(action==='heartbeat'){await jsonBody(req);if(task.state==='running')this.seen.set(task.id,this.now());return send(res,200,{state:task.state});}
    if(action==='audio'){
      if(req.headers['content-type']!=='application/octet-stream')throw new StudioError('需要音频文件。',415);
      const data=await bytes(req,50*1024*1024);await this.completeAudio(projectId,taskId,id,lease,data);return send(res,200,{ok:true});
    }
    const input=await jsonBody(req);await this.completeJSON(projectId,taskId,id,lease,action,input);return send(res,200,{ok:true});
  }catch(e){if(!res.headersSent)send(res,e instanceof StudioError?e.status:500,{error:e instanceof StudioError?e.message:'连接任务未完成，请检查平台状态。'});else res.destroy();}}
  authorizedTask(projectId,taskId,id,lease){
    const t=this.studio.get(projectId).tasks.find(t=>t.id===taskId);
    if(!t||t.execution!=='remote'||t.remote?.workerId!==id||!lease||t.remote.claimId!==lease)throw new StudioError('任务与配对记录不匹配。',403);return t;
  }
  async claim(id){return this.studio.transaction(async()=>{
    if(!this.status().available||this.worker.id!==id)return null;
    const tasks=[...this.studio.projects.values()].flatMap(p=>p.tasks.map(t=>({p,t})));
    if(tasks.some(({t})=>t.execution==='remote'&&t.state==='running'))return null;
    const next=tasks.filter(({t})=>t.execution==='remote'&&t.state==='queued').sort((a,b)=>a.t.createdAt.localeCompare(b.t.createdAt))[0];if(!next)return null;
    const p=this.studio.get(next.p.id),t=p.tasks.find(t=>t.id===next.t.id);t.state='running';t.startedAt=new Date(this.now()).toISOString();
    t.remote={workerId:id,claimId:randomUUID(),deadline:this.now()+(t.type==='music'?20:6)*60000};p.updatedAt=t.startedAt;
    await this.studio.commit(p);this.seen.set(t.id,this.now());
    return {projectId:p.id,task:{id:t.id,type:t.type,revision:t.revision,snapshot:t.snapshot},lease:t.remote.claimId};
  });}
  async completeJSON(projectId,taskId,id,lease,action,input){return this.studio.transaction(async()=>{
    const old=this.authorizedTask(projectId,taskId,id,lease),p=this.studio.get(projectId),t=p.tasks.find(t=>t.id===taskId);
    if(action==='failure'){
      if(['interrupted','cancelled','succeeded'].includes(old.state))return;
      if(old.state!=='running')throw new StudioError('任务已结束。',409);
      t.state='interrupted';t.error='另一台电脑未完成这次生成，或需要在 MiniMax Code 中登录、确认权限。请检查连接程序窗口与已有结果；不会自动重新生成。';
    }else{
      if(t.type!=='lyrics')throw new StudioError('不是歌词任务。',409);const output=validateLyricsOutput(input);
      if(t.state==='succeeded'&&JSON.stringify(t.output)===JSON.stringify(output))return;
      if(t.state!=='running')throw new StudioError('任务已结束，旧结果不能覆盖。',409);
      t.state='succeeded';t.output=output;t.source='minimax-code-remote';t.finishedAt=new Date().toISOString();
    }
    p.updatedAt=new Date().toISOString();await this.studio.commit(p);this.seen.delete(taskId);
  });}
  async completeAudio(projectId,taskId,id,lease,data){
    const check=()=>{const t=this.authorizedTask(projectId,taskId,id,lease);if(t.type!=='music')throw new StudioError('不是音乐任务。',409);return t;};
    const task=check(),hash=createHash('sha256').update(data).digest('hex');
    if(task.state==='succeeded'&&task.audio?.sha256===hash)return;
    await this.studio.finishAudio(projectId,taskId,data,{source:'minimax-code-remote',note:'由已配对电脑的 MiniMax Code 返回。情绪、歌词和演唱效果需要试听确认。'},['running'],check);this.seen.delete(taskId);
  }
  async expire(){return this.studio.transaction(async()=>{for(const original of this.studio.projects.values()){
    const p=structuredClone(original);let changed=false;for(const t of p.tasks)if(t.execution==='remote'&&t.state==='running'&&(this.now()-(this.seen.get(t.id)||0)>this.staleMs||this.now()>t.remote.deadline)){
      t.state='interrupted';t.error='与生成电脑的联系中断或等待超时。未重新生成，请检查另一台电脑的任务目录，已有音频可以手动导入。';changed=true;this.seen.delete(t.id);
    }if(changed){p.updatedAt=new Date().toISOString();await this.studio.commit(p);}
  }});}
}
