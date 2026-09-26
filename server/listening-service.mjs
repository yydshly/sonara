import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ServiceError} from './generation-service.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex');
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/;
export class ListeningService{
  constructor({root,directory=join(root,'.local/listening-preferences'),trialDirectory=join(root,'dist/listening-trial')}={}){Object.assign(this,{root,directory,trialDirectory});this.serial=Promise.resolve();}
  async init(){
    const raw=await readFile(join(this.trialDirectory,'manifest.json'));this.trial=JSON.parse(raw);this.revision=hash(raw);
    if(!['reunion-layers-v1','reunion-phrasing-v1'].includes(this.trial.id)||this.trial.variants.length!==2||new Set(this.trial.variants.map(v=>v.id)).size!==2||this.trial.variants.some(v=>!['A','B'].includes(v.id)||v.file!==v.id+'.wav'))throw Error('Unsupported listening trial');
    await mkdir(this.directory,{recursive:true});
    try{this.state=JSON.parse(await readFile(join(this.directory,'state.json'),'utf8'));if(this.state.schema!==1||!Array.isArray(this.state.records))throw Error('Invalid preference state');}
    catch(error){if(error.code!=='ENOENT')throw error;this.state={schema:1,references:[{title:'同桌的你',artist:'老狼',url:'https://ent.cnr.cn/zx/20180724/t20180724_524310292.shtml'},{title:'晴天',artist:'周杰伦',url:'https://www.youtube.com/watch?v=DYptgVvkVLQ'},{title:'倔强',artist:'五月天',url:'https://music.apple.com/us/song/1522299259'}],feeling:'舒服、产生共鸣',reason:null,source:'用户在当前对话中明确表达',records:[]};await this.persist(this.state);}
    await this.verify();return this;
  }
  latest(){return this.state.records.findLast(r=>r.trialId===this.trial.id&&r.revision===this.revision)||null;}
  async verify(){
    if(hash(await readFile(join(this.trialDirectory,'manifest.json')))!==this.revision)throw new ServiceError('试听内容已更新，请重新载入本机服务后再比较。',409);
    for(const v of this.trial.variants)if(hash(await readFile(join(this.trialDirectory,v.file)))!==v.hash)throw new ServiceError('试听文件与记录不一致，暂时不能保存选择。',409);
  }
  async persist(state){const temp=join(this.directory,randomUUID()+'.tmp');await writeFile(temp,JSON.stringify(state,null,2));await rename(temp,join(this.directory,'state.json'));}
  async snapshot(){await this.verify();return {trial:{...structuredClone(this.trial),revision:this.revision,minimumSeconds:6,variants:this.trial.variants.map(v=>({...v,audio:'/api/listening-trial/audio/'+v.id}))},references:structuredClone(this.state.references),feeling:this.state.feeling,reason:this.state.reason,current:structuredClone(this.latest())};}
  choose(input){const task=this.serial.then(async()=>{
    if(!input||!uuid.test(input.requestId)||!['A','B','neither','same','clear'].includes(input.choice))throw new ServiceError('请选择当前试听中的一个选项。');
    if(input.trialId!==this.trial.id||input.revision!==this.revision)throw new ServiceError('试听内容已更新，请重新连接试听后再选择。旧记录仍保留。',409);
    if(typeof input.note!=='string'||input.note.length>240)throw new ServiceError('补充感受请控制在 240 字以内。');
    const played=input.played;if(!played||Object.keys(played).length!==2||!['A','B'].every(k=>typeof played[k]==='number'&&Number.isFinite(played[k])&&played[k]>=0&&played[k]<=this.trial.duration))throw new ServiceError('播放记录无效。');
    if(input.choice!=='clear'&&Object.values(played).some(n=>n<6))throw new ServiceError('先各听至少 6 秒，再保存你的感觉。',409);
    const payload={trialId:input.trialId,revision:input.revision,choice:input.choice,note:input.note.trim(),played:{A:played.A,B:played.B},previousRecordId:input.previousRecordId??null};
    const prior=this.state.records.find(r=>r.requestId===input.requestId);if(prior){if(prior.requestHash!==hash(JSON.stringify(payload)))throw new ServiceError('这次选择已变化，请重新提交。',409);return this.snapshot();}
    await this.verify();const latest=this.latest();if(payload.previousRecordId!==(latest?.id??null))throw new ServiceError('另一个页面已更新选择，已保存的记录不会被覆盖。请刷新后再选择。',409);
    if(input.choice==='clear'&&(!latest||latest.choice==='clear'))throw new ServiceError('当前没有需要撤回的选择。',409);
    const record={id:randomUUID(),requestId:input.requestId,requestHash:hash(JSON.stringify(payload)),...payload,createdAt:new Date().toISOString(),factor:this.trial.factor,reasonConfirmed:false,evidenceType:'browser-reported-playback',variantHashes:Object.fromEntries(this.trial.variants.map(v=>[v.id,v.hash]))};
    const next={...this.state,records:[...this.state.records,record]};await this.persist(next);this.state=next;return this.snapshot();
  });this.serial=task.catch(()=>{});return task;}
  async asset(id){await this.verify();const variant=this.trial.variants.find(v=>v.id===id);if(!variant)throw new ServiceError('没有这份试听。',404);return {data:await readFile(join(this.trialDirectory,variant.file)),type:'audio/wav'};}
  async close(){await this.serial;}
}
