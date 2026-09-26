const $=id=>document.getElementById(id),audio=$('audio');
let data,slot='A',baseline='A',current='B',preview=null,busy=false,pollTimer=null,loadInFlight=null,trackedJob=null,seenVersions='',pendingRequest=null,revision=0;
const key='sonara-score-editor-v1';let saved={};
try{saved=JSON.parse(localStorage.getItem(key)||'{}');baseline=saved.baseline||'A';current=saved.current||'B';slot=saved.slot==='B'?'B':'A';trackedJob=saved.trackedJob||null;pendingRequest=saved.pendingRequest||null;}catch{}
const selected=()=>data.versions.find(v=>v.id===current);
const heard=()=>data.versions.find(v=>v.id===(slot==='A'?baseline:current));
const active=()=>data?.jobs.find(j=>['queued','running'].includes(j.state));
function remember(){try{localStorage.setItem(key,JSON.stringify({baseline,current,slot,trackedJob,pendingRequest,draft:{baseVersion:current,lineIndex:Number($('line-index').value),lyrics:$('edit-lyrics').value}}));}catch{}}
async function api(path,body){const response=await fetch(`/api/score${path}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.error||'本机服务暂不可用');return value;}
function note(message,error=false){$('edit-status').textContent=message;$('edit-status').classList.toggle('error',error);}
function controls(){const locked=busy||!!active()||!data?.ready;for(const id of ['line-index','edit-lyrics','check-lyrics'])$(id).disabled=locked;$('generate-line').disabled=locked||!preview;for(const input of $('pronunciation').querySelectorAll('input'))input.disabled=locked;$('cancel-job').hidden=!active();$('cancel-job').disabled=busy;}
function invalidate(){revision++;preview=null;pendingRequest=null;$('pronunciation-box').hidden=true;$('counter').textContent=`${[...$('edit-lyrics').value.replace(/[\s，。！？、,.!?；;：:]/g,'')].length} / 8 字`;controls();remember();}
function editLine(index,{restore=false}={}){
  $('line-index').value=String(index);const phrase=data.score.phrases[index];
  $('before-line').textContent=selected().lyrics[index];
  $('edit-lyrics').value=restore&&saved.draft?.baseVersion===current?saved.draft.lyrics:selected().lyrics[index];
  $('scope').textContent=`只重唱第 ${index+1} 句（${phrase.start}–${phrase.end} 秒）。保留旋律与伴奏，其他三句原样保留。`;
  invalidate();note('先检查歌词和拼音，再确认生成。');
}
function renderScore(){
  $('score').replaceChildren(...data.score.phrases.map(phrase=>{const row=document.createElement('div');row.className='score-row';for(const n of phrase.notes){const block=document.createElement('span');block.className='note-block';block.style.left=`${(n.beat-phrase.index*8)/8*100}%`;block.style.width=`${n.beats/8*100-.5}%`;block.style.bottom=`${(n.midi-55)/12*37}px`;block.title=`${n.pitch} · ${n.beats} 拍`;row.append(block);}return row;}));
}
function selectors(){
  const signature=JSON.stringify(data.versions.map(v=>v.id));
  if(signature!==seenVersions){for(const id of ['baseline-version','current-version'])$(id).replaceChildren(...data.versions.map(v=>{const option=document.createElement('option');option.value=v.id;option.textContent=v.name;return option;}));seenVersions=signature;
    $('version-list').replaceChildren(...data.versions.slice().reverse().map(v=>{const row=document.createElement('div');row.className='history-row';const text=document.createElement('div');const title=document.createElement('b');title.textContent=v.name;const detail=document.createElement('p');detail.textContent=v.builtIn?'已保留的示例版本':`${new Date(v.createdAt).toLocaleString('zh-CN')} · 已自动保存`;text.append(title,detail);const button=document.createElement('button');button.className='secondary';button.textContent='继续此版';button.addEventListener('click',()=>chooseCurrent(v.id));row.append(text,button);return row;}));
  }
  $('baseline-version').value=baseline;$('current-version').value=current;
}
function chooseCurrent(id){if(active()||busy){note('这一句完成或取消后，再选择要继续修改的版本。');return;}current=id;slot='B';selectors();editLine(Number($('line-index').value));refreshAudio();remember();}
function refreshAudio({reset=false,position}={}){
  const version=heard(),time=position??(reset?0:audio.currentTime||0),playing=!audio.paused;audio.pause();
  const mode=$('listen-mode').value;
  const url=mode==='guide'?'/score-trial/melody-guide.wav':mode==='backing'?'/score-trial/accompaniment.wav':`/api/score/versions/${version.id}/${mode==='mix'?'song':'vocal'}`;
  audio.onloadedmetadata=()=>{audio.currentTime=Math.min(time,Number.isFinite(audio.duration)?audio.duration:data.score.duration);if(playing)audio.play().catch(()=>{});};
  audio.src=url;$('download').href=url;$('download').download=`晚风来信-${slot}-${mode}.wav`;$('download').removeAttribute('aria-disabled');
  $('midi').href=`/api/score/versions/${version.id}/midi`;$('midi').download=`晚风来信-${slot}.mid`;
  $('lyrics-download').href=`/api/score/versions/${version.id}/lyrics`;$('lyrics-download').download=`晚风来信-${slot}-歌词.txt`;
  $('play-label').textContent=mode==='guide'?'器乐旋律示范，不含歌声':mode==='backing'?'相同的原创合成伴奏，不含歌声':`${slot} · ${version.name} · Ria / 狸安${mode==='mix'?' · 演唱 + 伴奏':' · 单独人声'}`;
  const compare=data.versions.find(v=>v.id===(slot==='A'?current:baseline));
  $('lyrics').replaceChildren(...version.lyrics.map((line,i)=>{const row=document.createElement('button');row.className=`lyric ${line!==compare.lyrics[i]?'changed':''}`;row.title=`修改第 ${i+1} 句`;row.setAttribute('aria-label',`修改第 ${i+1} 句：${line}`);const index=document.createElement('small');index.textContent=`0${i+1}`;const text=document.createElement('span');text.textContent=line;row.append(index,text);row.addEventListener('click',()=>{if(active()||busy)return;editLine(i);slot='B';refreshAudio({position:data.score.phrases[i].start});remember();$('edit-lyrics').focus();});return row;}));
  for(const value of ['A','B']){$(`choose-${value}`).classList.toggle('selected',slot===value);$(`choose-${value}`).setAttribute('aria-pressed',String(slot===value));}
  const result=version.result;$('evidence').textContent=result?`本版只重唱 ${result.changedRegion.start}–${result.changedRegion.end} 秒。与它的上一个版本相比，其余音频逐样本一致；旋律控制已保留。`:version.id==='B'?'此示例只改变 6–12 秒的第二句，其余音频与原始试唱一致。':'原始试唱 · 后续修改都会另存为新版本。';
}
function renderJobs(){
  const running=active(),tracked=data.jobs.find(j=>j.id===trackedJob);
  $('status').textContent=running?running.message:data.ready?'本机歌声合成已就绪 · 改一句歌词，试听更接近你的版本。':data.message;
  $('job-status').textContent=running?`${running.message}。通常需要几十秒，可以继续试听。`:tracked?.message||'新版本自动保存在这台电脑，刷新页面后仍可找回。';
  $('job-status').classList.toggle('error',!!tracked&&['failed','interrupted'].includes(tracked.state));controls();
}
async function load({initial=false}={}){
  if(loadInFlight)return loadInFlight;
  loadInFlight=(async()=>{
    const firstLoad=initial||!data;
    data=await api('');
    if(!data.versions.some(v=>v.id===baseline))baseline='A';if(!data.versions.some(v=>v.id===current))current='B';
    const pending=data.jobs.find(j=>j.request.requestId===pendingRequest?.requestId);if(pending)trackedJob=pending.id;
    const tracked=data.jobs.find(j=>j.id===trackedJob);let finished=false;
    if(tracked?.state==='succeeded'&&pendingRequest){baseline=tracked.baseVersion;current=tracked.id;slot='B';pendingRequest=null;finished=true;}
    if(tracked&&['failed','cancelled','interrupted'].includes(tracked.state))pendingRequest=null;
    selectors();
    if(firstLoad){renderScore();const index=Number(saved.draft?.lineIndex);const retained=pendingRequest;editLine(Number.isInteger(index)&&index>=0&&index<4?index:1,{restore:!finished});pendingRequest=retained;refreshAudio({reset:true});}
    else if(finished){editLine(tracked.lineIndex);refreshAudio();note('新版已经保存。用 A / B 听修改前后的区别。');}
    renderJobs();remember();clearTimeout(pollTimer);if(active())pollTimer=setTimeout(()=>load().catch(connectionError),1500);
  })().finally(()=>{loadInFlight=null;});return loadInFlight;
}
function connectionError(error){$('status').textContent=`连接本机服务失败：${error.message}`;note('原版本仍然保留。恢复服务后点击“刷新记录”检查结果。',true);busy=false;controls();if(active()){clearTimeout(pollTimer);pollTimer=setTimeout(()=>load().catch(connectionError),4000);}}
async function checkLyrics(){
  const token=revision,base=current,index=Number($('line-index').value);busy=true;controls();note('正在检查歌词与发音…');
  try{const value=await api('/preview',{lyrics:$('edit-lyrics').value});if(token!==revision||base!==current||index!==Number($('line-index').value))return;
    preview=value;$('edit-lyrics').value=value.lyrics;$('counter').textContent='8 / 8 字';
    $('pronunciation').replaceChildren(...value.characters.map((char,i)=>{const label=document.createElement('label');const text=document.createElement('span');text.textContent=char;const input=document.createElement('input');input.value=value.pinyin[i];input.maxLength=6;input.spellcheck=false;input.autocomplete='off';input.setAttribute('aria-label',`${char}（第 ${i+1} 字）的拼音`);input.addEventListener('input',()=>{pendingRequest=null;preview.pinyin[i]=input.value.trim().toLowerCase();remember();});label.append(text,input);return label;}));
    $('pronunciation-box').hidden=false;note('确认拼音后生成。多音字可直接修改，不需要声调。');remember();
  }catch(error){preview=null;note(error.message,true);}finally{busy=false;controls();}
}
async function generate(){if(!preview||active()||busy)return;busy=true;controls();
  pendingRequest??={requestId:crypto.randomUUID(),baseVersion:current,lineIndex:Number($('line-index').value),lyrics:preview.lyrics,pinyin:[...preview.pinyin]};remember();
  try{const job=await api('/jobs',pendingRequest);trackedJob=job.id;remember();if(loadInFlight)await loadInFlight;await load();note('已开始本机试唱。当前音频保持原样，新版完成后再切换。');}
  catch(error){note(`${error.message} 若连接中断，请先刷新记录确认是否已开始。`,true);await load().catch(()=>{});}
  finally{busy=false;controls();}
}
for(const value of ['A','B'])$(`choose-${value}`).addEventListener('click',()=>{if(data&&slot!==value){slot=value;refreshAudio();remember();}});
$('baseline-version').addEventListener('change',event=>{baseline=event.target.value;refreshAudio();remember();});
$('current-version').addEventListener('change',event=>{chooseCurrent(event.target.value);$('current-version').value=current;});
$('line-index').addEventListener('change',event=>editLine(Number(event.target.value)));
$('edit-lyrics').addEventListener('input',()=>{invalidate();note('歌词草稿尚未改变已有演唱。');});
$('check-lyrics').addEventListener('click',checkLyrics);$('generate-line').addEventListener('click',generate);
$('cancel-job').addEventListener('click',async()=>{const job=active();if(!job)return;busy=true;controls();try{await api(`/jobs/${job.id}/cancel`,{});pendingRequest=null;if(loadInFlight)await loadInFlight;await load();note('已取消。可以修改歌词后再次试唱。');}catch(error){note(error.message,true);}finally{busy=false;controls();remember();}});
$('refresh-history').addEventListener('click',()=>load().catch(connectionError));
$('listen-mode').addEventListener('change',()=>refreshAudio());
audio.addEventListener('timeupdate',()=>document.querySelectorAll('.lyric').forEach((row,i)=>row.classList.toggle('playing',audio.currentTime>=data.score.phrases[i].start&&audio.currentTime<data.score.phrases[i].end)));
audio.addEventListener('error',()=>{if(!data)return;note('音频加载失败，请刷新记录后重试。',true);$('download').setAttribute('aria-disabled','true');});
await load({initial:true}).catch(connectionError);
