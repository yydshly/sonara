import {mkdir,readFile,writeFile,rename,readdir,open,unlink} from 'node:fs/promises';
import {appendFileSync,statSync,renameSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {hostname} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {MiniMaxCode,redactDiagnostic} from '../server/minimax-code.mjs';
import {StudioError,validateDraft,assertReady,lyricsPrompt,lyricsSchema,validateLyricsOutput} from '../dist/studio-core.mjs';

const uuid=/^[a-f\d-]{36}$/i;
export const workerVersion='0.3.3';
export function createWorkerLogger(file,output=console.log){
  let warned=false;
  return message=>{
    const line=`[${new Date().toISOString()}] ${redactDiagnostic(message).slice(0,4000)}`;output(line);
    try{try{if(statSync(file).size>1024*1024)renameSync(file,file+'.previous');}catch(e){if(e.code!=='ENOENT')throw e;}appendFileSync(file,line+'\n',{encoding:'utf8',mode:0o600});}
    catch{if(!warned){warned=true;output('日志文件写入失败，请检查解压目录是否可写；上方窗口仍会显示运行提示。');}}
  };
}
export function validateConnection(config){
  let url;try{url=new URL(config?.url);}catch{throw Error('连接包地址无效，请重新下载。');}
  if(config.format!=='sonara-worker-connection-v1'||url.protocol!=='http:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!url.port||!(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)||url.hostname==='127.0.0.1')||!/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)||!/^[a-f\d]{64}$/.test(config.token))throw Error('连接包不符合局域网格式，请重新下载。');
  return {...config,url:url.origin};
}
export function validateJob(job){
  if(!job||!uuid.test(job.projectId)||!uuid.test(job.task?.id)||!uuid.test(job.lease)||!['lyrics','music'].includes(job.task.type)||!Number.isInteger(job.task.revision)||job.task.revision<1)throw Error('收到的任务格式不正确。');
  const snapshot=validateDraft(job.task.snapshot);assertReady(snapshot,job.task.type);return {projectId:job.projectId,lease:job.lease,task:{id:job.task.id,type:job.task.type,revision:job.task.revision,snapshot}};
}
class ConnectionError extends Error {constructor(message,status=0){super(message);this.status=status;}}
async function saveJSON(path,value){const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600});await rename(temporary,path);}

