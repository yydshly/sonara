import {musicStyles,singerChoices,musicLabel} from './music-styles.mjs';
import {initStyleDiscovery} from './style-discovery.mjs';
import {initListeningTrial} from './listening-trial.mjs';
import {initSoundBaseline} from './sound-baseline.mjs';
const $=id=>document.getElementById(id),player=$('player'),key='sonara-compose-v1';
const example='年轻时总想着先把工作做好，以后有的是时间陪她。现在生活安稳了，搬家时翻到一本旧日历，上面还圈着那次没去成的旅行。想唱出成年后才懂得的遗憾，从平静回忆到温暖地放下。语言自然，情绪有起伏，不拖每一句句尾。';
const labels={composing:'准备词曲中',draft:'待确认的词曲',singing:'正在合成演唱',succeeded:'演唱已保存',failed:'本次未完成',cancelled:'已取消',interrupted:'处理已中断'};
let data=null,current=null,busy=false,timer=null,loading=null,pending=null,pendingSelection=null,lastOperation=null,slot='B',deliveryVersion=null,mode='guide',view='home',editorFor=null,drafts={},audioSignature='',seekStart=null,lastShown=null;
for(const prefix of ['music','arrange']){for(const s of musicStyles){const o=document.createElement('option');o.value=s.id;o.textContent=s.name;$(prefix+'-style').append(o);}for(const s of singerChoices){const o=document.createElement('option');o.value=s.id;o.textContent=s.name;$(prefix+'-voice').append(o);}$(prefix+'-style').value='retro';}
let arrangementFor=null,pendingAudioPosition=null,listeningTrial=null;
try{const saved=JSON.parse(localStorage.getItem(key)||'{}');$('idea').value=saved.idea||'';$('auto-music').checked=saved.autoMusic!==false;current=saved.current||null;deliveryVersion=saved.deliveryVersion||null;pending=saved.pending||null;pendingSelection=saved.pendingSelection||null;lastOperation=saved.lastOperation||null;drafts=saved.drafts||{};view=saved.view||'home';if(saved.music){for(const k of ['style','bpm','voice','texture'])$('music-'+k).value=saved.music[k]??(k==='texture'?'standard':'');}for(const field of ['audience','feelingStart','feelingEnd','keep'])$('brief-'+field).value=saved.brief?.[field]||'';}catch{}
const requestedView=new URLSearchParams(location.search).get('view');if(['home','new','refine','delivery'].includes(requestedView))view=requestedView;if(location.hash==='#library')view='home';const requestedProject=new URLSearchParams(location.search).get('project');if(requestedProject){current=requestedProject;view='refine';}
const running=()=>data?.jobs.find(j=>['composing','singing'].includes(j.state));
const selected=()=>data?.jobs.find(j=>j.id===current);
const heard=()=>slot==='A'&&selected()?.baseVersion?data.jobs.find(j=>j.id===selected().baseVersion):selected();
const version=j=>`V${j.version||1}`;
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
const readBrief=()=>Object.fromEntries(['audience','feelingStart','feelingEnd','keep'].map(field=>[field,$('brief-'+field).value.trim()]));
const readMusic=prefix=>({style:$(prefix+'-style').value,bpm:Number($(prefix+'-bpm').value),voice:$(prefix+'-voice').value,...($(prefix+'-style').value==='retro'&&$(prefix+'-texture').value==='sparse'?{texture:'sparse'}:{})});
const validMusic=prefix=>{const m=readMusic(prefix);return musicStyles.some(s=>s.id===m.style)&&Number.isInteger(m.bpm)&&m.bpm>=72&&m.bpm<=144&&!!data?.musicCapabilities?.voices.find(v=>v.id===m.voice)?.ready;};
function musicScope(){for(const prefix of ['music','arrange']){const m=readMusic(prefix),s=musicStyles.find(s=>s.id===m.style);$(prefix+'-description').textContent=s?`${s.feeling}。${m.texture==='sparse'?'电钢琴 · 贝斯 · 鼓，留出更多空间':s.instruments}。`:'';}const j=selected(),m=readMusic('arrange'),reuse=j?.state==='succeeded'&&j.score.bpm===m.bpm&&(j.score.music?.voice||'ria')===m.voice;$('arrange-scope').textContent=!j?.prepared?'先完成词曲草稿，再调整。':reuse?'只重做伴奏，原人声音频直接保留。完成后可比较并选择版本。':'会重新演唱全部四句；歌词、音符音高、和弦及拍数关系保持。改变速度会改变每个字的实际时长。原版保留。';}
function remember(){try{const url=new URL(location.href);url.searchParams.set('view',view);if(view==='refine'&&current)url.searchParams.set('project',current);else url.searchParams.delete('project');url.hash='';window.history.replaceState(null,'',url);localStorage.setItem(key,JSON.stringify({idea:$('idea').value,current,pending,pendingSelection,lastOperation,drafts,view,deliveryVersion,music:readMusic('music'),autoMusic:$('auto-music').checked,brief:readBrief()}));}catch{}}
function saveEdit(){if(editorFor)drafts[editorFor]={...drafts[editorFor],lineIndex:Number($('edit-line').value),mode:$('edit-mode').value,instruction:$('edit-instruction').value};remember();}
async function api(path='',body){const response=await fetch('/api/compositions'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.error||'本机服务暂不可用');return value;}
function message(text,error=false){$('job-message').textContent=text;$('job-message').classList.toggle('error',error);if(error&&view!=='refine'){$('operation-message').textContent=text;$('operation-message').classList.add('error');}}
function feedback(text,error=false){$('edit-feedback').textContent=text;$('edit-feedback').classList.toggle('error',error);}
function controls(){
  const active=running(),locked=busy||!!active,canEdit=selected()?.state==='succeeded';$('auto-music').disabled=locked;$('music-manual').hidden=$('auto-music').checked;const expressive=selected()?.score?.format==='expressive-v1';$('rearrange-panel').hidden=expressive;const performanceOption=$('edit-mode').querySelector('[value=performance]');performanceOption.disabled=!expressive;performanceOption.hidden=!expressive;
  $('compose').disabled=locked||!data?.connection.ready||$('idea').value.trim().length<4||($('auto-music').checked?!data?.musicCapabilities?.voices.some(v=>v.ready):!validMusic('music'));
  for(const prefix of ['music','arrange']){for(const k of ['style','bpm','voice','texture'])$(prefix+'-'+k).disabled=locked||(prefix==='music'&&$('auto-music').checked)||(prefix==='arrange'&&!selected()?.prepared)||(k==='texture'&&$(prefix+'-style').value!=='retro');$(prefix+'-texture').parentElement.hidden=$(prefix+'-style').value!=='retro';}
  for(const prefix of ['music','arrange'])for(const option of $(prefix+'-voice').options)option.disabled=!data?.musicCapabilities?.voices.find(v=>v.id===option.value)?.ready;
  $('arrange-submit').disabled=locked||!selected()?.prepared||!validMusic('arrange')||JSON.stringify(selected()?.score?.music)===JSON.stringify(readMusic('arrange'));musicScope();$('idea').disabled=locked;$('example').disabled=locked;
  $('sing').disabled=locked||!data?.singerReady;$('cancel').hidden=!active;$('cancel').disabled=busy;
  for(const id of ['edit-line','edit-mode','edit-instruction'])$(id).disabled=locked||!canEdit;for(const field of ['audience','feelingStart','feelingEnd','keep'])$('brief-'+field).disabled=locked;
  $('propose').disabled=locked||!canEdit||!data?.connection.ready||$('edit-instruction').value.trim().length<4;
  $('idea-count').textContent=`${$('idea').value.length} / 1200`;
  $('new-panel').hidden=view!=='new';$('refine-panel').hidden=view!=='refine';
  $('workspace').dataset.view=view;
  const front=document.querySelector(view==='new'?'.creation-column':'.result-panel');
  if($('workspace').firstElementChild!==front){const focus=document.activeElement;$('workspace').prepend(front);focus?.focus({preventScroll:true});}
  $('tab-new').setAttribute('aria-pressed',String(view==='new'));$('tab-refine').setAttribute('aria-pressed',String(view==='refine'));
  const job=selected();
  const stage=active?.state==='composing'&&active.stage==='arrangement'?['正在编配','新伴奏准备好后，先试听再确认这一版。']:active?.state==='composing'?['正在写词曲','草稿准备好后，先听旋律，再决定是否演唱。']:active?.state==='singing'?['正在演唱','原版可以继续试听，完成后再比较。']:view==='new'?['01 · 写下想法','先生成一段词曲草稿，不会直接重做已有作品。']:job?.state==='succeeded'?['03 · 试听与打磨','先听，再选一句修改；A / B 可比较前后版本。']:job?.prepared?['02 · 确认词曲','先听旋律并检查歌词，满意后点击生成演唱。']:['01 · 写下想法','从一个具体画面和想表达的感受开始。'];
  $('flow-stage').textContent=stage[0];$('flow-next').textContent=stage[1];updateFlow(job,active);
}
function editScope(){
  const job=selected(),i=Number($('edit-line').value),phrase=job?.score?.phrases[i],lyric=$('edit-mode').value==='lyrics',phrasing=$('edit-mode').value==='phrasing';
  $('edit-base').textContent=job?.prepared?`${job.score.title} · 基于 ${version(job)} 继续`:'先创作或打开一首歌';
  $('edit-original').textContent=phrase?.lyrics||'演唱完成后，可指定一句修改。';
  $('edit-scope').textContent=phrase?`只修改第 ${i+1} 句（${phrase.start.toFixed(1)}–${phrase.end.toFixed(1)} 秒）。${$('edit-mode').value==='performance'?'只调整气声与咬字速度，歌词、旋律和时长保持。':phrasing?'可一起改歌词字数、旋律和句内停顿，整句的起止时间保持。':lyric?`保留原来的 ${phrase.syllables?.length||phrase.notes.length} 个字、节奏和旋律，只改等字数歌词与发音。`:'只调整音高，保留歌词、发音和每个字的时长。'}伴奏、速度和其他三句音频保持不变。`:'先完成一份词曲及演唱，再开始局部打磨。';
  if(job?.state!=='succeeded')feedback(job?.prepared?'先确认这份词曲并完成演唱，再继续局部修改。':'');
}
function choose(id,{editing=true}={}){
  saveEdit();current=id;deliveryVersion=null;slot='B';mode=selected()?.state==='succeeded'?'song':'guide';seekStart=selected()?.difference?.region.start??0;audioSignature='';lastShown=null;editorFor=null;if(editing)view='refine';render();remember();
}
function audio(){
  const job=heard();if(!job?.prepared)return;
  const signature=job.id+':'+mode;
  const url=`/api/compositions/${job.id}/assets/${mode}`;
  if(signature!==audioSignature){audioSignature=signature;const time=seekStart??pendingAudioPosition??(player.currentTime||0),playing=!player.paused;pendingAudioPosition=time;seekStart=null;player.pause();player.onloadedmetadata=()=>{player.currentTime=Math.min(seekStart??time,Math.max(0,player.duration-.01));seekStart=null;pendingAudioPosition=null;if(playing)player.play().catch(()=>{});};player.src=url;}
  $('save-audio').href=url;$('save-audio').download=`${job.score.title}-${version(job)}-${mode}.wav`;
  for(const [id,kind,ext]of [['save-lyrics','lyrics','txt'],['save-midi','midi','mid'],['save-score','score','json']]){$(id).href=`/api/compositions/${job.id}/assets/${kind}`;$(id).download=`${job.score.title}-${version(job)}.${ext}`;}
  $('listen-caption').textContent=`${version(job)} · `+(mode==='guide'?'器乐旋律示范，不含演唱':mode==='backing'?(job.score.music?'采样乐器伴奏 · '+musicLabel(job.score.music):'早期合成伴奏'):mode==='vocal'?job.score.voice+' · 独立人声':job.score.voice+' · 演唱与伴奏');
}
function proposal(job){
  const diff=job.difference;$('proposal').hidden=!diff;$('compare').hidden=!diff;
  if(!diff)return;
  const proposalKey=job.id+':'+job.state;if($('proposal').dataset.version!==proposalKey){$('proposal').dataset.version=proposalKey;$('proposal').open=job.state!=='succeeded';}
  const before=data.jobs.find(j=>j.id===job.baseVersion),lyric=diff.mode==='lyrics',phrasing=diff.mode==='phrasing';
  if(diff.mode==='arrangement'){
    $('proposal-title').textContent=`${version(before)} → ${version(job)} · 音乐方向`;
    $('proposal-intent').textContent='你的选择：'+musicLabel(diff.after);$('proposal-explanation').textContent=diff.description;
    $('diff-before').textContent=musicLabel(diff.before);$('diff-after').textContent=musicLabel(diff.after);
    $('proposal-locks').textContent='保持不变：'+diff.preserved.join('、')+'。';
    $('preservation-evidence').textContent=job.result?.scoreNotesPreserved?(job.result.reusedVocal?'已检查：原人声文件逐字节一致，只更换伴奏。':'已检查：歌词、音高和拍数关系一致；全部四句已重新演唱。'):'先比较器乐试听，确认后制作这一版。';
    $('compare-A').textContent=`A · 修改前 ${version(before)}`;$('compare-B').textContent=`B · 当前 ${version(job)}`;
    for(const value of ['A','B'])$('compare-'+value).setAttribute('aria-pressed',String(slot===value));return;
  }
  $('proposal-title').textContent=`${version(before)} → ${version(job)} · 第 ${diff.lineIndex+1} 句`;
  $('proposal-intent').textContent=`你的要求：${job.revision.instruction}`;$('proposal-explanation').textContent=diff.description;
  const pronunciationOnly=lyric&&diff.before.lyrics===diff.after.lyrics;
  $('diff-before').textContent=diff.mode==='performance'?diff.before.intent:phrasing?diff.before.phrasing+'（'+diff.before.syllables+' 字）':lyric?diff.before.lyrics+(pronunciationOnly?' · '+diff.before.pinyin.join(' '):''):diff.before.pitches.join(' → ');
  $('diff-after').textContent=diff.mode==='performance'?diff.after.intent:phrasing?diff.after.phrasing+'（'+diff.after.syllables+' 字，/ 表示实际停顿）':lyric?diff.after.lyrics+(pronunciationOnly?' · '+diff.after.pinyin.join(' '):''):diff.after.pitches.join(' → ');
  $('proposal-locks').textContent=diff.mode==='performance'?`调整本句逐字气声与咬字速度。保持不变：${diff.preserved.join('、')}。`:phrasing?`本句的词、节奏和音高可共同变化。保持不变：${diff.preserved.join('、')}。`:`实际改变 ${diff.changedNotes.length} 个字的${lyric?'文字或发音':'音高'}。保持不变：${diff.preserved.join('、')}。`;
  $('preservation-evidence').textContent=job.result?.unchangedOutsideRegion?'已检查导出的音频：所选句子之外，与修改前逐样本一致。':diff.mode==='performance'?'词曲和伴奏保持不变。确认生成演唱后，才能试听气声与咬字的差异。':lyric?'尚未生成新版演唱。旋律示范沿用原曲，确认后才会唱出新词。':'尚未生成新版演唱。可先用 A / B 比较旋律，确认后只重唱这一句。';
  $('compare-A').textContent=`A · 修改前 ${version(before)}`;$('compare-B').textContent=`B · 当前 ${version(job)}`;
  for(const value of ['A','B'])$('compare-'+value).setAttribute('aria-pressed',String(slot===value));
}
function history(){
  const expanded=new Set([...$('history-list').querySelectorAll('details[open]')].map(d=>d.dataset.project));
  const groups=new Map();for(const job of data.jobs){const id=job.projectId||job.id;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(job);}
  $('history-list').replaceChildren(...[...groups.values()].map(jobs=>{
    const group=node('section',undefined,'history-group');group.append(node('h3',jobs.find(j=>j.prepared)?.score.title||'未完成的新想法'));const intent=jobs.find(j=>j.brief)?.brief;if(intent)group.append(node('p',[intent.feelingStart,intent.feelingEnd].filter(Boolean).join(' → '),'project-feeling'));
    const head=jobs.find(j=>j.state==='succeeded')||jobs.find(j=>j.prepared)||jobs[0],older=node('details',undefined,'older-versions');older.dataset.project=head.projectId||head.id;older.open=expanded.has(older.dataset.project);older.append(node('summary',`其他 ${jobs.length-1} 个版本与记录`));
    for(const j of [head,...jobs.filter(j=>j!==head)]){const row=node('div',undefined,'history-row'+(j.id===current?' selected':'')),copy=node('div'),title=node('b');title.append(node('span',version(j),'version-number'),node('span',j.revision?`第 ${j.revision.lineIndex+1} 句 · ${j.revision.mode==='performance'?'改唱法':j.revision.mode==='lyrics'?'改歌词':j.revision.mode==='phrasing'?'词句与断句':'改音高'}`:j.arrangement?musicLabel(j.music):j.music?musicLabel(j.music):'最初的词曲'));
      const base=data.jobs.find(b=>b.id===j.baseVersion),detail=node('p',`${labels[j.state]}${base?' · 基于 '+version(base):''} · ${new Date(j.createdAt).toLocaleString('zh-CN')}`);copy.append(title,detail);
      const button=node('button',j.state==='succeeded'?'打开作品':j.prepared?'查看草稿':'查看记录','secondary');button.addEventListener('click',()=>{choose(j.id);$('workspace').scrollIntoView({block:'start'});});row.append(copy,button);(j===head?group:older).append(row);
    }if(jobs.length>1)group.append(older);return group;
  }));
  if(!data.jobs.length)$('history-list').append(node('p','这里还没有自己的作品。从上面的新想法开始，词曲和演唱会自动保存在这台电脑。'));
}
function render(){
  if(!data){controls();return;}const job=selected(),active=running(),last=data.jobs.find(j=>j.id===lastOperation);
  $('operation-message').textContent=active?.message||(last&&['failed','cancelled','interrupted'].includes(last.state)?last.message:'');$('operation-message').classList.toggle('error',!active&&last?.state==='failed');
  $('connection').textContent=data.connection.message;$('empty').hidden=!!job?.prepared;$('draft').hidden=!job?.prepared;
  $('result-badge').textContent=job?`${version(job)} · ${labels[job.state]}`:'等待灵感';message(job?.message||'',!!job&&['failed','interrupted'].includes(job.state));
  if(editorFor!==job?.id){editorFor=job?.id||null;const saved=drafts[editorFor]||{};$('edit-line').value=String(saved.lineIndex??job?.revision?.lineIndex??2);$('edit-mode').value=saved.mode||job?.revision?.mode||(job?.score?.format==='expressive-v1'?'performance':'lyrics');$('edit-instruction').value=saved.instruction||'';feedback('');}
  if(arrangementFor!==job?.id){arrangementFor=job?.id||null;const m=drafts[job?.id]?.music||job?.score?.music||{style:'retro',bpm:job?.score?.bpm||116,voice:'ria'};for(const k of ['style','bpm','voice','texture'])$('arrange-'+k).value=m[k]??(k==='texture'?'standard':'');$('arrange-feedback').textContent='';}
  editScope();
  if(job?.prepared){
    const completed=job.state==='succeeded';
    if(lastShown===null&&seekStart===null)seekStart=job.difference?.region.start??0;
    if(lastShown!==job.id+':'+job.state){if(completed){mode='song';feedback('');}else if(!['guide','backing'].includes(mode))mode='guide';lastShown=job.id+':'+job.state;}
    if(!job.baseVersion)slot='B';const heardJob=heard(),s=heardJob.score;
    $('song-title').textContent=s.title;$('song-facts').textContent=`${version(heardJob)} · ${s.music?musicLabel(s.music):s.bpm+' BPM'} · ${s.duration} 秒`;$('source-idea').textContent=job.idea;$('song-description').textContent=(job.arrangement?'初稿词曲构思（速度与配器描述指初稿；当前设置见上方）：':'')+s.description;
    $('emotion-plan').hidden=!s.emotionalArc;$('emotion-arc').textContent=s.emotionalArc||'';$('phrase-intents').replaceChildren(...s.phrases.filter(p=>p.intent).map(p=>node('li',p.intent)));$('arrangement-intents').replaceChildren(...(s.authored?.arrangement||[]).map(t=>node('p',t.role)));proposal(job);$('comparison-caption').textContent=(job.arrangement&&job.difference.before.bpm!==job.difference.after.bpm?'两版速度不同，按同一拍的位置切换。 ':'')+(job.baseVersion?`正在试听 ${slot} · ${version(heardJob)}${heardJob.state!=='succeeded'?' 的旋律示范':''}`:`正在试听 ${version(job)}`);
    $('song-lyrics').replaceChildren(...s.lyrics.map((line,i)=>{const row=node('button',undefined,'lyric-line'+(job.difference?.lineIndex===i?' changed':''));row.type='button';row.setAttribute('aria-label',`试听第 ${i+1} 句：${line}`);row.append(node('small',`0${i+1}`),node('span',s.phrases[i].syllables?s.phrases[i].syllables.map(n=>n.lyric).join(''):s.phrases[i].notes.map(n=>n.lyric+(n.restAfter?' · ':'')).join('')));row.onclick=()=>{const start=s.phrases[i].start;if(player.readyState)player.currentTime=start;else seekStart=start;if(!$('edit-line').disabled){$('edit-line').value=String(i);editScope();saveEdit();}player.play().catch(()=>message('请点击播放器开始试听。'));};return row;}));
    $('note-grid').replaceChildren(...s.phrases.map(p=>{const row=node('div',undefined,'note-row');for(const [i,n]of p.notes.entries()){const cell=node('div',undefined,'note'+(job.difference?.lineIndex===p.index&&job.difference.changedNotes.includes(i)?' changed':''));cell.style.flex=String(n.beats);cell.title=`${n.lyric} · ${n.pinyin} · ${n.pitch} · ${n.beats} 拍`;cell.append(node('span',n.continuation?'—':n.lyric),node('small',n.pitch),node('small',n.beats+' 拍'));row.append(cell);if(n.restAfter){const rest=node('div',undefined,'note note-rest');rest.style.flex=String(n.restAfter);rest.title='停顿 '+n.restAfter+' 拍';rest.append(node('span','休'),node('small',n.restAfter+' 拍'));row.append(rest);}}return row;}));
    $('sing').hidden=completed;$('sing').textContent=job.arrangement?(job.difference.reuseVocal?`确认并合成 ${version(job)}，保留原人声`:`确认并重新演唱 ${version(job)}`):job.revision?`确认这份修改，生成 ${version(job)} 演唱`:'确认词曲，把这段唱出来 ♪';
    const modes=heardJob.state==='succeeded'?[['song','演唱 + 伴奏'],['vocal','单独人声'],['guide','旋律示范 · 无演唱'],['backing','单独伴奏']]:[['guide','旋律示范 · 尚无新版演唱'],['backing','单独伴奏']];
    if(!modes.some(([value])=>value===mode))mode='guide';
    $('listen-kind').replaceChildren(...modes.map(([value,label])=>{const option=node('option',label);option.value=value;return option;}));$('listen-kind').value=mode;audio();
  }else{player.pause();player.removeAttribute('src');player.load();audioSignature='';lastShown=null;}
  history();controls();remember();
}
async function load(){if(loading)return loading;loading=(async()=>{
  data=await api();const sent=data.jobs.find(j=>j.requestId===pending?.requestId);if(sent){pendingSelection=sent.id;lastOperation=sent.id;pending=null;}
  const destination=data.jobs.find(j=>j.id===pendingSelection);let switchTo=null;
  if(destination?.prepared){switchTo=destination.id;pendingSelection=null;}
  else if(destination&&['failed','cancelled','interrupted'].includes(destination.state))pendingSelection=null;
  if(!selected()){current=data.jobs.find(j=>j.prepared)?.id||data.jobs[0]?.id||null;if(!current&&view==='refine')view='new';}
  if(switchTo&&switchTo!==current)choose(switchTo);else render();
  clearTimeout(timer);if(running())timer=setTimeout(()=>load().catch(connectionError),1800);
})().finally(()=>loading=null);return loading;}
function connectionError(error){message(`连接失败：${error.message}。已有作品仍保留，恢复服务后可刷新记录。`,true);busy=false;controls();if(running()){clearTimeout(timer);timer=setTimeout(()=>load().catch(connectionError),4000);}}
async function submitted(job){if(!job.baseVersion){current=job.id;view='refine';slot='B';mode='guide';audioSignature='';}pendingSelection=job.id;lastOperation=job.id;pending=null;remember();if(loading)await loading;await load();}
$('tab-new').addEventListener('click',()=>changeView('new'));$('tab-refine').addEventListener('click',()=>changeView('refine'));
$('idea').addEventListener('input',()=>{pending=null;controls();remember();});$('example').addEventListener('click',()=>{$('idea').value=example;pending=null;controls();remember();});
for(const id of ['edit-line','edit-mode','edit-instruction'])$(id).addEventListener(id==='edit-instruction'?'input':'change',()=>{pending=null;saveEdit();editScope();controls();});
$('compose').addEventListener('click',async()=>{if(busy||running())return;busy=true;controls();if(pending?.kind!=='create')pending={kind:'create',requestId:crypto.randomUUID(),idea:$('idea').value.trim(),brief:readBrief(),creationMode:'expressive',music:$('auto-music').checked?null:readMusic('music')};remember();try{await submitted(await api('',pending));}catch(error){await load().catch(()=>{});message(error.message,true);}finally{busy=false;controls();remember();}});
$('propose').addEventListener('click',async()=>{const job=selected();if(busy||running()||job?.state!=='succeeded')return;busy=true;controls();saveEdit();if(pending?.kind!=='revision'||pending.baseVersion!==job.id)pending={kind:'revision',requestId:crypto.randomUUID(),baseVersion:job.id,...drafts[job.id]};remember();try{feedback('正在准备修改稿，原版可以继续试听。');await submitted(await api(`/${job.id}/revise`,pending));}catch(error){await load().catch(()=>{});feedback(error.message,true);}finally{busy=false;controls();remember();}});
$('sing').addEventListener('click',async()=>{const job=selected();if(!job||busy)return;busy=true;controls();try{await api(`/${job.id}/render`,{scoreHash:job.scoreHash});lastOperation=job.id;slot='B';if(loading)await loading;await load();}catch(error){message(error.message,true);}finally{busy=false;controls();remember();}});
$('cancel').addEventListener('click',async()=>{const job=running();if(!job||busy)return;busy=true;controls();try{await api(`/${job.id}/cancel`,{});lastOperation=job.id;if(loading)await loading;await load();}catch(error){message(error.message,true);}finally{busy=false;controls();remember();}});
for(const value of ['A','B'])$('compare-'+value).addEventListener('click',()=>{const old=heard();if(slot===value)return;const position=(player.ended?0:(seekStart??pendingAudioPosition??player.currentTime))*(old?.score?.bpm||60)/60;slot=value;seekStart=position*60/(heard()?.score?.bpm||60);render();});
$('return-base').addEventListener('click',()=>{if(selected()?.baseVersion)choose(selected().baseVersion);});
$('listen-kind').addEventListener('change',event=>{mode=event.target.value;audio();});$('refresh').addEventListener('click',()=>load().catch(connectionError));
player.addEventListener('error',()=>{if(player.getAttribute('src'))message('音频读取失败，请刷新记录后重试。',true);});

