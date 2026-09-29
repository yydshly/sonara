import {spawn} from 'node:child_process';

// Prompts are passed on stdin, never interpolated into a shell command.
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
