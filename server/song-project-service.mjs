import {mkdir,readFile,writeFile,rename,readdir,access} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ServiceError} from './generation-service.mjs';
import {runProcess} from './codex-composer.mjs';
import {hash,initialBrief,validateBrief,compilePlan,recipes} from './song-project.mjs';

const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/;
const sources=['score.json','song.wav','accompaniment.wav','vocal.wav','piano.wav','guitar.wav','bass.wav','drums.wav','strings.wav'];
export function validAudio(data,score){
  if(data.length<44||data.subarray(0,4).toString()!=='RIFF'||data.subarray(8,12).toString()!=='WAVE')return false;
  let format,frames;
  for(let offset=12;offset+8<=data.length;){const size=data.readUInt32LE(offset+4),start=offset+8;if(start+size>data.length)return false;const type=data.subarray(offset,offset+4).toString();if(type==='fmt '&&size>=16)format={encoding:data.readUInt16LE(start),channels:data.readUInt16LE(start+2),rate:data.readUInt32LE(start+4),alignment:data.readUInt16LE(start+12),bits:data.readUInt16LE(start+14)};if(type==='data')frames=size/6;offset=start+size+(size%2);}
  return format?.encoding===1&&format.channels===2&&format.rate===score.sampleRate&&format.bits===24&&format.alignment===6&&frames===Math.round(score.duration*score.sampleRate);
}
export class SongProjectService{
  constructor({root,directory=join(root,'.local/song-project'),worker}={}){Object.assign(this,{root,directory,worker});this.source=join(root,'dist/youth-song');this.serial=Promise.resolve();this.running=null;this.closed=false;this.jobs=new Map();this.python=join(root,'.local/score-trial/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');}
  exclusive(fn){const p=this.serial.then(fn);this.serial=p.catch(()=>{});return p;}
  async save(file,value){const path=join(this.directory,file),temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2));await rename(temp,path);}
  async fingerprints(){return Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await readFile(join(this.source,name)))])));}
  async init(){
    await mkdir(this.directory,{recursive:true});const scoreData=await readFile(join(this.source,'score.json'));this.scoreSourceHash=hash(scoreData);this.score=JSON.parse(scoreData);this.available=!!this.worker||await access(this.python).then(()=>true,()=>false);
    try{this.draft=JSON.parse(await readFile(join(this.directory,'draft.json'),'utf8'));this.draft.brief=validateBrief(this.draft.brief,this.score);}catch(e){if(e.code!=='ENOENT')throw e;this.draft={revision:0,brief:initialBrief(this.score)};await this.save('draft.json',this.draft);}
    try{this.observations=JSON.parse(await readFile(join(this.directory,'observations.json'),'utf8'));if(!Array.isArray(this.observations))throw Error('Invalid listening records');}catch(e){if(e.code!=='ENOENT')throw e;this.observations=[];}
    for(const id of await readdir(this.directory))if(uuid.test(id)){let raw;try{raw=await readFile(join(this.directory,id,'version.json'),'utf8');}catch(e){if(e.code==='ENOENT')continue;throw e;}const job=JSON.parse(raw);if(job.id!==id)throw Error('Invalid saved version');if(job.state==='rendering'){job.state='interrupted';job.message='上次制作已中断，原版保留。可重新准备方案。';await this.save(`${id}/version.json`,job);}this.jobs.set(id,job);}
    this.vocalStudy=await this.readVocalStudy();
    this.arrangementStudies=await this.readArrangementStudies();
    return this;
  }
  async readVocalStudy(){
    const id='vocal-alignment-v1',path=join(this.source,id);
    try{
      const result=JSON.parse(await readFile(join(path,'result.json'),'utf8')),section=this.score.sections.find(s=>s.id==='chorus1');
      if(result.id!==id||result.status!=='rendered'||result.policy!=='vowel-onset-v1'||!section||!Number.isFinite(result.start)||!Number.isFinite(result.end)||Math.abs(result.start-section.start)>1/this.score.sampleRate||Math.abs(result.end-section.end)>1/this.score.sampleRate||!result.scoreAndLyricsUnchanged||!result.backingUnchanged||!result.outsideRegionUnchanged)return null;
      for(const name of ['score.json','song.wav','vocal.wav','accompaniment.wav'])if(hash(await readFile(join(this.source,name)))!==result.sourceHashes?.[name])return null;
      for(const name of ['song.wav','vocal.wav']){const audio=await readFile(join(path,name));if(hash(audio)!==result.files?.[name]||!validAudio(audio,this.score))return null;}
      return {id,label:'S1 咬字校正 · 首段副歌',start:result.start,end:result.end,scoreHash:result.sourceHashes['score.json'],audioHash:result.files['song.wav']};
    }catch{return null;}
  }
  async readArrangementStudies(selected){
    const path=join(this.source,'arrangement-study-v1'),allowed=['folk','retro','ballad'];
    try{
      const result=JSON.parse(await readFile(join(path,'result.json'),'utf8')),section=this.score.sections.find(s=>s.id==='chorus1');
      if(result.status!=='rendered'||result.id!=='arrangement-study-v1'||result.sampleRate!==this.score.sampleRate||result.duration!==this.score.duration||!section||!Array.isArray(result.arrangements)||result.arrangements.length!==3||new Set(result.arrangements.map(v=>v.id)).size!==3)return [];
      for(const name of ['score.json','song.wav','accompaniment.wav','vocal-alignment-v1/song.wav','vocal-alignment-v1/vocal.wav'])if(hash(await readFile(join(this.source,name)))!==result.sourceHashes?.[name])return [];
      const studies=[];
      for(const v of result.arrangements){
        if(!allowed.includes(v.id)||typeof v.name!=='string'||typeof v.feeling!=='string'||typeof v.detail!=='string'||!Number.isFinite(v.start)||!Number.isFinite(v.end)||Math.abs(v.start-section.start)>1/this.score.sampleRate||Math.abs(v.end-section.end)>1/this.score.sampleRate||v.outsideRegionUnchanged!==true||v.vocalPreserved!==true)return [];
        if(selected&&selected!==v.id)continue;
        for(const name of ['song.wav','accompaniment.wav']){const data=await readFile(join(path,v.id,name));if(hash(data)!==v.files?.[name]||!validAudio(data,this.score))return [];}
        studies.push({id:v.id,label:`编配 · ${v.name}`,name:v.name,feeling:v.feeling,detail:v.detail,start:v.start,end:v.end,scoreHash:result.sourceHashes['score.json'],audioHash:v.files['song.wav'],backingHash:v.files['accompaniment.wav']});
      }
      return studies;
    }catch{return [];}
  }
  snapshot(){return structuredClone({draft:this.draft,recipes,available:this.available,observations:this.observations,vocalStudy:this.vocalStudy,arrangementStudies:this.arrangementStudies,versions:[...this.jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))});}
  observe(input,phrasingVersion){return this.exclusive(async()=>{
    if(this.closed)throw new ServiceError('服务正在关闭。',503);
    if(!input||Object.keys(input).sort().join('|')!==['requestId','revision','sectionId','version','at','emotion','musicality','sound','note'].sort().join('|')||!uuid.test(input.requestId))throw new ServiceError('试听记录格式无效。');
    const fingerprint=hash(input),prior=this.observations.find(o=>o.requestId===input.requestId);if(prior){if(prior.fingerprint!==fingerprint)throw new ServiceError('相同记录请求的内容已改变。',409);return structuredClone(prior);}
    if(input.revision!==this.draft.revision)throw new ServiceError('创作目标已更新，请重新载入目标后再记录。',409);
    const section=this.score.sections.find(s=>s.id===input.sectionId);
    if(!section||typeof input.at!=='number'||!Number.isFinite(input.at)||input.at<section.start||input.at>=section.end)throw new ServiceError('请在选中段落内定位试听。');
    if(!['emotion','musicality','sound'].every(k=>['met','unsure','gap'].includes(input[k]))||typeof input.note!=='string'||input.note.trim().length<2||input.note.length>1200)throw new ServiceError('请分别选择三项听感，并写下具体感受。');
    let source={kind:'original',label:'V1 原版',scoreHash:this.scoreSourceHash};
    if(input.version!=='original'){
      if(input.version==='vocal-alignment-v1'){const study=await this.readVocalStudy();if(!study)throw new ServiceError('这版咬字试听暂不可用，请重新载入。',409);source={kind:'vocal-alignment',label:study.label,scoreHash:study.scoreHash,audioHash:study.audioHash};}
      else if(typeof input.version==='string'&&input.version.startsWith('arrangement:')){const studies=await this.readArrangementStudies(input.version.slice(12)),study=studies.find(v=>`arrangement:${v.id}`===input.version);if(!study)throw new ServiceError('这版编配试听暂不可用，请重新载入。',409);source={kind:'arrangement',label:study.label,scoreHash:study.scoreHash,audioHash:study.audioHash,backingHash:study.backingHash};}
      else if(typeof input.version==='string'&&input.version.startsWith('phrasing:')){if(!phrasingVersion||input.version!==`phrasing:${phrasingVersion.id}`||phrasingVersion.state!=='succeeded')throw new ServiceError('请先完成这版演唱。',409);source={kind:'phrasing',label:`P${phrasingVersion.number} 乐句演唱`,scoreHash:phrasingVersion.scoreHash};}
      else{const v=this.get(input.version);if(v.state!=='succeeded')throw new ServiceError('请先完成这版混音。',409);source={kind:'mix',label:`V${v.number} 混音`,proposalHash:v.proposal.hash};}
    }
    const record={...structuredClone(input),note:input.note.trim(),id:randomUUID(),fingerprint,source,createdAt:new Date().toISOString(),target:{goal:structuredClone(this.draft.brief.goal),section:structuredClone(this.draft.brief.sections.find(s=>s.id===section.id))}};
    const next=[...this.observations,record];await this.save('observations.json',next);this.observations=next;return structuredClone(record);
  });}
  prepare(input){return this.exclusive(async()=>{
    if(this.closed)throw new ServiceError('服务正在关闭。',503);
    if(input?.revision!==this.draft.revision)throw new ServiceError('另一处已更新创作依据，请重新载入后再编辑。',409);
    const brief=validateBrief(input.brief,this.score),draft={revision:this.draft.revision+1,brief,updatedAt:new Date().toISOString()};
    const plan=compilePlan(brief,this.score),sourceHashes=await this.fingerprints();
    if(sourceHashes['score.json']!==this.scoreSourceHash)throw new ServiceError('原始乐谱已改变，请重新启动服务后编辑。',409);
    if(this.closed)throw new ServiceError('服务正在关闭。',503);
    const proposal={revision:draft.revision,brief,plan,sourceHashes};proposal.hash=hash(proposal);
    draft.proposal=proposal;await this.save('draft.json',draft);this.draft=draft;return this.snapshot();
  });}
  render(input){return this.exclusive(async()=>{
    if(!input||!uuid.test(input.requestId))throw new ServiceError('制作请求无效。');
    const prior=[...this.jobs.values()].find(j=>j.requestId===input.requestId);if(prior){if(prior.proposal.hash!==input.hash)throw new ServiceError('相同请求的制作方案已变化。',409);return structuredClone(prior);}
    if(this.closed||!this.available)throw new ServiceError('本机音频制作暂不可用。',503);
    const proposal=this.draft.proposal;
    if(!proposal||proposal.hash!==input.hash)throw new ServiceError('创作依据已变化，请先重新查看制作方案。',409);
    if(!proposal.plan.changes.length)throw new ServiceError('创作依据已保存。选择至少一个段落的声音调整后再制作。',409);
    if(this.running)throw new ServiceError('已有版本正在制作，请等待完成或取消。',409);
    if(hash(await this.fingerprints())!==hash(proposal.sourceHashes))throw new ServiceError('原始音频已变化，请重新准备方案。',409);
    if(this.closed)throw new ServiceError('服务正在关闭。',503);
    const id=randomUUID(),job={id,requestId:input.requestId,number:this.jobs.size+2,createdAt:new Date().toISOString(),state:'rendering',message:'正在按已确认方案调整原始分轨',proposal:structuredClone(proposal)};
    await mkdir(join(this.directory,id));await this.save(`${id}/version.json`,job);this.jobs.set(id,job);
    const controller=new AbortController();this.running={id,controller};this.completion=this.run(job,controller);return structuredClone(job);
  });}
  async run(job,controller){
    const path=join(this.directory,job.id);
    try{
      await writeFile(join(path,'request.json'),JSON.stringify({source:this.source,proposal:job.proposal}));
      if(this.worker)await this.worker({path,signal:controller.signal});else{const result=await runProcess(this.python,['-X','utf8',join(this.root,'scripts/render-song-project.py'),path],{signal:controller.signal,timeout:180000});await writeFile(join(path,'render.log'),result.stdout+'\n'+result.stderr);if(result.code!==0)throw Error('Render failed');}
      if(controller.signal.aborted)return;
      const result=JSON.parse(await readFile(join(path,'result.json'),'utf8'));
      if(result.proposalHash!==job.proposal.hash||result.sampleRate!==this.score.sampleRate||result.duration!==this.score.duration||result.bitDepth!==24||!Number.isFinite(result.peak)||result.peak<=0||result.peak>=.99||!result.unchangedOutsideRegions)throw Error('Invalid result');
      for(const kind of ['song','accompaniment']){const data=await readFile(join(path,`${kind}.wav`));if(hash(data)!==result.files?.[`${kind}.wav`]||!validAudio(data,this.score))throw Error('Invalid audio');}
      if(hash(await this.fingerprints())!==hash(job.proposal.sourceHashes))throw Error('Source changed during rendering');
      await this.exclusive(async()=>{if(controller.signal.aborted)return;const next={...job,state:'succeeded',message:'音频已完成，创作目标等待试听验收',result,finishedAt:new Date().toISOString()};await this.save(`${job.id}/version.json`,next);Object.assign(job,next);});
    }catch(e){await this.exclusive(async()=>{if(controller.signal.aborted)return;const next={...job,state:'failed',message:'制作未完成，没有发布新音频。原版与创作依据保留，可重新准备方案。'};try{await this.save(`${job.id}/version.json`,next);}catch{next.message='制作结果未能保存，没有发布新音频。请检查本机存储后重新准备方案。';}Object.assign(job,next);});}
    finally{if(this.running?.id===job.id)this.running=null;}
  }
  cancel(id){return this.exclusive(async()=>{const job=this.get(id);if(job.state==='rendering'){const next={...job,state:'cancelled',message:'已取消；原始作品与创作依据保留。'};await this.save(`${id}/version.json`,next);Object.assign(job,next);this.running?.controller.abort();}return structuredClone(job);});}
  get(id){const job=this.jobs.get(id);if(!job)throw new ServiceError('找不到这个版本。',404);return job;}
  review(id,input){return this.exclusive(async()=>{const job=this.get(id);if(job.state!=='succeeded')throw new ServiceError('请在制作完成后试听评价。',409);if(!['closer','unsure','worse'].includes(input?.verdict)||typeof input.note!=='string'||input.note.trim().length<2||input.note.length>1200)throw new ServiceError('请选择听感，并用 2–1200 字记录具体段落或问题。');const next={...job,review:{verdict:input.verdict,note:input.note.trim(),at:new Date().toISOString()}};await this.save(`${id}/version.json`,next);Object.assign(job,next);return structuredClone(job);});}
  async asset(id,kind){const job=this.get(id);if(kind==='record')return {data:Buffer.from(JSON.stringify({format:'sonara-song-record-v1',title:this.score.title,version:job,score:this.score,sourceAssets:sources.map(name=>({name,url:`/youth-song/${name}`,sha256:job.proposal.sourceHashes[name]})),license:'Ria / 狸安，作者 RibosomeK；配套声码器为非商业许可。',note:'创作记录含目标、段落意图、制作参数、乐谱和素材索引；音频需另行下载。'},null,2)),type:'application/json; charset=utf-8'};
    if(!['song','accompaniment'].includes(kind)||job.state!=='succeeded')throw new ServiceError('该版本还没有可下载的音频。',409);return {data:await readFile(join(this.directory,id,kind+'.wav')),type:'audio/wav'};
  }
  async close(){this.closed=true;await this.serial;try{if(this.running)await this.cancel(this.running.id);}finally{this.running?.controller.abort();await this.completion;}}
}
