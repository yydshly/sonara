// Explicit local development run. Never called by CI or the static build.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inspirations,inspirationDraft} from '../dist/studio-inspirations.mjs';
import {validateLyricsOutput} from '../dist/studio-core.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const base=new URL(process.env.SONARA_STUDIO_URL||'http://127.0.0.1:4175');
if(base.protocol!=='http:'||!['localhost','127.0.0.1'].includes(base.hostname))throw Error('Sample generation only uses the local studio.');
const folder=resolve(root,'.local/sample-runs/first-eight');
await mkdir(folder,{recursive:true});
const manifestPath=resolve(folder,'manifest.json');
let manifest;
try{manifest=JSON.parse(await readFile(manifestPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;manifest={format:'sonara-sample-run-v1',records:{}};}
async function persist(){const temporary=manifestPath+'.tmp';await writeFile(temporary,JSON.stringify(manifest,null,2));await rename(temporary,manifestPath);}
async function api(path,method='GET',input){
  const r=await fetch(new URL('/api/studio'+path,base),{method,headers:input?{'Content-Type':'application/json'}:undefined,body:input?JSON.stringify(input):undefined});
  const data=await r.json();if(!r.ok)throw Error(data.error||`HTTP ${r.status}`);return data;
}
const refinements={
  'station-home':'只润色明显不自然的说法，不改变人物、故事、段落和核心副歌。“再开口，终于不用装得响亮”说得别扭，请换成普通人会说、也好唱的话。保留母亲、橘子、留汤和添半碗汤的动作，不添新意象，不为押韵硬凑句子。',
  'last-school-bus':'保持青春重逢、校车合影、老笑话和轻快摇滚方向。只改两处：副歌“你拍着我，我笑得筷子都拿不稳”在128 BPM偏长，请拆成自然的短乐句；结尾“下次想见，群里喊一声见”不顺口，请换成真实朋友会说的话。尽量保留其他歌词，不加口号。',
  'green-light':'Edit only awkward English phrases while keeping the story, section structure and main chorus. “loading ground” is not natural for the place behind a workplace; “your keys change pockets” makes the move unclear; “change the gear” and “Still good. Next time we are here” sound forced. Use idiomatic conversational English. Preserve the river road, rattling coffee cup, move next week and restrained goodbye. Do not force rhymes or add elaborate metaphors.'
};
if(process.argv.includes('--generate')){
  const status=await api('/status');
  if(!status.lyrics.find(p=>p.id==='codex')?.available)throw Error('Codex is not connected. No sample tasks were submitted.');
  for(const sample of inspirations){
    let record=manifest.records[sample.id];
    if(!record){
      // Record the identities before requests so an interrupted run can resume
      // without silently submitting a duplicate model task.
      record={projectId:randomUUID(),requestId:randomUUID(),initialDraft:inspirationDraft(sample)};
      manifest.records[sample.id]=record;await persist();
      await api('/projects','POST',{id:record.projectId,draft:record.initialDraft});
    }
    let project;
    try{project=await api('/projects/'+record.projectId);}catch(error){throw Error(`${sample.id}: inspect the saved manifest before retrying: ${error.message}`);}
    if(sample.mode==='instrumental'){console.log(`${sample.id}: instrumental direction saved; no lyrics or audio fabricated`);continue;}
    let task=project.tasks.find(t=>t.requestId===record.requestId);
    if(!task){
      if(project.revision!==1)throw Error(`${sample.id}: edited outside this run; not overwritten`);
      project=await api('/projects/'+project.id+'/tasks','POST',{revision:1,type:'lyrics',provider:'codex',requestId:record.requestId});
      task=project.tasks.find(t=>t.requestId===record.requestId);
    }
    const deadline=Date.now()+300000;
    while(['queued','running'].includes(task.state)&&Date.now()<deadline){
      await new Promise(r=>setTimeout(r,3000));
      project=await api('/projects/'+project.id);task=project.tasks.find(t=>t.requestId===record.requestId);
    }
    if(task.state!=='succeeded')throw Error(`${sample.id}: ${task.state}; no automatic retry. ${task.error||''}`);
    const output=validateLyricsOutput(task.output);
    if(!record.savedRevision){
      if(project.revision!==1)throw Error(`${sample.id}: a user edited this example; candidate preserved, not adopted automatically`);
      project=await api('/projects/'+project.id,'PUT',{revision:1,draft:{...project.draft,title:output.title,lyrics:output.lyrics}});
      record.savedRevision=project.revision;await persist();
    }
    console.log(`${sample.id}: ${output.title} · ${Math.round((Date.parse(task.finishedAt)-Date.parse(task.startedAt))/1000)}s · lyric draft saved; music not generated`);
  }
}

if(process.argv.includes('--refine')){
  for(const [sampleId,notes] of Object.entries(refinements)){
    const record=manifest.records[sampleId];if(!record?.savedRevision)throw Error(`Generate ${sampleId} before refining it.`);
    let project=await api('/projects/'+record.projectId);
    if(!record.refinement){
      if(project.revision!==record.savedRevision)throw Error(`${sampleId}: edited outside the sample run; not overwritten`);
      record.refinement={requestId:randomUUID(),notes};await persist();
      project=await api('/projects/'+project.id,'PUT',{revision:project.revision,draft:{...project.draft,revisionNotes:notes}});
      record.refinement.revision=project.revision;await persist();
    }
    let task=project.tasks.find(t=>t.requestId===record.refinement.requestId);
    if(!task){
      if(project.revision!==record.refinement.revision)throw Error(`${sampleId}: draft changed; review the saved record before resubmitting`);
      project=await api('/projects/'+project.id+'/tasks','POST',{revision:project.revision,type:'lyrics',provider:'codex',requestId:record.refinement.requestId});
      task=project.tasks.find(t=>t.requestId===record.refinement.requestId);
    }
    const deadline=Date.now()+300000;
    while(['queued','running'].includes(task.state)&&Date.now()<deadline){await new Promise(r=>setTimeout(r,3000));project=await api('/projects/'+project.id);task=project.tasks.find(t=>t.requestId===record.refinement.requestId);}
    if(task.state!=='succeeded')throw Error(`${sampleId}: refinement ${task.state}; no automatic retry`);
    if(!record.refinement.savedRevision){
      if(project.revision!==record.refinement.revision)throw Error(`${sampleId}: edited during generation; candidate retained without overwrite`);
      const output=validateLyricsOutput(task.output);
      project=await api('/projects/'+project.id,'PUT',{revision:project.revision,draft:{...project.draft,title:output.title,lyrics:output.lyrics,revisionNotes:''}});
      record.refinement.savedRevision=project.revision;await persist();
    }
    console.log(`${sampleId}: real Codex wording revision saved; original retained`);
  }
}

if(process.argv.includes('--export')){
  const cases=[];
  for(const sample of inspirations){
    const record=manifest.records[sample.id];if(!record)throw Error(`Missing generated example: ${sample.id}`);
    const project=await api('/projects/'+record.projectId);
    const original=project.tasks.find(t=>t.requestId===record.requestId);
    const task=record.refinement?project.tasks.find(t=>t.requestId===record.refinement.requestId):original;
    const instrumental=sample.mode==='instrumental';
    if(!instrumental&&task?.state!=='succeeded')throw Error(`No completed lyric output for ${sample.id}`);
    const output=instrumental?null:validateLyricsOutput(task.output);
    // Only fictional initial briefs and their exact model candidate are public.
    // Never export later user edits, other projects, logs, tokens or audio.
    cases.push({id:sample.id,label:sample.label,focus:sample.focus,draft:{...record.initialDraft,...(output?{title:output.title,lyrics:output.lyrics}:{})},lyricsStatus:instrumental?'not-needed':'generated-draft',musicStatus:'not-generated',provenance:output?{provider:'Codex',generatedAt:task.finishedAt,elapsedSeconds:Math.round((Date.parse(task.finishedAt)-Date.parse(task.startedAt))/1000),direction:output.direction}:{provider:'创作方向设计',generatedAt:null,elapsedSeconds:null,direction:'纯音乐方案，无歌词；未生成音频。'},wordingRevision:record.refinement?{reason:record.refinement.notes,originalLyrics:validateLyricsOutput(original.output).lyrics,originalGeneratedAt:original.finishedAt,reviewer:'助手文字审阅；不是试听评价'}:null});
  }
  const output={format:'sonara-studio-samples-v1',generatedAt:new Date().toISOString(),notice:'虚构故事的创作样例。模型歌词仍需确认；全部样例尚无新生成音频，不代表试听认可。',cases};
  await writeFile(resolve(root,'dist/studio-samples.json'),JSON.stringify(output,null,2)+'\n');
  console.log(`Exported ${cases.length} reviewed-scope sample records without private project history or audio.`);
}
if(!process.argv.includes('--generate')&&!process.argv.includes('--export')&&!process.argv.includes('--refine'))console.log('Use --generate for real lyrics, --refine for recorded wording fixes, --export for fictional sample candidates only.');
