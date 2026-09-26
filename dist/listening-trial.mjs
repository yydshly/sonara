import {addPlayedInterval,playedSeconds,choiceLabels,describeChoice} from './listening-core.mjs';
export function initListeningTrial(anchor,{onUse,onOpen}={}){
  if(!anchor)return;
  anchor.innerHTML=`<div class="listening-intro"><div><p class="eyebrow" data-ref="eyebrow">找感觉 · 第一次试听</p><h2 data-ref="heading">说不出喜欢哪里？先听，再选。</h2><p data-ref="intro">两段相同的原创小样，只改变伴奏层次。跟着感觉选，不需要解释原因。</p></div><span class="tag" data-ref="duration">每版约 19 秒</span></div>
  <details class="listening-references"><summary>你的音乐参考：舒服、产生共鸣</summary><div data-ref="references"></div><p>你说喜欢这些歌，但还说不出原因。这里先记录这份喜欢；尚未对经典录音做逐段分析，也不据此认定你的音乐口味。</p></details>
  <div class="listening-body"><div class="listening-story"><span class="tag">原创小样</span><h3 data-ref="title">正在准备试听</h3><p data-ref="story"></p><details data-ref="lyric-details"><summary data-ref="lyric-label">看这段歌词</summary><div data-ref="lyrics"></div></details><details class="listening-scope"><summary>本轮改变与保留的内容</summary><p data-ref="scope"></p></details></div>
  <div class="listening-player"><div class="listening-switch"><button type="button" data-version="A" aria-pressed="true" disabled>听 A</button><button type="button" data-version="B" aria-pressed="false" disabled>听 B</button><button type="button" data-ref="restart" class="text-button" disabled>从头重听</button></div><audio data-ref="audio" controls preload="metadata" aria-label="原创小样 A/B 试听"></audio><p data-ref="now" class="status">正在载入真实音频…</p><div data-ref="progress" class="listening-progress"></div><p class="disclosure">每版先听至少 6 秒，再选择。切换时对齐同一位置，也可以从头重听。</p></div></div>
  <h3 class="listening-question" data-ref="question">哪一版让你更想继续听？</h3><details class="listening-note"><summary>想补充一句也可以 · 选填</summary><label>你的感受<textarea data-ref="note" maxlength="240" rows="2" placeholder="比如：第二版有点挤，或者说不出差别。"></textarea></label></details>
  <div class="listening-choices">${['A','B','neither','same'].map(k=>`<button type="button" data-choice="${k}" aria-pressed="false" disabled>${choiceLabels[k]}</button>`).join('')}</div><p class="disclosure">选择后保存在这台电脑，可以改选或撤回；一次选择不会变成永久的口味标签。</p><p data-ref="status" role="status" aria-live="polite"></p>
  <div class="listening-result" data-ref="result" hidden><p data-ref="conclusion"></p><p data-ref="note-copy" hidden></p><div class="listening-actions"><button type="button" data-ref="use" class="secondary" hidden>把这次选择带入创作</button><a data-ref="download" class="secondary" download hidden>下载选中的小样</a><button type="button" data-ref="clear" class="text-button">撤回这次选择</button></div></div><button type="button" class="text-button" data-ref="retry" hidden>重新连接试听</button>`;
  const el=name=>anchor.querySelector(`[data-ref="${name}"]`),audio=el('audio');
  let state=null,version='A',busy=false,error=false,ranges={A:[],B:[]},last=null,pendingPosition=null,pendingRequest=null,loadNumber=0;
  const seconds=k=>Math.min(state?.trial.duration||0,playedSeconds(ranges[k]));
  const ready=()=>state&&['A','B'].every(k=>seconds(k)>=state.trial.minimumSeconds);
  const say=(message,isError=false)=>{el('status').textContent=message;el('status').classList.toggle('error',isError);};
  const pause=()=>{++loadNumber;audio.onloadedmetadata=null;pendingPosition=null;last=null;audio.pause();};
  async function request(path='',body){const r=await fetch('/api/listening-trial'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await r.json();if(!r.ok){const e=Error(value.error||'试听暂不可用');e.status=r.status;throw e;}return value;}
  function render(){
    for(const button of anchor.querySelectorAll('[data-version]')){button.disabled=!state||error;button.setAttribute('aria-pressed',String(button.dataset.version===version));}
    for(const button of anchor.querySelectorAll('[data-choice]')){button.disabled=busy||error||!ready();button.setAttribute('aria-pressed',String(button.dataset.choice===state?.current?.choice));}
    el('restart').disabled=!state||error;
    el('progress').replaceChildren(...['A','B'].map(k=>{const s=document.createElement('span');s.textContent=`${k} · ${seconds(k)>=6?'已试听':`已听 ${Math.floor(seconds(k))} / 6 秒`}`;s.classList.toggle('heard',seconds(k)>=6);return s;}));
    const current=state?.current,has=current&&current.choice!=='clear';el('result').hidden=!has;
    if(has){el('conclusion').textContent=describeChoice(current,state.trial);el('note-copy').hidden=!current.note;el('note-copy').textContent=current.note?'你的补充：'+current.note:'';}
    const picked=state?.trial.variants.find(v=>v.id===current?.choice);el('use').hidden=!picked;el('download').hidden=!picked;el('use').disabled=busy;el('clear').disabled=busy;
    el('use').textContent=picked?.compositionId?'打开这个版本，继续打磨':'把这次选择带入创作';
    if(picked){el('download').href=picked.audio;el('download').download=state.trial.title+'-'+picked.id+'.wav';}
  }
  function showLyrics(){const v=state.trial.variants.find(v=>v.id===version);el('lyrics').replaceChildren(...(v.lyrics||state.trial.lyrics).map(text=>{const p=document.createElement('p');p.textContent=text;return p;}));if(state.trial.factor==='lyric-phrasing')el('lyric-label').textContent=version==='A'?'原版的后两句':'修改版的后两句';}
  function populate(){
    el('title').textContent=state.trial.title+' · 与老朋友重逢';el('story').textContent=state.trial.story;
    showLyrics();
    if(state.trial.factor==='lyric-phrasing'){el('eyebrow').textContent='根据你的反馈 · 词曲修改';el('heading').textContent='先把这两句，唱得自然一点。';el('intro').textContent='去掉刻意重复，按意思安排停顿和旋律。听听修改有没有帮助。';el('duration').textContent='后两句 · 约 '+Math.round(state.trial.duration)+' 秒';el('question').textContent='哪一版唱得更自然？';el('lyric-details').open=true;for(const k of ['A','B']){anchor.querySelector(`[data-version="${k}"]`).textContent=k==='A'?'听原版 A':'听修改版 B';anchor.querySelector(`[data-choice="${k}"]`).textContent=k==='A'?'原版更自然':'修改版更自然';}el('note').placeholder='比如：断句顺了一些，但声音还是僵。';}
    el('scope').textContent=`${state.trial.factor==='lyric-phrasing'?'本轮比较词句、断句与旋律一起修改后的整体表达。':'只比较伴奏层次。'}${state.trial.variants.map(v=>`${v.id}：${v.description}`).join('；')}。保持相同：${state.trial.preserved.join('、')}。${state.trial.factor==='lyric-phrasing'?'两版使用同一段伴奏；修改版仍待你判断。':'两版整体响度接近。'}`;
    el('references').replaceChildren(...state.references.map(r=>{const a=document.createElement('a');a.textContent=r.title+' · '+r.artist;a.href=r.url;a.target='_blank';a.rel='noreferrer';return a;}));
    el('note').value=state.current?.note||'';
    if(state.current)for(const k of ['A','B'])if(state.current.played[k]>seconds(k))ranges[k]=[[0,state.current.played[k]]];
    render();
  }
  async function load(){
    try{const next=await request();if(state&&state.trial.revision!==next.trial.revision){ranges={A:[],B:[]};pendingRequest=null;}state=next;error=false;el('retry').hidden=true;populate();++loadNumber;audio.pause();audio.onloadedmetadata=null;pendingPosition=null;audio.src=state.trial.variants.find(v=>v.id===version).audio;last=null;el('now').textContent='当前 '+version+' · 点击上方按钮开始试听';say(state.current?'已恢复本机保存的本轮记录。':'');}
    catch(e){error=true;audio.pause();say('暂时无法载入试听：'+e.message,true);el('retry').hidden=false;render();}
  }
  function tick(){
    const now=performance.now(),time=audio.currentTime;
    if(state&&!audio.paused&&!audio.seeking&&!audio.muted&&audio.volume>0&&last&&last.version===version){const delta=time-last.time,wall=(now-last.wall)/1000;if(delta>0&&delta<=Math.min(1.5,wall*Math.max(1,audio.playbackRate)+.15))ranges[version]=addPlayedInterval(ranges[version],last.time,time,state.trial.duration);}
    last={time,wall:now,version};render();
  }
  function play(k,restart=false){
    if(!state||error)return;const number=++loadNumber,time=restart||audio.ended?0:(pendingPosition??(audio.currentTime||0));pendingPosition=time;last=null;audio.pause();audio.onloadedmetadata=null;version=k;showLyrics();
    const begin=()=>{if(number!==loadNumber)return;audio.currentTime=Math.min(time,Math.max(0,audio.duration-.01));pendingPosition=null;last=null;audio.play().catch(()=>say('请点击播放器中的播放按钮。'));};
    if(audio.getAttribute('src')!==state.trial.variants.find(v=>v.id===k).audio){audio.onloadedmetadata=begin;audio.src=state.trial.variants.find(v=>v.id===k).audio;}else if(audio.readyState)begin();else audio.onloadedmetadata=begin;
    el('now').textContent='当前 '+version+' · '+Math.round(state.trial.duration)+' 秒原创小样';render();
  }
  async function choose(choice){
    if(busy||!state||(choice!=='clear'&&!ready()))return;
    busy=true;render();say('正在保存这次选择…');
    if(!pendingRequest||pendingRequest.choice!==choice||pendingRequest.note!==el('note').value)pendingRequest={requestId:crypto.randomUUID(),trialId:state.trial.id,revision:state.trial.revision,choice,note:el('note').value,previousRecordId:state.current?.id??null,played:Object.fromEntries(['A','B'].map(k=>[k,seconds(k)]))};
    try{state=await request('/choice',pendingRequest);pendingRequest=null;populate();say(choice==='clear'?'已撤回本轮选择；不会将它作为创作偏好。':'已保存。可以继续试听，或直接改选。');}
    catch(e){say('没有确认保存成功：'+e.message,true);if(e.status===409){pendingRequest=null;el('retry').hidden=false;}}
    finally{busy=false;render();}
  }
  for(const button of anchor.querySelectorAll('[data-version]'))button.onclick=()=>play(button.dataset.version);
  for(const button of anchor.querySelectorAll('[data-choice]'))button.onclick=()=>choose(button.dataset.choice);
  el('restart').onclick=()=>play(version,true);el('clear').onclick=()=>choose('clear');el('retry').onclick=load;
  el('use').onclick=()=>{const variant=state.trial.variants.find(v=>v.id===state.current?.choice);if(!variant)return;audio.pause();if((variant.compositionId?onOpen?.(variant.compositionId):onUse?.(variant.music))===false)say('当前作品还在处理，完成后可带入这个方向。',true);};
  audio.addEventListener('timeupdate',tick);audio.addEventListener('seeking',()=>{last=null;});audio.addEventListener('pause',()=>{last=null;});audio.addEventListener('volumechange',()=>{last=null;});audio.addEventListener('play',()=>{last=null;for(const a of document.querySelectorAll('audio'))if(a!==audio)a.pause();});
  document.addEventListener('play',e=>{if(e.target!==audio&&e.target instanceof HTMLMediaElement)pause();},true);
  audio.addEventListener('error',()=>{if(audio.getAttribute('src')){error=true;say('音频暂时无法播放，请重新连接；已有选择仍保留。',true);el('retry').hidden=false;render();}});
  void load();
  return {pause};
}