export class RemoteWorker {
  constructor({config,directory,minimax=new MiniMaxCode(),fetcher=fetch,log=console.log}={}){
    Object.assign(this,{config:validateConnection(config),directory,minimax,fetcher,log});this.stopped=false;this.current=null;this.lastIdleLog=Date.now();this.connectionId=createHash('sha256').update(config.url+config.token).digest('hex');
  }
  async init(){
    await mkdir(join(this.directory,'tasks'),{recursive:true});const identity=join(this.directory,'identity.json');
    try{this.id=JSON.parse(await readFile(identity,'utf8')).id;if(!uuid.test(this.id))throw Error('连接身份文件损坏。');}catch(e){if(e.code!=='ENOENT')throw e;this.id=randomUUID();await saveJSON(identity,{id:this.id});}
    this.log('正在检查 MiniMax Code 命令入口…');this.available=(await this.minimax.status()).available;
    this.log(this.available?'已识别 MiniMax Code，正在连接声间…':'未找到 MiniMax Code，正在向声间报告连接状态…');
    await this.request('/worker/hello',{name:hostname(),available:this.available,version:workerVersion});
    this.log(this.available?'已连接声间，等待你在平台提交任务。音乐权限将在实际任务中验证。':'已连接声间，但未找到 MiniMax Code。请检查安装后重新启动此程序。');return this;
  }
  async request(path,input={},lease,raw=false){
    let response;try{response=await this.fetcher(this.config.url+path,{method:'POST',redirect:'error',headers:{'Authorization':'Bearer '+this.config.token,'X-Sonara-Worker':this.id,'Content-Type':raw?'application/octet-stream':'application/json',...(lease?{'X-Sonara-Lease':lease}:{})},body:raw?input:JSON.stringify(input),signal:AbortSignal.timeout(raw?90000:15000)});}catch{throw new ConnectionError('暂时无法连接声间。请检查两台电脑的网络和平台连接状态。');}
    const text=await response.text();if(text.length>64000)throw new ConnectionError('平台返回内容过大。',422);let result;try{result=JSON.parse(text);}catch{throw new ConnectionError('平台没有返回可读取的状态。',502);}
    if(!response.ok)throw new ConnectionError(result.error||'任务未被平台接收。',response.status);return result;
  }
  endpoint(job,action){return `/worker/tasks/${job.projectId}/${job.task.id}/${action}`;}
  async generate(job){
    job=validateJob(job);const folder=join(this.directory,'tasks',job.task.id),journal=join(folder,'journal.json');await mkdir(folder,{recursive:true});
    // Reserve on disk before invoking the model. Even after a crash this task is never generated twice.
    const record={connectionId:this.connectionId,job,state:'running'};
    try{await writeFile(journal,JSON.stringify(record),{flag:'wx',mode:0o600});}catch(e){if(e.code==='EEXIST'){this.log('任务已有本机记录，仅核查或回传，不会再次生成。');return;}throw e;}
    const controller=new AbortController();this.current=controller;let lastContact=Date.now(),heartbeating=false;const started=Date.now();
    const heartbeat=setInterval(async()=>{if(heartbeating)return;heartbeating=true;try{
      const result=await this.request(this.endpoint(job,'heartbeat'),{},job.lease);lastContact=Date.now();if(result.state!=='running')controller.abort();
    }catch(e){if([401,403,404,409].includes(e.status)||Date.now()-lastContact>75000)controller.abort();}finally{heartbeating=false;}},5000);
    const progress=setInterval(()=>this.log(`MiniMax Code 仍在执行，已等待 ${Math.round((Date.now()-started)/1000)} 秒；没有重新提交任务。`),30000);
    this.log(`正在生成${job.task.type==='music'?'音乐':'歌词'}：${redactDiagnostic(job.task.snapshot.title||'未命名作品')}。`);
    this.log(`任务 ${job.task.id}；诊断目录：${folder}`);
    try{
      if(job.task.type==='lyrics')record.output=validateLyricsOutput(await this.minimax.generate({path:folder,prompt:lyricsPrompt(job.task.snapshot),schemaValue:lyricsSchema,signal:controller.signal}));
      else{const result=await this.minimax.music({path:folder,project:{id:job.projectId},task:job.task,signal:controller.signal});await writeFile(join(folder,'delivery.audio'),result.data,{mode:0o600});}
      record.state='ready';
    }catch(e){record.state='failed';record.failure={code:typeof e.code==='string'?e.code.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80):'WORKER_ERROR',message:redactDiagnostic(e instanceof StudioError?e.message:e.message||'任务未完成，请核查本机记录。').slice(0,2000)};this.log('生成未完成：'+record.failure.message);}
    try{await saveJSON(journal,record);await this.deliver(record,folder);}
    finally{clearInterval(heartbeat);clearInterval(progress);this.current=null;}
  }
  async deliver(record,folder){
    const {job}=record;
    try{
      if(record.state==='ready'&&job.task.type==='music')await this.request(this.endpoint(job,'audio'),await readFile(join(folder,'delivery.audio')),job.lease,true);
      else await this.request(this.endpoint(job,record.state==='ready'?'lyrics':'failure'),record.state==='ready'?record.output:{failure:record.failure},job.lease);
      const failed=record.state!=='ready';record.state='delivered';record.outcome=failed?'failed':'succeeded';await saveJSON(join(folder,'journal.json'),record);this.log(failed?'失败状态已送回声间，未重新生成。':'生成结果已回到声间。');return true;
    }catch(e){if([401,403,404,409,410,413,415,422].includes(e.status)){
      record.state='needs-review';await saveJSON(join(folder,'journal.json'),record);this.log('平台未接收这份结果。文件已留在任务目录，可核查后手动导入音频。');return true;
    }throw e;}
  }
  async recover(){
    for(const entry of await readdir(join(this.directory,'tasks'),{withFileTypes:true})){
      if(!entry.isDirectory()||!uuid.test(entry.name))continue;const folder=join(this.directory,'tasks',entry.name);let record;
      try{record=JSON.parse(await readFile(join(folder,'journal.json'),'utf8'));}catch{continue;}
      if(record.connectionId!==this.connectionId||!['running','ready','failed'].includes(record.state))continue;
      record.job=validateJob(record.job);
      if(record.state==='running'){record.state='failed';await saveJSON(join(folder,'journal.json'),record);this.log('发现上次中断的任务，已停止自动生成，请核查任务目录。');}
      await this.deliver(record,folder);
    }
  }
  async tick(){await this.recover();const {job}=await this.request('/worker/claim');if(job)await this.generate(job);else if(Date.now()-this.lastIdleLog>=30000){this.log(this.available?'连接正常，等待平台提交新任务。':'连接正常，但未检测到 MiniMax Code；安装或配置后请重启连接程序。');this.lastIdleLog=Date.now();}return !!job;}
  stop(){this.stopped=true;this.current?.abort();}
  async loop(){let disconnected=false;while(!this.stopped){try{await this.tick();disconnected=false;}catch(e){if(!disconnected)this.log(e.message);disconnected=true;if([401,403,409].includes(e.status))throw e;}if(!this.stopped)await delay(5000);}}
}

async function lockDirectory(directory){
  await mkdir(directory,{recursive:true});const path=join(directory,'worker.lock');
  try{const previous=Number(await readFile(path,'utf8'));if(!Number.isSafeInteger(previous)||previous<=0)throw Error('连接锁文件损坏，请检查 .local/remote-worker/worker.lock。');try{process.kill(previous,0);throw Error('连接程序已经在运行，请不要重复启动。');}catch(e){if(e.code!=='ESRCH')throw e;}await unlink(path);}catch(e){if(e.code!=='ENOENT')throw e;}
  const handle=await open(path,'wx');await handle.writeFile(String(process.pid));return async()=>{await handle.close();await unlink(path).catch(()=>{});};
}
async function main(){
  const configPath=resolve(process.argv[2]||'connection.json'),log=createWorkerLogger(join(dirname(configPath),'worker.log'));let worker,unlock;
  log(`声间连接程序 v${workerVersion} 启动 · Node.js ${process.versions.node}`);log('运行记录同时写入同目录 worker.log；双击 view-logs.cmd 可查看。');
  try{
    const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||(major===22&&minor<19))throw Error('请安装 Node.js 24 LTS 后再启动连接程序。');
    let config;try{config=JSON.parse(await readFile(configPath,'utf8'));}catch{throw Error('无法读取 connection.json。请完整解压连接包，更新时保留原来的 connection.json。');}
    const directory=join(dirname(configPath),'.local/remote-worker');unlock=await lockDirectory(directory);
    worker=new RemoteWorker({config,directory,log});for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>{log('正在停止连接程序，已开始的外部任务需要核查。');worker.stop();});await worker.init();await worker.loop();
  }catch(e){log('连接程序未能继续：'+redactDiagnostic(e.message));process.exitCode=1;}
  finally{worker?.stop();if(unlock)await unlock();log('连接程序已退出。记录保存在 worker.log。');}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
