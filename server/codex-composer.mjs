import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {compositionSchema,compositionPrompt} from './composition-score.mjs';
import {revisionSchemas,revisionPrompt} from './composition-revision.mjs';
import {phrasingSchema,phrasingPrompt} from './emotion-phrasing.mjs';
import {expressionSchema,expressionPrompt} from './expression-plan.mjs';
import {expressiveSchema,expressivePrompt,expressiveRevisionSchema,expressiveRevisionPrompt} from './expressive-score.mjs';

// Prompt text is stdin, never command text. Each run gets an empty working folder.
export function codexArguments({work,schema,output,model}){
  const args=['--no-daemon','--ask-for-approval','never','exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--cd',work,'--output-schema',schema,'--output-last-message',output,'--color','never','--json',
    '-c','agents.enabled=false','-c','web_search="disabled"','-c','project_doc_max_bytes=0'];
  for(const feature of ['shell_tool','unified_exec','code_mode_host','apps','plugins','browser_use','computer_use','image_generation','hooks','multi_agent'])args.push('--disable',feature);
  if(model)args.push('--model',model);args.push('-');return args;
}
export function runProcess(command,args,{cwd,input,signal,timeout=240000,onEvent}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(Error('Cancelled'));
    const child=spawn(command,args,{cwd,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',timedOut=false;
    const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{timedOut=true;child.kill();},timeout);
    child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>2000000)child.kill();onEvent?.(String(chunk));});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-16000);});
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    child.on('error',error=>{cleanup();reject(error);});
    child.on('close',code=>{cleanup();if(signal?.aborted)return reject(Error('Cancelled'));if(timedOut)return reject(Error('Process timed out'));resolve({code,stdout,stderr});});
    child.stdin.on('error',()=>{});child.stdin.end(input||'');
  });
}
export class CodexComposer{
  constructor({binary=process.env.SONARA_CODEX_BIN||'codex',model=process.env.SONARA_CODEX_MODEL,run=runProcess}={}){Object.assign(this,{binary,model,run});}
  async status(){try{const result=await this.run(this.binary,['login','status'],{timeout:10000});return {ready:result.code===0,message:result.code===0?'Codex 已连接 · 使用本机登录账户':'请先在本机登录 Codex'};}catch{return {ready:false,message:'未找到可用的 Codex，请检查本机安装与登录状态'};}}
  async compose({path,idea,brief,music,creationMode,availableVoices,signal}){
    if(creationMode==='expressive')return this.generate({path,prompt:expressivePrompt(idea,brief,music,availableVoices),schemaValue:expressiveSchema,signal});
    return this.generate({path,prompt:compositionPrompt(idea,brief,music),schemaValue:compositionSchema,signal});
  }
  async revise({path,base,request,signal}){
    if(base.format==='expressive-v1')return this.generate({path,prompt:expressiveRevisionPrompt(base,request),schemaValue:expressiveRevisionSchema(request.mode),signal});
    return this.generate({path,prompt:revisionPrompt(base,request),schemaValue:revisionSchemas[request.mode],signal});
  }
  async phrase({path,brief,score,sectionId,focus,expression=false,rewriteLyrics=false,feedback='',signal}){
    return this.generate({path,prompt:(expression?expressionPrompt:phrasingPrompt)({brief,score,sectionId,focus,rewriteLyrics,feedback}),schemaValue:expression?expressionSchema:phrasingSchema,signal});
  }
  async generate({path,prompt,schemaValue,signal}){
    const work=join(path,'workspace'),schema=join(path,'schema.json'),output=join(path,'model-output.json');
    await mkdir(work,{recursive:true});await writeFile(schema,JSON.stringify(schemaValue));
    const result=await this.run(this.binary,codexArguments({work,schema,output,model:this.model}),{cwd:work,input:prompt,signal});
    // Only retained under the private service directory, never exposed as static assets.
    await writeFile(join(path,'codex-events.jsonl'),result.stdout);await writeFile(join(path,'codex-diagnostics.txt'),result.stderr);
    if(result.code!==0)throw Error('Codex did not complete');
    const raw=await readFile(output,'utf8');if(raw.length>64000)throw Error('Oversize score');
    return JSON.parse(raw);
  }
}
