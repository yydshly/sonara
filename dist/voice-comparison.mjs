const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const clock=s=>`${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;

// This is a separate, transposed excerpt comparison, never a full-song version.
export async function initVoiceComparison(anchor,pauseMain){
  const base='/youth-song/voice-comparison-v1';let data;
  try{const response=await fetch(`${base}/result.json`);if(!response.ok)return;data=await response.json();}catch{return;}
  if(data.id!=='voice-comparison-v1'||data.status!=='rendered'||data.sections?.length!==2||!data.sameScoreAndLyrics||!data.sameBackingPerSection)return;
  if(data.sections.some(s=>!['verse','chorus'].includes(s.id)||!Number.isFinite(s.duration)||s.duration<=0||s.versions?.length!==2||s.versions.some(v=>!['ria','qixuan'].includes(v.id))))return;
  const host=make('details',undefined,'voice-study');host.id='voice-study';host.open=true;
  host.append(make('summary','对比两种歌声 · 同词同谱'),make('p','主歌听咬字与讲述，副歌听长音和展开。两套声音均重新演唱，统一降两个半音至降 B 大调；原作品保留。','voice-study-intro'));
  const controls=make('div',undefined,'voice-study-controls'),segment=make('select'),mode=make('select');
  segment.id='voice-study-segment';mode.id='voice-study-mode';
  for(const s of data.sections){const option=make('option',s.label);option.value=s.id;segment.append(option);}
  for(const [value,text] of [['vocal','单独人声'],['song','人声与同一钢琴伴奏']]){const option=make('option',text);option.value=value;mode.append(option);}
  for(const [title,input] of [['对照段落',segment],['对照内容',mode]]){const label=make('label',title);label.append(input);controls.append(label);}host.append(controls);
  const lyrics=make('div',undefined,'voice-study-lyrics'),actions=make('div',undefined,'project-actions'),audio=make('audio');audio.controls=true;audio.preload='metadata';audio.id='voice-study-player';audio.setAttribute('aria-label','两种歌声对照播放器');
  const state=make('p',undefined,'voice-study-status');state.id='voice-study-status';state.setAttribute('role','status');
  const restart=make('button','从头比较');restart.type='button';const buttons=new Map();let voice='ria',nextTime=0,resume=false,expected='';
  const download=make('a','下载当前试听 ↓'),score=make('a','对照乐谱 ↓');
  const current=()=>data.sections.find(s=>s.id===segment.value);
  function report(){const v=current().versions.find(v=>v.id===voice);state.textContent=`${v.label} · ${mode.value==='vocal'?'单独人声':'人声与钢琴'} · ${clock(audio.currentTime||0)} / ${clock(current().duration)} · 效果待试听判断`;}
  function select({reset=false,play=resume||!audio.paused}={}){
    nextTime=reset||audio.ended?0:(audio.readyState?audio.currentTime:nextTime)||0;resume=play;audio.pause();
    expected=`${base}/${segment.value}/${voice}-${mode.value}.wav`;audio.src=expected;
    for(const [id,b] of buttons)b.setAttribute('aria-pressed',String(id===voice));
    lyrics.replaceChildren(...current().lyrics.map(line=>make('p',line)));
    download.href=expected;download.download=`那条放学后的路-${segment.value}-${voice}-${mode.value}.wav`;
    score.href=`${base}/${segment.value}/score.json`;score.download=`同词同谱-${segment.value}.json`;
    report();
  }
  for(const v of data.sections[0].versions){const button=make('button',`听 ${v.label}`);button.type='button';button.setAttribute('aria-pressed',String(v.id===voice));button.onclick=()=>{voice=v.id;select({play:true});};buttons.set(v.id,button);actions.append(button);}
  restart.onclick=()=>{audio.currentTime=0;resume=false;audio.play().catch(()=>{state.textContent='点击播放器继续试听。';});};actions.append(restart);
  audio.addEventListener('loadedmetadata',()=>{if(!audio.currentSrc.endsWith(expected))return;audio.currentTime=Math.min(nextTime,Math.max(0,audio.duration-.01));if(resume){resume=false;audio.play().catch(()=>{state.textContent='点击播放器继续试听。';});}});
  audio.addEventListener('play',pauseMain);audio.addEventListener('timeupdate',report);
  audio.addEventListener('error',()=>{resume=false;state.textContent='这份试听暂时无法加载，请重新选择或刷新后重试。';});
  segment.onchange=()=>select({reset:true});mode.onchange=()=>select();
  const links=make('div',undefined,'downloads');links.append(download,score);
  const details=make('details',undefined,'voice-study-notes');details.append(make('summary','比较方式与声音来源'));
  details.append(make('p','点击 A / B 从同一位置切换；“从头比较”重新播放。人声采用相同响度目标与固定增益，钢琴伴奏相同。每个声库独立决定咬字、音高细节和气声，因此比较的是整套演唱效果。'));
  details.append(make('p','A：狸安 Ria（RibosomeK）；B：绮萱 Qixuan v2.7.0（颜绮萱、YQ之神及制作组）。两版均为 DiffSinger AI 合成。两种声线现已接入个人四句中文创作，可在“开始创作”中选择；这里保留最初的同词同谱对照。'));
  const source=make('a','绮萱官方说明与使用条款');source.href='https://github.com/yqzhishen/qixuan-diffsinger';source.target='_blank';source.rel='noreferrer';details.append(source);
  host.append(lyrics,actions,audio,state,make('p','先判断咬字是否清楚、字句是否连贯、长音是否稳，再判断这种声音是否适合故事；不同音色不等于质量一定更高。','honest'),links,details);
  anchor.after(host);select({reset:true,play:false});
}
