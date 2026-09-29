import {mkdir,writeFile,readFile,realpath,stat} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runProcess} from './codex-composer.mjs';
import {StudioError,handoffPrompt} from '../dist/studio-core.mjs';
import {inspectAudio} from './studio-media.mjs';
const resultSchema={type:'object',additionalProperties:false,properties:{taskId:{type:'string'},status:{type:'string',enum:['completed','unavailable']},audioFile:{type:'string'},note:{type:'string'}},required:['taskId','status','audioFile','note']};
const localEntry=fileURLToPath(new URL('../.local/minimax-code/node_modules/@minimax-ai/code/cli.js',import.meta.url));
export function minimaxArguments({path,schema,output,music=false,model}){
  const args=['exec','--cwd',path,'--input','-','--input-format','text','--output-format','json','--prompt-mode','work','--permission','smart','--timeout',music?'15m':'4m','--max-steps',music?'12':'2','--output-schema',schema,'--output-last-message',output];
  if(model)args.push('--model',model);return args;
}
export class MiniMaxCode {
  constructor({binary=process.env.SONARA_MCODE_BIN,entry=process.env.SONARA_MCODE_ENTRY,model=process.env.SONARA_MCODE_MODEL,run=runProcess}={}){
    if(!binary&&!entry&&existsSync(localEntry)){binary=process.execPath;entry=localEntry;}
    Object.assign(this,{binary:binary||(entry?process.execPath:'mcode'),entry,model,run});
  }
  invoke(args,options){return this.run(this.binary,this.entry?[this.entry,...args]:args,options);}
  async status(){try{const r=await this.invoke(['--version'],{timeout:10000});return {available:r.code===0,verified:false,message:r.code===0?'已检测到 MiniMax Code；登录、音乐工具与额度需在实际任务中验证':'MiniMax Code 尚不可用'};}catch{return {available:false,verified:false,message:'未检测到 MiniMax Code 命令入口，可先导出任务后在 MiniMax Code 中执行'};}}
  async generate({path,prompt,schemaValue,signal,music=false}){
    await mkdir(path,{recursive:true});const schema=join(path,'output-schema.json'),output=join(path,'agent-output.json');await writeFile(schema,JSON.stringify(schemaValue),{mode:0o600});
    const result=await this.invoke(minimaxArguments({path,schema,output,music,model:this.model}),{cwd:path,input:prompt,signal,timeout:music?920000:260000});
    if(result.code!==0&&/Sign in to MiniMax|Run `mcode login`/i.test(result.stderr||''))throw new StudioError('MiniMax Code 尚未登录。请先在本机 MiniMax Code 完成账户登录，再创建新的生成任务；本次没有自动重试。',503);
    let envelope;try{envelope=JSON.parse(result.stdout);}catch{throw new StudioError('MiniMax Code 没有返回可验证的执行结果，请检查本机登录与工具状态。',502);}
    if(result.code!==0||envelope.status!=='succeeded')throw new StudioError('MiniMax Code 未完成这次任务。可能需要登录、额度或工具确认；请先检查其任务记录，不会自动重试。',502);
    const info=await stat(output);if(info.size>32000)throw new StudioError('返回内容过大，未采用。',422);return JSON.parse(await readFile(output,'utf8'));
  }
  async music({path,project,task,signal}){
    const report=await this.generate({path,prompt:handoffPrompt(project,task),schemaValue:resultSchema,signal,music:true});
    if(report.taskId!==task.id||report.status!=='completed')throw new StudioError('音乐工具未交付这次任务的音频。请在 MiniMax Code 中核查音乐权限和任务结果。',502);
    if(typeof report.audioFile!=='string'||!/^song\.(mp3|wav)$/.test(report.audioFile))throw new StudioError('音乐结果必须保存为任务目录内的 song.mp3 或 song.wav。',422);
    const base=await realpath(path),file=await realpath(resolve(path,report.audioFile));if(!file.startsWith(base+sep))throw new StudioError('音频路径超出本次任务目录。',422);
    if((await stat(file)).size>50*1024*1024)throw new StudioError('生成音频超过 50 MB。',422);const data=await readFile(file),audio=inspectAudio(data);
    return {data,audio,note:typeof report.note==='string'?report.note.slice(0,1600):'',source:'minimax-code'};
  }
}
