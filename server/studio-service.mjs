import {mkdir,readdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {CodexComposer} from './codex-composer.mjs';
import {MiniMaxCode} from './minimax-code.mjs';
import {inspectAudio} from './studio-media.mjs';
import {StudioRemote} from './studio-remote.mjs';
import {StudioError,makeProject,updateDraft,makeTask,isActive,lyricsSchema,lyricsPrompt,validateLyricsOutput,reviewTask} from '../dist/studio-core.mjs';
const uuid=/^[a-f\d-]{36}$/i;
export class StudioService {
  constructor({directory,codex=new CodexComposer(),minimax=new MiniMaxCode(),remoteOptions}={}){Object.assign(this,{directory,codex,minimax});this.projects=new Map();this.tail=Promise.resolve();this.transactions=Promise.resolve();this.controllers=new Map();this.closed=false;this.connection={codex:{ready:false},minimax:{available:false}};this.remote=new StudioRemote(this,remoteOptions);}
  async init(){
    await mkdir(this.directory,{recursive:true});
    for(const name of await readdir(this.directory)){if(!/^[a-f\d-]{36}\.json$/.test(name))continue;const p=JSON.parse(await readFile(join(this.directory,name),'utf8'));if(p.format!=='sonara-studio-v1')continue;
      let changed=false;for(const t of p.tasks)if(isActive(t)){t.state='interrupted';t.error='服务曾中断，未自动重新发送。请核查模型任务，再导入已有结果或明确创建新任务。';changed=true;}if(changed)await this.persist(p);this.projects.set(p.id,p);}
    await this.refreshConnection();return this;
  }
  async refreshConnection(){const [codex,minimax]=await Promise.all([this.codex.status(),this.minimax.status()]);this.connection={codex,minimax};return this.status();}
  status(){return {mode:'local',storage:'本机作品库',lyrics:[{id:'codex',name:'Codex',available:!!this.connection.codex.ready,message:this.connection.codex.message},{id:'minimax-code',name:'MiniMax Code',...this.connection.minimax}],music:{id:'minimax-code',name:'MiniMax Code',...this.connection.minimax},cloudGeneration:false,remote:this.remote.status()};}
  get(id){const p=this.projects.get(id);if(!p)throw new StudioError('找不到这首作品。',404);return structuredClone(p);}
  list(){return [...this.projects.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(p=>({id:p.id,title:p.draft.title||'未命名作品',idea:p.draft.idea,mode:p.draft.mode,updatedAt:p.updatedAt,revision:p.revision,takes:p.tasks.filter(t=>t.type==='music'&&t.state==='succeeded').length}));}
  async persist(p){const file=join(this.directory,p.id+'.json'),temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(p,null,2),{mode:0o600});await rename(temp,file);}
  async transaction(action){const result=this.transactions.then(()=>{if(this.closed)throw new StudioError('服务正在停止，请稍后重试。',503);return action();});this.transactions=result.catch(()=>{});return result;}
  async commit(p){await this.persist(p);this.projects.set(p.id,p);return structuredClone(p);}
  async create({id=randomUUID(),draft}){if(!uuid.test(id))throw new StudioError('作品标识无效。');return this.transaction(async()=>{if(this.projects.has(id))return this.get(id);return this.commit(makeProject(id,draft));});}
  async save(id,input){return this.transaction(()=>this.commit(updateDraft(this.get(id),input)));}
  async prepare(id,input){
    return this.transaction(async()=>{
      const p=this.get(id),type=input.type,provider=type==='lyrics'?input.provider:'minimax-code',execution=input.execution||'local';
      if(!['local','remote'].includes(execution)||(execution==='remote'&&provider!=='minimax-code'))throw new StudioError('不支持的生成位置。');
      const existing=p.tasks.find(t=>t.requestId===input.requestId);
      if(existing){if(existing.type!==type||existing.provider!==provider||existing.revision!==input.revision||(existing.execution||'local')!==execution)throw new StudioError('同一次请求的内容已经变化，请重新操作。',409);return p;}
      if(p.revision!==input.revision)throw new StudioError('歌词或方向已变化，请先保存并重新确认。',409);
      if(p.tasks.length>=150)throw new StudioError('当前作品任务较多，请导出后创建新的作品。',429);
      if(type==='lyrics'&&!(execution==='remote'?this.remote.status().available:this.status().lyrics.find(v=>v.id===provider)?.available))throw new StudioError('这个歌词模型尚未连接。可以先自己写词或选择已连接的模型。',503);
      if([...this.projects.values()].flatMap(x=>x.tasks).filter(isActive).length>=3)throw new StudioError('已有三项任务等待处理，请稍后再试。',429);
      const task=makeTask(p,{id:randomUUID(),requestId:input.requestId,type,provider});task.execution=execution;p.tasks.push(task);p.updatedAt=new Date().toISOString();await this.commit(p);
      if(type==='lyrics'&&execution==='local')this.enqueue(p.id,task.id);return this.get(id);
    });
  }
  async run(id,taskId,{execution='local'}={}){return this.transaction(async()=>{
    const p=this.get(id),t=p.tasks.find(t=>t.id===taskId);if(!t||t.type!=='music')throw new StudioError('找不到这次音乐任务。',404);
    if(!['local','remote'].includes(execution))throw new StudioError('不支持的生成位置。');
    if(isActive(t)||t.state==='succeeded'){if((t.execution||'local')!==execution)throw new StudioError('任务已经提交到另一位置，未重复发送。',409);return p;}
    if(t.state!=='prepared')throw new StudioError('本次任务已经结束，请核查结果后明确创建新版本。',409);
    if(!(execution==='remote'?this.remote.status().available:this.connection.minimax.available))throw new StudioError(execution==='remote'?'另一台电脑尚未连接或 MiniMax Code 不可用，请在生成连接中检查。':'请先连接 MiniMax Code，或导出任务并导回音频。',503);
    if([...this.projects.values()].flatMap(x=>x.tasks).filter(isActive).length>=3)throw new StudioError('已有三项任务等待处理。',429);
    t.state='queued';t.execution=execution;await this.commit(p);if(execution==='local')this.enqueue(id,taskId);return this.get(id);
  });}
  enqueue(id,taskId){this.tail=this.tail.then(()=>this.execute(id,taskId)).catch(()=>{});}
  async transition(id,taskId,change,states){return this.transaction(async()=>{const p=this.get(id),i=p.tasks.findIndex(t=>t.id===taskId);if(i<0||!states.includes(p.tasks[i].state))return false;p.tasks[i]={...p.tasks[i],...change};p.updatedAt=new Date().toISOString();await this.commit(p);return true;});}
  async execute(id,taskId){
    if(this.closed)return;const controller=new AbortController();this.controllers.set(taskId,controller);
    try{
      if(!await this.transition(id,taskId,{state:'running',startedAt:new Date().toISOString()},['queued']))return;
      const p=this.get(id),task=p.tasks.find(t=>t.id===taskId),path=join(this.directory,'tasks',taskId);
      if(this.closed||this.get(id).tasks.find(t=>t.id===taskId).state!=='running')return;
      if(task.type==='lyrics'){
        const composer=task.provider==='codex'?this.codex:this.minimax;
        const raw=await composer.generate({path,prompt:lyricsPrompt(task.snapshot),schemaValue:lyricsSchema,signal:controller.signal});
        const output=validateLyricsOutput(raw);await this.transition(id,taskId,{state:'succeeded',output,finishedAt:new Date().toISOString()},['running']);
      }else{
        const result=await this.minimax.music({path,project:p,task,signal:controller.signal});
        if(this.closed||this.get(id).tasks.find(t=>t.id===taskId).state!=='running')return;
        await this.finishAudio(id,taskId,result.data,{source:'minimax-code',note:result.note},['running']);
      }
    }catch(error){if(!this.closed){try{await this.transition(id,taskId,{state:'interrupted',error:error instanceof StudioError?error.message:'生成未完成，无法确认外部服务结果。请核查任务；不会自动重试。'},['queued','running']);}catch{const p=this.projects.get(id),t=p?.tasks.find(t=>t.id===taskId);if(t&&isActive(t)){t.state='interrupted';t.error='保存失败，未记为成功；请导出已有文件并检查本机存储。';}}}}
    finally{this.controllers.delete(taskId);}
  }
  async finishAudio(id,taskId,data,metadata,allowed,guard=()=>{}){
    const audio=inspectAudio(data),hash=createHash('sha256').update(data).digest('hex');
    return this.transaction(async()=>{guard();const p=this.get(id),t=p.tasks.find(t=>t.id===taskId);if(!t||t.type!=='music')throw new StudioError('找不到音乐任务。',404);if(!allowed.includes(t.state))throw new StudioError('这次任务已有结果或仍在运行，请另建版本；原音频不会覆盖。',409);
      const folder=join(this.directory,'audio');await mkdir(folder,{recursive:true});const file=join(folder,`${taskId}-${hash}.${audio.extension}`);await writeFile(file,data,{flag:'wx',mode:0o600}).catch(e=>{if(e.code!=='EEXIST')throw e;});
      t.state='succeeded';t.audio={...audio,sha256:hash};t.source=metadata.source;t.note=String(metadata.note||'').slice(0,1600);t.finishedAt=new Date().toISOString();t.error=null;p.updatedAt=t.finishedAt;return this.commit(p);
    });
  }
  async importAudio(id,taskId,data){return this.finishAudio(id,taskId,data,{source:'manual',note:'用户为这份任务导入的音频；平台未验证歌词与情绪是否符合要求。'},['prepared','interrupted','failed']);}
  async audio(id,taskId){const t=this.get(id).tasks.find(t=>t.id===taskId);if(t?.state!=='succeeded'||!t.audio)throw new StudioError('音频尚未保存完成。',409);const file=join(this.directory,'audio',`${t.id}-${t.audio.sha256}.${t.audio.extension}`);if((await stat(file)).size!==t.audio.bytes)throw new StudioError('音频文件已变化，请检查本机保存内容。',409);const data=await readFile(file);if(createHash('sha256').update(data).digest('hex')!==t.audio.sha256)throw new StudioError('音频校验不一致，未提供此文件。',409);return {data,type:t.audio.type};}
  async cancel(id,taskId){await this.transition(id,taskId,{state:'cancelled',error:'已停止本机等待。已经发出的外部任务可能继续处理，请核查其记录。'},['prepared','queued','running']);this.controllers.get(taskId)?.abort();return this.get(id);}
  async review(id,taskId,input){return this.transaction(async()=>{const p=this.get(id),index=p.tasks.findIndex(t=>t.id===taskId);if(index<0)throw new StudioError('找不到这次任务。',404);p.tasks[index]=reviewTask(p.tasks[index],input);if(input.favorite===true)p.favorite=taskId;else if(input.favorite===false&&p.favorite===taskId)p.favorite=null;p.updatedAt=new Date().toISOString();return this.commit(p);});}
  async close(){await this.remote.disable();this.closed=true;for(const controller of this.controllers.values())controller.abort();await this.transactions;for(const p of this.projects.values()){const copy=structuredClone(p);let changed=false;for(const t of copy.tasks)if(isActive(t)){t.state='interrupted';t.error='本机服务停止，未自动重试。';changed=true;}if(changed){try{await this.commit(copy);}catch{}}}await this.tail;}
}
