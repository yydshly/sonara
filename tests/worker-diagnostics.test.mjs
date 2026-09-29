import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {MiniMaxCode,redactDiagnostic} from '../server/minimax-code.mjs';
import {runProcess} from '../server/process-runner.mjs';
import {RemoteWorker,createWorkerLogger} from '../scripts/remote-worker.mjs';
import {workerUpdatePackage,workerPackage} from '../server/worker-package.mjs';
import {emptyDraft} from '../dist/studio-core.mjs';

test('failed structured execution records the actual exit and error code without retry or secrets',async()=>{
  const path=await mkdtemp(join(tmpdir(),'sonara-diag-'));let calls=0;
  const m=new MiniMaxCode({run:async()=>{calls++;return {code:4,stdout:JSON.stringify({status:'failed',error:{code:'STRUCTURED_OUTPUT_INVALID',message:'Structured output was not valid JSON. token=private-token'}}),stderr:'Authorization: Bearer private-key\napi_key="private-api-key"'};}});
  await assert.rejects(m.generate({path,prompt:'fixture',schemaValue:{type:'object'}}),e=>e.message.includes('STRUCTURED_OUTPUT_INVALID')&&!e.message.includes('private-token'));
  assert.equal(calls,1);const diagnostic=JSON.parse(await readFile(join(path,'minimax-execution.json'),'utf8'));assert.equal(diagnostic.exitCode,4);assert.equal(diagnostic.errorCode,'STRUCTURED_OUTPUT_INVALID');
  for(const file of ['minimax-execution.json','minimax-output.log','minimax-error.log']){const content=await readFile(join(path,file),'utf8');assert.ok(!content.includes('private-token'));assert.ok(!content.includes('private-key'));assert.ok(!content.includes('private-api-key'));}
});
test('step limit, missing final output and process failures keep distinct diagnostic reasons',async()=>{
  for(const [result,status] of [[{code:7,stdout:'{"status":"limit_exceeded"}',stderr:''},'limit_exceeded'],[{code:0,stdout:'{"status":"succeeded"}',stderr:''},'output-file-invalid'],[{code:2,stdout:'usage text',stderr:'unknown option'},'no-json-result']]){
    const path=await mkdtemp(join(tmpdir(),'sonara-diag-case-')),m=new MiniMaxCode({run:async()=>result});await assert.rejects(m.generate({path,prompt:'fixture',schemaValue:{}}));assert.equal(JSON.parse(await readFile(join(path,'minimax-execution.json'),'utf8')).status,status);
  }
  const path=await mkdtemp(join(tmpdir(),'sonara-diag-timeout-')),m=new MiniMaxCode({run:async()=>{const e=Error('timeout');e.processResult={code:null,reason:'timeout',stdout:'partial',stderr:'still running'};throw e;}});
  await assert.rejects(m.generate({path,prompt:'fixture',schemaValue:{}}),/超时/);assert.equal(JSON.parse(await readFile(join(path,'minimax-execution.json'),'utf8')).status,'timeout');
});
test('process timeout retains partial output and split UTF-8 characters are decoded correctly',async()=>{
  const timed=runProcess(process.execPath,['-e',"console.log('started');setInterval(()=>{},1000)"],{timeout:1500});
  await assert.rejects(timed,e=>e.processResult.reason==='timeout'&&e.processResult.stdout.includes('started'));
  const result=await runProcess(process.execPath,['-e',"const b=Buffer.from('歌词');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),20)"]);
  assert.equal(result.stdout,'歌词');
});
test('worker log is readable outside the console and redacts credentials before writing or display',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'sonara-worker-log-')),file=join(folder,'worker.log'),lines=[];const log=createWorkerLogger(file,line=>lines.push(line));
  log('启动 token="secret-token"; Authorization: Bearer secret-bearer; apiKey=secret-api');log('等待平台提交新任务');
  const content=await readFile(file,'utf8');assert.match(content,/等待平台提交新任务/);for(const text of [content,...lines])for(const secret of ['secret-token','secret-bearer','secret-api'])assert.ok(!text.includes(secret));
  assert.ok(!redactDiagnostic('sk-abcdefghijkl123456').includes('abcdefghijkl'));assert.ok(!redactDiagnostic('eyJabc.def.ghi').includes('eyJabc'));
});
test('failed worker journal and console report failure rather than implying a completed song',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sonara-worker-failure-')),messages=[];let submissions=0;
  const worker=await new RemoteWorker({config:{format:'sonara-worker-connection-v1',url:'http://127.0.0.1:4176',token:'a'.repeat(64)},directory,log:m=>messages.push(m),minimax:{status:async()=>({available:true}),generate:async()=>{submissions++;throw Error('Unable to start; token=not-for-logs');}},fetcher:async()=>new Response('{"ok":true}')}).init();
  const job={projectId:randomUUID(),lease:randomUUID(),task:{id:randomUUID(),type:'lyrics',revision:1,snapshot:{...emptyDraft(),idea:'一次仅用于验证失败日志的任务'}}};await worker.generate(job);
  const record=JSON.parse(await readFile(join(directory,'tasks',job.task.id,'journal.json'),'utf8'));assert.equal(record.outcome,'failed');assert.equal(submissions,1);assert.ok(!record.failure.message.includes('not-for-logs'));assert.ok(messages.some(m=>m.includes('失败状态已送回')));assert.ok(!messages.some(m=>m==='生成结果已回到声间。'));
});
function entries(zip){const result=new Map();let offset=0;while(zip.readUInt32LE(offset)===0x04034b50){const size=zip.readUInt32LE(offset+18),length=zip.readUInt16LE(offset+26),extra=zip.readUInt16LE(offset+28),name=zip.subarray(offset+30,offset+30+length).toString(),start=offset+30+length+extra;result.set(name,zip.subarray(start,start+size));offset=start+size;}return result;}
test('update package preserves the pairing and task library and provides an obvious log opener',async()=>{
  const files=entries(await workerUpdatePackage());assert.ok(!files.has('connection.json'));assert.ok(![...files.keys()].some(name=>name.startsWith('.local/')));assert.ok(files.has('view-logs.cmd'));assert.match(files.get('start-worker.cmd').toString(),/where node/);
  const root=await mkdtemp(join(tmpdir(),'sonara-overlay-'));await writeFile(join(root,'connection.json'),'existing pairing');await mkdir(join(root,'.local/remote-worker'),{recursive:true});await writeFile(join(root,'.local/remote-worker/identity.json'),'existing identity');
  for(const [name,data] of files){const segments=name.split('/');await mkdir(join(root,...segments.slice(0,-1)),{recursive:true});await writeFile(join(root,name),data);}
  assert.equal(await readFile(join(root,'connection.json'),'utf8'),'existing pairing');assert.equal(await readFile(join(root,'.local/remote-worker/identity.json'),'utf8'),'existing identity');
  const full=entries(await workerPackage({format:'test',url:'test',token:'test'}));assert.ok(full.has('connection.json'));assert.ok(full.has('view-logs.cmd'));assert.deepEqual([...files.keys()].filter(n=>n.endsWith('.mjs')).sort(),[...full.keys()].filter(n=>n.endsWith('.mjs')).sort());
});
