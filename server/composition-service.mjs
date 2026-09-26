import {mkdir,readFile,writeFile,readdir,rename,access,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {ServiceError} from './generation-service.mjs';
import {CodexComposer,runProcess} from './codex-composer.mjs';
import {validateComposition} from './composition-score.mjs';
import {validateExpressiveScore,applyExpressiveRevision} from './expressive-score.mjs';
import {prepareCompositionAudio} from './composition-audio.mjs';
import {applyRevision,validateRevisionRequest,scoreHash} from './composition-revision.mjs';
import {validateCreativeBrief} from './creative-brief.mjs';
import {validateMusicDirection} from './music-direction.mjs';
import {musicStyles,singerChoices} from '../dist/music-styles.mjs';
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/;
const active=j=>['composing','singing'].includes(j.state);
export class CompositionService{
  constructor({root,directory=join(root,'.local/compositions'),composer=new CodexComposer(),prepare=prepareCompositionAudio,worker}={}){
    Object.assign(this,{root,directory,composer,prepare,worker});this.jobs=new Map();this.controllers=new Map();this.serial=Promise.resolve();this.tail=Promise.resolve();this.closed=false;
    this.python=join(root,'.local/score-trial/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  }
  async init(){
    this.connection=await this.composer.status();this.singerReady=!!this.worker||await access(this.python).then(()=>true,()=>false);
    this.voices={ria:this.singerReady,qixuan:!!this.worker||(this.singerReady&&await access(join(this.root,'.local/voice-comparison/qixuan/Qixuan_v2.7.0_DiffSinger_OpenUtau/dsvocoder/vocoder.yaml')).then(()=>true,()=>false))};
    await mkdir(this.directory,{recursive:true});
    for(const id of await readdir(this.directory))if(uuid.test(id)){
      try{const job=JSON.parse(await readFile(join(this.directory,id,'job.json'),'utf8'));if(job.id!==id)continue;if(active(job)){job.state='interrupted';job.message='上次处理已中断，已有词曲仍保留；不会自动重试。';await this.persist(job);}this.jobs.set(id,job);}catch(error){if(error.code!=='ENOENT')throw error;}
    }return this;
  }
  exclusive(action){const promise=this.serial.then(action);this.serial=promise.catch(()=>{});return promise;}
  async persist(job){const path=join(this.directory,job.id);await mkdir(path,{recursive:true});const temp=join(path,randomUUID()+'.tmp');await writeFile(temp,JSON.stringify(job,null,2));await rename(temp,join(path,'job.json'));}
  snapshot(){return {connection:this.connection,singerReady:this.singerReady,musicCapabilities:{styles:musicStyles.map(({writing,...style})=>style),voices:singerChoices.map(v=>({...v,ready:this.voices[v.id]})),minBpm:72,maxBpm:144},jobs:[...this.jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(j=>({...structuredClone(j),projectId:j.projectId||j.id,version:j.version||1}))};}
  get(id){const job=this.jobs.get(id);if(!job)throw new ServiceError('找不到这份词曲。',404);return job;}
  schedule(job,stage){
    this.tail=this.tail.then(()=>this.run(job,stage)).catch(()=>this.exclusive(async()=>{if(active(job)){job.state='failed';job.message='本机保存出现异常，未发布新结果。';try{await this.persist(job);}catch{}}}));
  }
  create(input){return this.exclusive(async()=>{
    if(this.closed||!this.connection.ready)throw new ServiceError('Codex 暂不可用，请检查本机登录后重启工作台。',503);
    if(!input||!uuid.test(input.requestId)||typeof input.idea!=='string'||input.idea.trim().length<4||input.idea.length>1200)throw new ServiceError('请用 4–1200 个字描述创作想法。');
    if(input.creationMode!==undefined&&input.creationMode!=='expressive')throw new ServiceError('不支持这个创作模式。');
    const idea=input.idea.trim(),brief=validateCreativeBrief(input.brief),music=validateMusicDirection(input.music),prior=[...this.jobs.values()].find(j=>j.requestId===input.requestId);
    if(prior){if(prior.revision||prior.arrangement||prior.idea!==idea||prior.creationMode!==input.creationMode||JSON.stringify(prior.brief??null)!==JSON.stringify(brief)||JSON.stringify(prior.music??null)!==JSON.stringify(music))throw new ServiceError('这次请求的想法、情绪或音乐设置已变化，请重新提交。',409);return structuredClone(prior);}
    if(music&&!this.voices[music.voice])throw new ServiceError('选定声库尚未在本机准备好，请换一个声线。',503);
    if([...this.jobs.values()].some(active))throw new ServiceError('已有创作正在处理，请完成或取消后再开始。',409);
    const id=randomUUID(),job={id,projectId:id,version:1,requestId:input.requestId,idea,state:'composing',stage:'compose',createdAt:new Date().toISOString(),message:'Codex 正在写歌词与旋律',prepared:false};
    if(brief)job.brief=brief;
    if(music)job.music=music;
    if(input.creationMode){job.creationMode=input.creationMode;job.message='正在一起构思歌词、旋律、唱法和伴奏';}
    await this.persist(job);this.jobs.set(job.id,job);this.schedule(job,'compose');return structuredClone(job);
  });}
  revise(id,input){return this.exclusive(async()=>{
    if(!input||!uuid.test(input.requestId))throw new ServiceError('修改请求无效。');
    const request={baseVersion:id,...validateRevisionRequest(input)},prior=[...this.jobs.values()].find(j=>j.requestId===input.requestId);
    if(prior){if(JSON.stringify(prior.revision)!==JSON.stringify(request))throw new ServiceError('同一次请求的修改内容已变化，请重新提交。',409);return structuredClone(prior);}
    if(this.closed||!this.connection.ready)throw new ServiceError('Codex 暂不可用。',503);
    const base=this.get(id);if(base.state!=='succeeded')throw new ServiceError('请先完成这个版本的演唱，再进行局部修改。',409);
    if(request.mode==='performance'&&base.score.format!=='expressive-v1')throw new ServiceError('这个早期作品不包含逐字演唱设计，请使用词句与断句修改。');
    if([...this.jobs.values()].some(active))throw new ServiceError('已有任务正在处理，请完成或取消后再试。',409);
    const projectId=base.projectId||base.id,version=Math.max(...[...this.jobs.values()].filter(j=>(j.projectId||j.id)===projectId).map(j=>j.version||1))+1;
    const job={id:randomUUID(),requestId:input.requestId,projectId,version,baseVersion:id,revision:request,idea:base.idea,state:'composing',stage:'revision',createdAt:new Date().toISOString(),prepared:false,message:`正在准备第 ${request.lineIndex+1} 句的修改稿，原版可以继续试听`};
    if(base.brief)job.brief=structuredClone(base.brief);
    if(base.music)job.music=structuredClone(base.music);
    if(base.creationMode)job.creationMode=base.creationMode;
    await this.persist(job);this.jobs.set(job.id,job);this.schedule(job,'revision');return structuredClone(job);
  });}
  rearrange(id,input){return this.exclusive(async()=>{
    if(!input||!uuid.test(input.requestId))throw new ServiceError('编配请求无效。');
    const music=validateMusicDirection(input.music);if(!music)throw new ServiceError('请选择音乐方向。');
    const arrangement={baseVersion:id,music},prior=[...this.jobs.values()].find(j=>j.requestId===input.requestId);
    if(prior){if(JSON.stringify(prior.arrangement)!==JSON.stringify(arrangement))throw new ServiceError('同一次请求的音乐设置已变化。',409);return structuredClone(prior);}
    if(this.closed||!this.voices[music.voice])throw new ServiceError('本机声库暂不可用。',503);
    const base=this.get(id);if(!base.prepared)throw new ServiceError('先完成词曲草稿，再调整音乐方向。',409);
    if(base.score.format==='expressive-v1')throw new ServiceError('这份作品的伴奏是逐音符创作的。目前可以局部改词曲与唱法；更换整体音乐方向请保留本版并开始新作品。',409);
    if([...this.jobs.values()].some(active))throw new ServiceError('已有创作正在处理，请完成或取消后再试。',409);
    if(JSON.stringify(base.score.music)===JSON.stringify(music))throw new ServiceError('音乐设置没有变化，当前版本可继续试听。');
    const projectId=base.projectId||base.id,version=Math.max(...[...this.jobs.values()].filter(j=>(j.projectId||j.id)===projectId).map(j=>j.version||1))+1;
    const job={id:randomUUID(),requestId:input.requestId,projectId,version,baseVersion:id,arrangement,music,idea:base.idea,state:'composing',stage:'arrangement',createdAt:new Date().toISOString(),prepared:false,message:'正在按新的速度和风格制作器乐试听，原版保留'};
    if(base.brief)job.brief=structuredClone(base.brief);
    await this.persist(job);this.jobs.set(job.id,job);this.schedule(job,'arrangement');return structuredClone(job);
  });}
  render(id,confirmation={}){return this.exclusive(async()=>{
    const job=this.get(id);if(job.state==='singing'||job.state==='succeeded')return structuredClone(job);
    if(this.closed||!this.singerReady)throw new ServiceError('本机歌声合成暂不可用。',503);
    if(!job.prepared)throw new ServiceError('先完成词曲草稿。',409);
    if((job.revision||job.arrangement)&&confirmation.scoreHash!==job.scoreHash)throw new ServiceError('请重新查看修改稿，再确认生成这一版。',409);
    if([...this.jobs.values()].some(active))throw new ServiceError('已有任务正在处理。',409);
    const next={...job,state:'singing',stage:'sing',message:job.revision?`正在重新演唱第 ${job.revision.lineIndex+1} 句，其余音频直接保留`:job.arrangement&&job.difference.reuseVocal?'正在将新伴奏与原人声混合':'正在按确认的乐谱逐句合成演唱，原版可以继续试听'};await this.persist(next);Object.assign(job,next);this.schedule(job,'sing');return structuredClone(job);
  });}
  async run(job,stage){
    const controller=new AbortController();await this.exclusive(()=>{if(active(job)&&!this.closed)this.controllers.set(job.id,controller);});
    if(!this.controllers.has(job.id)||!active(job)||this.closed)return;
    const path=join(this.directory,job.id);
    try{
      let next;
      if(stage==='arrangement'){
        const base=this.get(job.baseVersion),source={title:base.score.title,description:base.score.description,bpm:job.music.bpm,phrases:base.score.phrases.map(p=>({lyrics:p.lyrics,chords:[...p.chords],notes:p.notes.map(n=>({midi:n.midi,beats:n.beats,pinyin:n.pinyin,...(n.restAfter?{restAfter:n.restAfter}:{})}))}))};
        const score=validateComposition(source,job.music);if(job.brief)score.creativeBrief=structuredClone(job.brief);
        const reuseVocal=base.state==='succeeded'&&score.bpm===base.score.bpm&&job.music.voice===(base.score.music?.voice||'ria');
        await writeFile(join(path,'score.json'),JSON.stringify(score,null,2));await this.runWorker(path,'check',controller.signal);if(controller.signal.aborted)return;
        await this.prepare(path,score,{signal:controller.signal});
        const sourceFileHash=createHash('sha256').update(await readFile(join(this.directory,base.id,'score.json'))).digest('hex');
        await writeFile(join(path,'rearrangement.json'),JSON.stringify({basePath:join(this.directory,base.id),reuseVocal,sourceFileHash}));
        const difference={mode:'arrangement',description:reuseVocal?'重新编配伴奏，确认后使用原人声混合。':'按新速度与声线重新演唱全部四句，歌词、音符音高和以拍计的节奏保持。',before:base.score.music||{style:'legacy',bpm:base.score.bpm,voice:'ria'},after:job.music,reuseVocal,region:{start:0,end:score.duration},preserved:['歌词与发音','旋律音高、和弦','音符之间的拍数关系']};
        next={...job,state:'draft',message:'新的速度与编配已可试听，确认后制作这一版演唱',score,scoreHash:scoreHash(score),difference,prepared:true,composedAt:new Date().toISOString()};
      }else if(stage==='compose'||stage==='revision'){
        const base=job.revision?this.get(job.baseVersion):null;
        const availableVoices=Object.keys(this.voices).filter(v=>this.voices[v]);
        const raw=base?await this.composer.revise({path,base:structuredClone(base.score),request:structuredClone(job.revision),signal:controller.signal}):await this.composer.compose({path,idea:job.idea,brief:structuredClone(job.brief??null),music:structuredClone(job.music??null),creationMode:job.creationMode,availableVoices,signal:controller.signal});
        if(controller.signal.aborted)return;
        const proposal=base?(base.score.format==='expressive-v1'?applyExpressiveRevision:applyRevision)(base.score,raw,job.revision):{score:job.creationMode==='expressive'?validateExpressiveScore(raw,job.music,availableVoices):validateComposition(raw,job.music)};
        const {score}=proposal;if(job.brief)score.creativeBrief=structuredClone(job.brief);await writeFile(join(path,'score.json'),JSON.stringify(score,null,2));
        await this.runWorker(path,'check',controller.signal);if(controller.signal.aborted)return;
        await this.prepare(path,score,{signal:controller.signal});
        if(base){await copyFile(join(this.directory,base.id,'accompaniment.wav'),join(path,'accompaniment.wav'));for(const name of ['arrangement.mid','arrangement.json']){try{await copyFile(join(this.directory,base.id,name),join(path,name));}catch(e){if(e.code!=='ENOENT')throw e;}}await writeFile(join(path,'revision.json'),JSON.stringify({basePath:join(this.directory,base.id),mode:job.revision.mode,lineIndex:job.revision.lineIndex}));}
        next={...job,state:'draft',message:base?'修改稿已准备好；还未改变任何已有演唱。检查差异后再确认。':'词曲已写好，先听旋律，再决定是否演唱',score,scoreHash:scoreHash(score),difference:proposal.difference,prepared:true,composedAt:new Date().toISOString()};
      }else{
        await this.runWorker(path,'sing',controller.signal);
        const result=JSON.parse(await readFile(join(path,'result.json'),'utf8'));
        if(result.sampleRate!==job.score.sampleRate||result.duration!==job.score.duration||result.bitDepth!==24||!Number.isFinite(result.peak)||result.peak<=0||result.peak>=.99)throw Error('Audio check failed');
        if(job.revision&&(result.unchangedOutsideRegion!==true||result.changedRegion?.start!==job.difference.region.start||result.changedRegion?.end!==job.difference.region.end||(['lyrics','performance'].includes(job.revision.mode)&&result.identicalPitchControl!==true)))throw Error('Preservation check failed');
        if(job.revision?.mode==='performance'&&result.otherPerformanceCurvesPreserved!==true)throw Error('Unselected performance controls changed');
        if(job.arrangement&&(result.reusedVocal!==job.difference.reuseVocal||result.scoreNotesPreserved!==true))throw Error('Arrangement preservation check failed');
        for(const name of ['song','vocal']){const wav=await readFile(join(path,name+'.wav'));if(wav.length<1000||wav.subarray(0,4).toString()!=='RIFF'||wav.subarray(8,12).toString()!=='WAVE')throw Error('Invalid WAV');}
        next={...job,state:'succeeded',message:'演唱已完成，词曲和音频均已保存',result,finishedAt:new Date().toISOString()};
      }
      await this.exclusive(async()=>{if(controller.signal.aborted||!active(job))return;await this.persist(next);Object.assign(job,next);});
    }catch(error){await this.exclusive(async()=>{
      if(controller.signal.aborted||!active(job))return;const message=error instanceof ServiceError?error.message:stage==='arrangement'?'这次编配未完成，原版保留。请检查本机乐器工具后重试。':stage==='compose'||stage==='revision'?'这次词曲创作未完成。请检查 Codex 连接或重新描述想法；未自动重试。':'这次演唱未完成，词曲和旋律试听仍然保留，可再次尝试。';
      const next={...job,state:'failed',message};await this.persist(next);Object.assign(job,next);
    });}finally{this.controllers.delete(job.id);}
  }
  async runWorker(path,mode,signal){
    if(this.worker)return this.worker({path,mode,signal});
    const result=await runProcess(this.python,['-X','utf8','-u',join(this.root,'scripts/render-composition.py'),path,mode],{signal,timeout:mode==='check'?20000:300000});
    await writeFile(join(path,mode+'-log.txt'),result.stdout+'\n'+result.stderr);if(result.code!==0)throw Error('Voice worker did not complete');
  }
  cancel(id){return this.exclusive(async()=>{const job=this.get(id);if(active(job)){const next={...job,state:'cancelled',message:'已取消这次处理，已有成果保留'};await this.persist(next);Object.assign(job,next);this.controllers.get(id)?.abort();}return structuredClone(job);});}
  async asset(id,kind){
    const job=this.get(id),files={score:['score.json','application/json'],lyrics:['lyrics.txt','text/plain; charset=utf-8'],midi:['melody.mid','audio/midi'],arrangement:['arrangement.mid','audio/midi'],instruments:['arrangement.json','application/json'],guide:['guide.wav','audio/wav'],backing:['accompaniment.wav','audio/wav'],song:['song.wav','audio/wav'],vocal:['vocal.wav','audio/wav']};
    if(!Object.hasOwn(files,kind))throw new ServiceError('找不到文件。',404);
    if(['arrangement','instruments'].includes(kind)&&!job.score?.music)throw new ServiceError('早期版本没有采样编配工程。',404);
    if(!job.prepared||(['song','vocal'].includes(kind)&&job.state!=='succeeded'))throw new ServiceError('这份结果尚未完成。',409);
    const [file,type]=files[kind];return {data:await readFile(join(this.directory,job.id,file)),type};
  }
  async close(){this.closed=true;await this.exclusive(async()=>{for(const job of this.jobs.values())if(active(job)){this.controllers.get(job.id)?.abort();job.state='interrupted';job.message='本机服务已停止，已有成果保留';try{await this.persist(job);}catch{}}});await this.tail;}
}
