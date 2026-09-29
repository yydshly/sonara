import {mkdir,writeFile,readFile,realpath,stat} from 'node:fs/promises';
import {join,resolve,sep,delimiter} from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runProcess} from './process-runner.mjs';
import {StudioError,handoffPrompt} from '../dist/studio-core.mjs';
import {inspectAudio} from './studio-media.mjs';
const resultSchema={type:'object',additionalProperties:false,properties:{taskId:{type:'string'},status:{type:'string',enum:['completed','unavailable']},audioFile:{type:'string'},note:{type:'string'}},required:['taskId','status','audioFile','note']};
const localEntry=fileURLToPath(new URL('../.local/minimax-code/node_modules/@minimax-ai/code/cli.js',import.meta.url));
// These diagnostics stay in the task directory. Never send raw CLI output to the platform.
export function redactDiagnostic(value){return String(value??'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'')
  .replace(/\bBearer\s+[^\s"'<>]+/gi,'Bearer [redacted]')
  .replace(/((?:["']?)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|password|secret)(?:["']?)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,'$1[redacted]')
  .replace(/\bsk-[a-zA-Z0-9_-]{8,}/g,'[redacted-key]')
  .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,'[redacted-token]');}
export function executionDiagnostic(result,envelope,durationMs){
  const code=typeof envelope?.error?.code==='string'?envelope.error.code.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80):null;
  return {format:'sonara-minimax-diagnostic-v1',finishedAt:new Date().toISOString(),exitCode:result.code??null,status:typeof envelope?.status==='string'?envelope.status.slice(0,40):result.reason||'no-json-result',errorCode:code,durationMs,
    message:redactDiagnostic(envelope?.error?.message||result.stderr||'').trim().slice(0,1400)};
}
function executionFailure(diagnostic){
  const detail=diagnostic.message.replace(/\s+/g,' ').slice(0,650),tag=[diagnostic.exitCode!==null?`退出码 ${diagnostic.exitCode}`:null,diagnostic.errorCode||diagnostic.status].filter(Boolean).join(' · ');
  let message='MiniMax Code 未完成这次任务。';
  if(/Sign in to MiniMax|Run `mcode login`/i.test(detail))message='MiniMax Code 尚未登录。请在生成电脑先运行 mcode login。';
  else if(diagnostic.status==='limit_exceeded')message='MiniMax Code 达到了本次步骤上限，未自动重试。';
  else if(diagnostic.status==='timeout')message='MiniMax Code 执行超时，未自动重试。';
  else if(diagnostic.status==='cancelled')message='本次等待已取消，外部任务可能仍在处理。';
  else if(diagnostic.errorCode==='STRUCTURED_OUTPUT_INVALID')message='MiniMax 返回的内容不符合约定的结果格式，未采用。';
  else if(diagnostic.status==='no-json-result')message='MiniMax Code 没有返回可验证的执行结果。';
  const error=new StudioError(`${message}（${tag}）${detail?'\n'+detail:''}\n诊断已保存：minimax-execution.json；本次不会自动重新生成。`,diagnostic.exitCode===3?503:502);error.code=diagnostic.errorCode||'MINIMAX_EXECUTION_FAILED';return error;
}
export function minimaxArguments({path,schema,output,music=false,model}){
  const args=['exec','--cwd',path,'--input','-','--input-format','text','--output-format','json','--prompt-mode','work','--permission','smart','--timeout',music?'15m':'4m','--max-steps',music?'12':'2','--output-schema',schema,'--output-last-message',output];
  if(model)args.push('--model',model);return args;
}
export class MiniMaxCode {
  constructor({binary=process.env.SONARA_MCODE_BIN,entry=process.env.SONARA_MCODE_ENTRY,model=process.env.SONARA_MCODE_MODEL,run=runProcess}={}){
    if(!binary&&!entry&&existsSync(localEntry)){binary=process.execPath;entry=localEntry;}
    // Windows npm installs expose a .cmd shim, which spawn(shell:false) cannot run.
    if(!binary&&!entry&&process.platform==='win32'){
      entry=(process.env.PATH||'').split(delimiter).map(p=>join(p,'node_modules/@minimax-ai/code/cli.js')).find(p=>existsSync(p));
      if(entry)binary=process.execPath;
    }
    Object.assign(this,{binary:binary||(entry?process.execPath:'mcode'),entry,model,run});
  }
  invoke(args,options){return this.run(this.binary,this.entry?[this.entry,...args]:args,options);}
  async status(){try{const r=await this.invoke(['--version'],{timeout:10000});return {available:r.code===0,verified:false,message:r.code===0?'已检测到 MiniMax Code；登录、音乐工具与额度需在实际任务中验证':'MiniMax Code 尚不可用'};}catch{return {available:false,verified:false,message:'未检测到 MiniMax Code 命令入口，可先导出任务后在 MiniMax Code 中执行'};}}
  async generate({path,prompt,schemaValue,signal,music=false}){
    await mkdir(path,{recursive:true});const schema=join(path,'output-schema.json'),output=join(path,'agent-output.json');await writeFile(schema,JSON.stringify(schemaValue),{mode:0o600});
    const started=Date.now();let result;
    try{result=await this.invoke(minimaxArguments({path,schema,output,music,model:this.model}),{cwd:path,input:prompt,signal,timeout:music?920000:260000});}
    catch(error){result=error.processResult||{code:null,reason:'spawn',stdout:'',stderr:error.code==='ENOENT'?'无法找到 MiniMax Code 可执行入口。':redactDiagnostic(error.message)};}
    let envelope;try{envelope=JSON.parse(result.stdout);}catch{}
    const diagnostic=executionDiagnostic(result,envelope,Date.now()-started);
    await Promise.all([writeFile(join(path,'minimax-execution.json'),JSON.stringify(diagnostic,null,2),{mode:0o600}),writeFile(join(path,'minimax-output.log'),redactDiagnostic(result.stdout).slice(-80000),{mode:0o600}),writeFile(join(path,'minimax-error.log'),redactDiagnostic(result.stderr).slice(-16000),{mode:0o600})]);
    if(result.code!==0||envelope?.status!=='succeeded')throw executionFailure(diagnostic);
    try{const info=await stat(output);if(info.size>32000)throw new StudioError('返回内容过大，未采用。',422);return JSON.parse(await readFile(output,'utf8'));}
    catch(error){diagnostic.status='output-file-invalid';diagnostic.errorCode='OUTPUT_FILE_INVALID';diagnostic.message=error instanceof StudioError?error.message:'执行声明成功，但最终结果文件缺失或不是有效 JSON。';await writeFile(join(path,'minimax-execution.json'),JSON.stringify(diagnostic,null,2),{mode:0o600});throw executionFailure(diagnostic);}
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