function changeView(next){saveEdit();if(next==='delivery')deliveryVersion=heard()?.id||null;listeningTrial?.pause();for(const a of document.querySelectorAll('audio'))a.pause();view=next;render();remember();document.querySelector('main').scrollIntoView({block:'start'});}
function describeBrief(brief){return brief?[brief.audience?`写给：${brief.audience}`:'',brief.feelingStart?`从「${brief.feelingStart}」开始`:'',brief.feelingEnd?`走向「${brief.feelingEnd}」`:'',brief.keep?`保留：${brief.keep}`:''].filter(Boolean).join(' · '):'';}
function updateFlow(job,active){
  if(data&&view==='delivery'&&job?.state!=='succeeded')view='refine';
  const home=view==='home',fresh=view==='new',delivery=view==='delivery',working=!home&&!fresh&&!delivery;document.querySelector('.skip-link').href=home?'#library':delivery?'#delivery-panel':'#workspace';
  $('baseline-lab').hidden=!home;$('sound-baseline').hidden=!home;$('previous-trial-wrap').hidden=!home;$('listening-discovery').hidden=!home;$('style-discovery-wrap').hidden=!home;$('style-discovery').hidden=!home;$('home-start').hidden=!home;$('library').hidden=!home;$('workspace').hidden=home||delivery;
  $('creation-progress').hidden=home;$('intent-panel').hidden=!fresh;document.querySelector('.result-panel').hidden=!working;
  $('delivery-panel').hidden=!delivery;document.body.dataset.screen=view;
  $('nav-home').setAttribute('aria-current',home?'page':'false');$('nav-new').setAttribute('aria-current',fresh?'page':'false');
  $('tab-refine').hidden=!job;$('tab-refine').textContent=fresh?'返回上次作品':'试听与修改';$('tab-new').textContent='另一个新想法';
  $('page-eyebrow').textContent=home?'你的音乐创作室':fresh?'新作品 · 先找到想表达的感受':delivery?'作品版本 · 准备导出':'正在创作 · 每一版都可以回听';
  $('page-title').textContent=home?'从一个想法，到自己的声音。':fresh?'这一次，想把什么唱出来？':delivery?'把这一版，留在身边。':job?.score?.title||'正在写下你的第一稿';
  $('page-description').textContent=home?'从你的经历和感受出发，一起创作词、曲、唱法和伴奏。':fresh?'写下故事，再确定情绪从哪里开始、走向哪里。':delivery?'导出选定的小样和创作材料，之后仍可回来修改。':job?.state==='succeeded'?'听这一版，找出最想保留和最想改善的一句。':'先核对歌词与旋律，确认后再生成演唱。';
  $('scope-badge').textContent='中文歌曲小样 · 四句起步';
  const step=fresh?0:delivery?3:job?.state==='succeeded'||active?.state==='singing'?2:1;
  for(const item of document.querySelectorAll('[data-step]')){const n=Number(item.dataset.step);item.classList.toggle('complete',n<step);if(n===step)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');}
  if(delivery){$('flow-stage').textContent='04 · 导出这一版';$('flow-next').textContent='下载后仍保留作品与全部历史版本。';}
  const copy=describeBrief(job?.brief);$('direction-summary').hidden=!copy;$('direction-summary').textContent=copy;
  $('open-delivery').hidden=job?.state!=='succeeded';
  if(!job?.prepared){$('empty').querySelector('h3').textContent=job?.state==='composing'?'正在把想法写成词曲':'这一稿还没有完成';$('empty').querySelector('p').textContent=job?.state==='composing'?'准备好后会在这里显示歌词与旋律。你可以取消处理，想法仍会保留。':'想法与已有记录仍在。可以返回我的作品，或重新提交创作。';}
  if(delivery&&job?.state==='succeeded'){const picked=data.jobs.find(j=>j.id===deliveryVersion&&j.state==='succeeded')||heard();$('delivery-title').textContent=`${picked.score.title} · ${version(picked)}`;$('delivery-description').textContent=`四句原创小样 · ${picked.score.duration} 秒 · ${picked.score.bpm} BPM · 已生成演唱`;$('delivery-direction').textContent=describeBrief(picked.brief)||'这个早期作品尚未单独记录情绪目标，最初想法已包含在作品记录中。';
    const files=[['song','演唱与伴奏','WAV · 完整小样','wav'],['vocal','独立人声','WAV · 无伴奏','wav'],['backing','伴奏','WAV · 无人声','wav'],['lyrics','歌词','TXT · 当前版本','txt'],['midi','旋律乐谱','MIDI · 可继续制作','mid'],['score','词曲与创作目标','JSON · 音符、和弦和情绪目标','json']];
    if(picked.score.music)files.push(['arrangement','伴奏乐谱','MIDI · 多轨乐器编配','mid'],['instruments','编配信息','JSON · 风格、速度与乐器音符','json']);
    $('delivery-files').replaceChildren(...files.map(([kind,title,detail,ext])=>{const link=node('a',undefined,'delivery-file');link.href=`/api/compositions/${picked.id}/assets/${kind}`;link.download=`${picked.score.title}-${version(picked)}-${kind}.${ext}`;link.append(node('b',title),node('span',detail),node('small','下载 ↓'));return link;}));
  }
}
for(const [id,next] of [['nav-home','home'],['nav-new','new'],['start-project','new'],['back-to-library','home'],['back-to-song','refine'],['open-delivery','delivery']])$(id).addEventListener('click',event=>{event.preventDefault();changeView(next);});
for(const field of ['audience','feelingStart','feelingEnd','keep'])$('brief-'+field).addEventListener('input',()=>{pending=null;remember();});

for(const prefix of ['music','arrange'])for(const k of ['style','bpm','voice','texture'])$(prefix+'-'+k).addEventListener(k==='bpm'?'input':'change',()=>{if(k==='style'){$(prefix+'-bpm').value=musicStyles.find(s=>s.id===$(prefix+'-style').value).bpm;$(prefix+'-texture').value='standard';}if(prefix==='music')$('preference-applied').hidden=true;pending=null;if(prefix==='arrange'&&editorFor)drafts[editorFor]={...drafts[editorFor],music:readMusic('arrange')};controls();remember();});
$('arrange-submit').addEventListener('click',async()=>{const job=selected();if(busy||running()||!job?.prepared||!validMusic('arrange'))return;busy=true;controls();if(pending?.kind!=='arrangement'||pending.baseVersion!==job.id)pending={kind:'arrangement',requestId:crypto.randomUUID(),baseVersion:job.id,music:readMusic('arrange')};remember();try{$('arrange-feedback').textContent='正在准备新的音乐版本，原版保留。';await submitted(await api(`/${job.id}/rearrange`,pending));}catch(error){await load().catch(()=>{});$('arrange-feedback').textContent=error.message;}finally{busy=false;controls();remember();}});
$('auto-music').addEventListener('change',()=>{pending=null;controls();remember();});
const requestedStyle=new URLSearchParams(location.search).get('style');if(musicStyles.some(s=>s.id===requestedStyle)){$('auto-music').checked=false;$('music-texture').value='standard';$('music-style').value=requestedStyle;$('music-bpm').value=musicStyles.find(s=>s.id===requestedStyle).bpm;const url=new URL(location.href);const voice=url.searchParams.get('voice');if(singerChoices.some(s=>s.id===voice))$('music-voice').value=voice;url.searchParams.delete('style');url.searchParams.delete('voice');window.history.replaceState(null,'',url);}
initSoundBaseline($('sound-baseline'));
initStyleDiscovery($('style-discovery'),{pause:()=>player.pause(),choose:style=>{if(busy||running())return;$('auto-music').checked=false;$('preference-applied').hidden=true;$('music-texture').value='standard';$('music-style').value=style.id;$('music-bpm').value=style.bpm;if(style.voice)$('music-voice').value=style.voice;pending=null;changeView('new');}});
listeningTrial=initListeningTrial($('listening-discovery'),{onOpen:id=>{if(busy||running()||!data?.jobs.some(j=>j.id===id))return false;choose(id);document.querySelector('main').scrollIntoView({block:'start'});return true;},onUse:music=>{if(busy||running())return false;$('auto-music').checked=false;for(const k of ['style','bpm','voice','texture'])$('music-'+k).value=music[k]??(k==='texture'?'standard':'');pending=null;$('preference-applied').textContent='已带入本轮选择：'+musicLabel(music)+'。你的故事和情绪目标保留，可以继续调整。';$('preference-applied').hidden=false;changeView('new');return true;}});
controls();await load().catch(connectionError);
