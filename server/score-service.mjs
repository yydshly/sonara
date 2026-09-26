import {access,mkdir,readdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {ServiceError} from './generation-service.mjs';

const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/;
const active=job=>['queued','running'].includes(job.state);
export function normalizeLyrics(value){
  if(typeof value!=='string'||value.length>100)throw new ServiceError('请填写 8 个中文汉字。');
  const lyrics=value.replace(/[\s，。！？、,.!?；;：:]/g,'');
  if(!/^[\u3400-\u9fff]{8}$/.test(lyrics))throw new ServiceError('每句需为 8 个中文汉字，以保持原来的旋律和节奏。');
  return lyrics;
}
export class ScoreService{
  constructor({root,directory=join(root,'.local/score-edits'),runner,previewer}){
    Object.assign(this,{root,directory,runner,previewer});this.jobs=new Map();this.serial=Promise.resolve();this.tail=Promise.resolve();this.controllers=new Map();this.closed=false;
    this.python=join(root,'.local/score-trial/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  }
  async init(){
    this.score=JSON.parse(await readFile(join(this.root,'dist/score-trial/score.json'),'utf8'));
    this.ready=!!this.runner||await Promise.all([this.python,'scripts/render-score-edit.py','.local/score-trial/voicebank/ria-lynxnet.onnx',...Array.from({length:4},(_,i)=>`.local/score-trial/rendered-phrases/A-${i+1}.ds`),'dist/score-trial/song-A.wav','dist/score-trial/vocal-A.wav','dist/score-trial/song-B.wav','dist/score-trial/vocal-B.wav'].map(path=>access(path===this.python?path:join(this.root,path)))).then(()=>true,()=>false);
    await mkdir(this.directory,{recursive:true});
    for(const name of await readdir(this.directory))if(uuid.test(name)){
      try{const job=JSON.parse(await readFile(join(this.directory,name,'job.json'),'utf8'));if(job.id!==name)continue;
        if(active(job)){job.state='interrupted';job.message='本机服务曾中断，原版本已保留。可以重新检查歌词后生成。';await this.persist(job);}this.jobs.set(job.id,job);
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }
    return this;
  }
  exclusive(action){const run=this.serial.then(action);this.serial=run.catch(()=>{});return run;}
  async persist(job){const path=join(this.directory,job.id);await mkdir(path,{recursive:true});const temp=join(path,`${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(job,null,2));await rename(temp,join(path,'job.json'));}
  publicJob(job){return structuredClone(job);}
  get(id){const job=this.jobs.get(id);if(!job)throw new ServiceError('找不到这次试唱。',404);return job;}
  version(id){
    if(['A','B'].includes(id))return {id,name:id==='A'?'原始试唱':'示例 · 第二句改词',lyrics:id==='A'?this.score.lyrics:this.score.revisedLyrics,pinyin:this.score.phrases.map(p=>p.notes.map(n=>id==='A'?n.pinyin:n.revisedPinyin)),builtIn:true};
    const job=this.get(id);if(job.state!=='succeeded')throw new ServiceError('此版本尚未完成。',409);return {id:job.id,name:`第 ${job.lineIndex+1} 句 · ${job.lyrics[job.lineIndex]}`,lyrics:job.lyrics,pinyin:job.pinyin,baseVersion:job.baseVersion,createdAt:job.createdAt,result:job.result};
  }
  snapshot(){const ordered=[...this.jobs.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt));return {ready:this.ready,score:this.score,versions:[this.version('A'),this.version('B'),...ordered.filter(j=>j.state==='succeeded').map(j=>this.version(j.id))],jobs:ordered.slice().reverse(),message:this.ready?'本机歌声合成已就绪':'本机歌声环境尚未准备好，可试听已有版本。'};}
  async preview(input){
    if(!input||typeof input!=='object')throw new ServiceError('歌词请求无效。');
    if(this.closed||!this.ready)throw new ServiceError('本机歌声合成暂不可用。',503);
    const lyrics=normalizeLyrics(input.lyrics);
    if(input.pinyin!==undefined&&(!Array.isArray(input.pinyin)||input.pinyin.length!==8||!input.pinyin.every(p=>typeof p==='string'&&/^[a-zv]{1,6}$/.test(p))))throw new ServiceError('请为每个字填写不带声调的小写拼音。');
    if(this.previewer)return this.previewer({lyrics,pinyin:input.pinyin});
    return new Promise((resolve,reject)=>{
      const child=spawn(this.python,['-X','utf8',join(this.root,'scripts/score-lyrics.py')],{windowsHide:true,stdio:['pipe','pipe','pipe']});let text='';
      const timer=setTimeout(()=>{child.kill();reject(new ServiceError('检查拼音超时，请重试。',503));},20000);
      child.stdout.on('data',data=>{text+=data;if(text.length>20000)child.kill();});child.stderr.resume();
      child.on('error',()=>{clearTimeout(timer);reject(new ServiceError('无法启动本机拼音检查。',503));});
      child.on('close',code=>{clearTimeout(timer);try{const result=JSON.parse(text);if(code!==0||result.error)throw new ServiceError(result.error||'拼音检查失败。');resolve(result);}catch(error){reject(error instanceof ServiceError?error:new ServiceError('本机拼音检查失败。',503));}});
      child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({lyrics,pinyin:input.pinyin}));
    });
  }
  create(input){return this.exclusive(async()=>{
    if(!input||typeof input!=='object')throw new ServiceError('修改请求无效。');
    if(this.closed||!this.ready)throw new ServiceError('本机歌声合成暂不可用。',503);
    if(!uuid.test(input.requestId)||!Number.isInteger(input.lineIndex)||input.lineIndex<0||input.lineIndex>3)throw new ServiceError('修改请求无效。');
    const request={requestId:input.requestId,baseVersion:input.baseVersion,lineIndex:input.lineIndex,lyrics:normalizeLyrics(input.lyrics),pinyin:input.pinyin};
    const prior=[...this.jobs.values()].find(j=>j.request.requestId===request.requestId);
    if(prior){if(JSON.stringify(prior.request)!==JSON.stringify(request))throw new ServiceError('同一次请求内容已变化，请重新检查歌词。',409);return this.publicJob(prior);}
    if([...this.jobs.values()].some(active))throw new ServiceError('已有一句正在生成，请先完成或取消。',409);
    const base=this.version(request.baseVersion),prepared=await this.preview(request);
    if(prepared.lyrics===base.lyrics[request.lineIndex]&&JSON.stringify(prepared.pinyin)===JSON.stringify(base.pinyin[request.lineIndex]))throw new ServiceError('歌词和拼音没有变化，可以直接试听当前版本。');
    const job={id:randomUUID(),request,baseVersion:base.id,lineIndex:request.lineIndex,lyrics:structuredClone(base.lyrics),pinyin:structuredClone(base.pinyin),state:'queued',createdAt:new Date().toISOString(),message:'正在准备本机试唱'};
    job.lyrics[job.lineIndex]=prepared.lyrics;job.pinyin[job.lineIndex]=prepared.pinyin;
    await this.persist(job);this.jobs.set(job.id,job);
    this.tail=this.tail.then(()=>this.run(job)).catch(()=>this.exclusive(async()=>{if(active(job)){job.state='interrupted';job.message='本机保存出现异常，原版本保持不变';try{await this.persist(job);}catch{}}}));return this.publicJob(job);
  });}
  audioPath(id,kind){this.version(id);return ['A','B'].includes(id)?join(this.root,`dist/score-trial/${kind}-${id}.wav`):join(this.directory,id,`${kind}.wav`);}
  async run(job){
    const controller=new AbortController();
    await this.exclusive(async()=>{if(job.state!=='queued'||this.closed)return;job.state='running';await this.persist(job);this.controllers.set(job.id,controller);});
    if(job.state!=='running'||this.closed)return;
    const path=join(this.directory,job.id);
    try{
      await writeFile(join(path,'request.json'),JSON.stringify({lineIndex:job.lineIndex,lyrics:job.lyrics[job.lineIndex],pinyin:job.pinyin[job.lineIndex],baseSong:this.audioPath(job.baseVersion,'song'),baseVocal:this.audioPath(job.baseVersion,'vocal')}));
      const progress=message=>this.exclusive(async()=>{if(job.state!=='running')return;job.message=message;await this.persist(job);});
      if(this.runner)await this.runner({path,job,signal:controller.signal,progress});else await this.spawnWorker(path,controller.signal,progress);
      const result=JSON.parse(await readFile(join(path,'result.json'),'utf8'));
      if(result.unchangedOutsideRegion!==true||result.identicalPitchControl!==true||result.sampleRate!==this.score.sampleRate||result.duration!==this.score.duration||!Number.isFinite(result.peak)||result.peak<=0||result.peak>=.99)throw Error('Output verification failed');
      for(const file of ['song.wav','vocal.wav'])if((await stat(join(path,file))).size<1000)throw Error('Missing audio');
      await this.exclusive(async()=>{if(job.state!=='running')return;const saved={...job,state:'succeeded',message:'新版本已保存，原版本保持不变',result,finishedAt:new Date().toISOString()};await this.persist(saved);Object.assign(job,saved);});
    }catch(error){await this.exclusive(async()=>{if(job.state!=='running')return;job.state='failed';job.message='这次试唱未完成，原版本保持不变。请检查拼音后重试；详细原因已保存在本机处理记录中。';await this.persist(job);});}
    finally{this.controllers.delete(job.id);}
  }
  spawnWorker(path,signal,progress){return new Promise((resolve,reject)=>{
    if(signal.aborted)return reject(Error('Cancelled'));
    const child=spawn(this.python,['-X','utf8','-u',join(this.root,'scripts/render-score-edit.py'),path],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const log=createWriteStream(join(path,'render.log'));let pending='';
    const abort=()=>child.kill();signal.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>child.kill(),5*60*1000);
    child.stdout.on('data',data=>{log.write(data);pending+=data;const lines=pending.split('\n');pending=lines.pop();for(const line of lines)if(line.startsWith('SONARA_PROGRESS ')){try{const item=JSON.parse(line.slice(16));progress(String(item.message).slice(0,160)).catch(()=>child.kill());}catch{}}});
    child.stderr.on('data',data=>log.write(data));log.on('error',()=>child.kill());
    child.on('error',error=>{clearTimeout(timer);signal.removeEventListener('abort',abort);log.end();reject(error);});
    child.on('close',code=>{clearTimeout(timer);signal.removeEventListener('abort',abort);log.end();code===0&&!signal.aborted?resolve():reject(Error('Renderer stopped'));});
  });}
  cancel(id){return this.exclusive(async()=>{const job=this.get(id);if(active(job)){job.state='cancelled';job.message='已取消试唱，原版本保持不变';this.controllers.get(id)?.abort();await this.persist(job);}return this.publicJob(job);});}
  async audio(id,kind){if(!['song','vocal'].includes(kind))throw new ServiceError('音频类型无效。');return readFile(this.audioPath(id,kind));}
  async close(){this.closed=true;await this.exclusive(async()=>{for(const job of this.jobs.values())if(active(job)){job.state='interrupted';job.message='本机服务已停止，原版本保持不变';this.controllers.get(job.id)?.abort();await this.persist(job);}});await this.tail;}
}
