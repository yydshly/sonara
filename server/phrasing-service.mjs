import {mkdir,readFile,writeFile,readdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ServiceError} from './generation-service.mjs';
import {hash} from './song-project.mjs';
import {applyPhrasing,focusChoices} from './emotion-phrasing.mjs';
import {applyExpression} from './expression-plan.mjs';
import {runProcess} from './codex-composer.mjs';
import {scoreMidi} from './score-midi.mjs';
import {validAudio} from './song-project-service.mjs';
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/;
const active=j=>['composing','singing'].includes(j.state);
export class PhrasingService{
  constructor({root,project,composer,connection,directory=join(root,'.local/song-phrasing'),worker}){Object.assign(this,{root,project,composer,connection,directory,worker});this.jobs=new Map();this.serial=Promise.resolve();this.closed=false;this.running=null;}
  exclusive(fn){const p=this.serial.then(fn);this.serial=p.catch(()=>{});return p;}
  async persist(job){const path=join(this.directory,job.id);await mkdir(path,{recursive:true});const temp=join(path,randomUUID()+'.tmp');await writeFile(temp,JSON.stringify(job,null,2));await rename(temp,join(path,'job.json'));}
  async init(){await mkdir(this.directory,{recursive:true});for(const id of await readdir(this.directory))if(uuid.test(id)){let data;try{data=await readFile(join(this.directory,id,'job.json'),'utf8');}catch(e){if(e.code==='ENOENT')continue;throw e;}const job=JSON.parse(data);if(job.id!==id)throw Error('Invalid record');if(active(job)){job.state='interrupted';job.message='上次处理已中断；已有草稿保留，不会自动重试。';await this.persist(job);}this.jobs.set(id,job);}return this;}
  snapshot(){return structuredClone({connection:this.connection,available:this.project.available,focusChoices,jobs:[...this.jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))});}
  get(id){const j=this.jobs.get(id);if(!j)throw new ServiceError('找不到这份乐句草稿。',404);return j;}
  async intact(job){if(hash(await this.project.fingerprints())!==hash(job.sourceHashes))throw new ServiceError('原始素材已改变，请重新准备草稿。',409);}
  create(input){return this.exclusive(async()=>{
    if(!input||!uuid.test(input.requestId)||!Object.hasOwn(focusChoices,input.focus)||!(input.sectionId==='all'||this.project.score.phrases.some(p=>p.section===input.sectionId)))throw new ServiceError('请选择有效的范围与打磨重点。');
    if((input.expression!==undefined&&typeof input.expression!=='boolean')||(input.rewriteLyrics!==undefined&&typeof input.rewriteLyrics!=='boolean')||(input.rewriteLyrics&&!input.expression))throw new ServiceError('表达与改词范围无效。');
    if(input.feedback!==undefined&&(typeof input.feedback!=='string'||input.feedback.length>600))throw new ServiceError('请用不超过 600 字说明听感。');
    const request={revision:input.revision,sectionId:input.sectionId,focus:input.focus,...(input.expression?{expression:true,rewriteLyrics:!!input.rewriteLyrics,feedback:input.feedback?.trim()||''}:{})},prior=[...this.jobs.values()].find(j=>j.requestId===input.requestId);if(prior){if(hash(request)!==hash(prior.request))throw new ServiceError('重复请求的内容发生了变化。',409);return structuredClone(prior);}
    if(this.closed||!this.connection.ready)throw new ServiceError('词曲模型暂不可用。',503);if(this.running)throw new ServiceError('已有词曲或演唱正在处理，请等待或取消。',409);
    const draft=structuredClone(this.project.draft);if(input.revision!==draft.revision||!draft.revision)throw new ServiceError('请先保存当前创作依据，再生成乐句草稿。',409);
    const sourceHashes=await this.project.fingerprints();if(sourceHashes['score.json']!==this.project.scoreSourceHash)throw new ServiceError('原始乐谱已改变，请重新启动服务。',409);if(this.closed)throw new ServiceError('服务正在关闭。',503);
    const job={id:randomUUID(),requestId:input.requestId,request,number:this.jobs.size+1,createdAt:new Date().toISOString(),state:'composing',message:'正在根据目标与段落意图设计逐字节奏',brief:draft.brief,baseScore:structuredClone(this.project.score),sourceHashes,scope:{preserve:['原歌词与逐字音高','原和声、伴奏、段落结构和速度'],change:'在新版本中调整选中乐句的逐字时值与句首句尾留白，并重新合成这些句子的演唱。'}};
    if(request.expression){job.message=request.rewriteLyrics?'正在结合故事与情绪打磨歌词和演唱方案':'正在根据内容与情绪设计逐字唱法';job.scope={preserve:[...(request.rewriteLyrics?['选定段落外的歌词','标题句']:['原歌词与发音']),'逐字音高、原和声、伴奏、结构与速度'],change:'选定段落的逐字时值、气声、发声张力、元音过渡速度'+(request.rewriteLyrics?'，以及等字数歌词与发音。':'。')};}
    await this.persist(job);this.jobs.set(job.id,job);this.start(job,'compose');return structuredClone(job);
  });}
  start(job,stage){const controller=new AbortController();this.running={id:job.id,controller};this.completion=this.run(job,stage,controller);}
  render(id,input){return this.exclusive(async()=>{const job=this.get(id);if(input?.scoreHash!==job.scoreHash||!job.prepared)throw new ServiceError('请先查看这一版的词曲变化，再确认演唱。',409);if(job.state==='succeeded'||job.state==='singing')return structuredClone(job);if(this.closed||!this.project.available)throw new ServiceError('本机歌声合成暂不可用。',503);if(this.running)throw new ServiceError('已有制作正在进行。',409);await this.intact(job);if(this.closed)throw new ServiceError('服务正在关闭。',503);const next={...job,state:'singing',message:`正在按新节奏演唱 ${job.changes.length} 句，原版可继续试听`};await this.persist(next);Object.assign(job,next);this.start(job,'sing');return structuredClone(job);});}
  async run(job,stage,controller){const path=join(this.directory,job.id);try{
    if(controller.signal.aborted||this.closed)return;let next;
    if(stage==='compose'){
      const raw=await this.composer.phrase({path,brief:job.brief,score:job.baseScore,...job.request,signal:controller.signal});if(controller.signal.aborted)return;
      const proposal=job.request.expression?applyExpression(raw,job.baseScore,job.request.sectionId,job.request):applyPhrasing(raw,job.baseScore,job.request.sectionId);await this.intact(job);
      await writeFile(join(path,'score.json'),JSON.stringify(proposal.score));await writeFile(join(path,'melody.mid'),scoreMidi(proposal.score,proposal.score.lyrics));await writeFile(join(path,'request.json'),JSON.stringify({source:this.project.source,sourceHashes:job.sourceHashes,baseScore:job.baseScore,changes:proposal.changes,scoreHash:proposal.scoreHash,sectionId:job.request.sectionId,...(job.request.expression?{expression:true,rewriteLyrics:job.request.rewriteLyrics}:{})}));
      await this.workerRun(path,'prepare',controller.signal);
      const preview=JSON.parse(await readFile(join(path,'preview.json'),'utf8'));
      const selected=job.baseScore.phrases.filter(p=>job.request.sectionId==='all'||p.section===job.request.sectionId),offset=job.request.sectionId==='all'?0:selected[0].start,end=job.request.sectionId==='all'?job.baseScore.duration:selected.at(-1).end;
      if(preview.scoreHash!==proposal.scoreHash||preview.offset!==offset||Math.abs(preview.duration-(end-offset))>1/44100)throw Error('Invalid preview');
      for(const name of ['preview-A.wav','preview-B.wav'])if(!validAudio(await readFile(join(path,name)),{sampleRate:44100,duration:preview.duration}))throw Error('Invalid preview audio');
      next={...job,...proposal,preview,prepared:true,state:'draft',message:job.request.expression?'表达方案已准备好。先核对字句、唱法与范围，确认后生成新演唱。':'乐句草稿已准备好。先比较器乐示范，再确认重新演唱。'};
    }else{
      await this.workerRun(path,'sing',controller.signal);if(controller.signal.aborted)return;await this.intact(job);
      const result=JSON.parse(await readFile(join(path,'result.json'),'utf8'));
      if(result.scoreHash!==job.scoreHash||result.duration!==job.baseScore.duration||result.sampleRate!==44100||result.bitDepth!==24||result.unchangedOutsideRegions!==true||(!job.request.expression&&result.lyricsAndNotePitchesPreserved!==true)||!Number.isFinite(result.peak)||result.peak<=0||result.peak>=.99||hash(result.regions)!==hash(job.changes.map(c=>({index:c.index,start:c.start,end:c.end}))))throw Error('Invalid rendered result');
      if(job.request.expression){if(result.lyricsMatchApprovedScore!==true||result.notePitchesPreserved!==true||!Array.isArray(result.expressionEvidence)||result.expressionEvidence.length!==job.changes.length)throw Error('Missing expression evidence');for(const [i,c] of job.changes.entries()){const e=result.expressionEvidence[i];if(e.acousticInputsVerified!==true||e.index!==c.index||hash(e.requested)!==hash(c.delivery)||!['breathinessDb','tensionDb','velocity'].every(k=>Number.isInteger(e.curves?.[k]?.controlledFrames)&&e.curves[k].controlledFrames>=0&&/^[a-f\d]{64}$/.test(e.curves[k].afterHash)))throw Error('Invalid expression evidence');for(const [key,values] of Object.entries(c.delivery)){const curve=e.curves[key];if(values.some(v=>v!==(key==='velocity'?1:0))&&(!curve.controlledFrames||!/^[a-f\d]{64}$/.test(curve.beforeHash)||curve.beforeHash===curve.afterHash))throw Error('Expression controls had no effect');}}}
      for(const name of ['song.wav','vocal.wav']){const data=await readFile(join(path,name));if(hash(data)!==result.files?.[name]||!validAudio(data,job.baseScore))throw Error('Invalid audio');}
      next={...job,result,state:'succeeded',message:job.request.expression?'模型表达方案已合成为新演唱；歌词共鸣与声音效果等待试听':'新节奏演唱已完成；情绪与自然度等待真实试听',finishedAt:new Date().toISOString()};
    }
    await this.exclusive(async()=>{if(controller.signal.aborted)return;await this.persist(next);Object.assign(job,next);});
  }catch(e){await this.exclusive(async()=>{if(controller.signal.aborted)return;const next={...job,state:'failed',message:e instanceof ServiceError?e.message:stage==='compose'?'这次乐句草稿未完成；原作保留，没有自动重试。':'这次演唱未完成；乐句草稿保留，可重试。'};try{await this.persist(next);}catch{next.message='结果未能保存，没有发布新的试听。';}Object.assign(job,next);});}finally{if(this.running?.id===job.id)this.running=null;}}
  async workerRun(path,mode,signal){if(this.worker)return this.worker({path,mode,signal});const result=await runProcess(this.project.python,['-X','utf8','-u',join(this.root,'scripts/render-phrasing.py'),path,mode],{signal,timeout:mode==='sing'?600000:90000});await writeFile(join(path,mode+'.log'),result.stdout+'\n'+result.stderr);if(result.code!==0)throw Error('Worker failed');}
  cancel(id){return this.exclusive(async()=>{const job=this.get(id);if(active(job)){const next={...job,state:'cancelled',message:'已取消，原作与已完成的草稿保留。'};await this.persist(next);Object.assign(job,next);if(this.running?.id===id)this.running.controller.abort();}return structuredClone(job);});}
  review(id,input){return this.exclusive(async()=>{const job=this.get(id);if(job.state!=='succeeded'||!['closer','unsure','worse'].includes(input?.emotion)||!['better','unsure','worse'].includes(input?.musicality)||typeof input.note!=='string'||input.note.trim().length<2||input.note.length>1200||!Number.isFinite(input.at)||input.at<0||input.at>=job.baseScore.duration)throw new ServiceError('请记录情绪、音乐表达，以及一个具体时间点的问题。');const next={...job,review:{emotion:input.emotion,musicality:input.musicality,note:input.note.trim(),at:input.at,createdAt:new Date().toISOString()}};await this.persist(next);Object.assign(job,next);return structuredClone(job);});}
  async asset(id,kind){const job=this.get(id);if(kind==='record')return {data:Buffer.from(JSON.stringify({format:'sonara-emotion-phrasing-v1',job,quality:'未进行自动艺术质量判定',voice:'Ria / 狸安，RibosomeK；配套声码器为非商业许可。'},null,2)),type:'application/json; charset=utf-8'};
    if(kind==='lyrics'&&job.prepared)return {data:Buffer.from(job.score.lyrics.join('\n')),type:'text/plain; charset=utf-8'};
    const files={score:['score.json','application/json'],midi:['melody.mid','audio/midi'],before:['preview-A.wav','audio/wav'],after:['preview-B.wav','audio/wav'],song:['song.wav','audio/wav'],vocal:['vocal.wav','audio/wav']};if(!Object.hasOwn(files,kind)||!job.prepared||(['song','vocal'].includes(kind)&&job.state!=='succeeded'))throw new ServiceError('该试听还未准备好。',409);const [file,type]=files[kind];return {data:await readFile(join(this.directory,id,file)),type};}
  async close(){this.closed=true;await this.serial;try{if(this.running)await this.cancel(this.running.id);}finally{this.running?.controller.abort();await this.completion;}}
}
