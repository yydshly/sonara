const $=id=>document.getElementById(id);
let version='A',score,result;
const audio=$('audio');
try{
  const response=await fetch('/score-trial/score.json');if(!response.ok)throw Error('词曲数据暂时无法读取');score=await response.json();
  const status=await fetch('/score-trial/result.json');result=status.ok?await status.json():{status:'prepared'};
  const ready=result.status==='rendered';
  $('status').textContent=ready?'已完成本机试唱 · 点击播放，听第二句的改词效果。':'词曲与伴奏已完成 · 演唱尚未生成，现在可以试听旋律示范。';
  if(!ready){for(const opt of $('listen-mode').options)if(['mix','vocal'].includes(opt.value))opt.disabled=true;$('listen-mode').value='guide';}
  $('score').replaceChildren(...score.phrases.map(phrase=>{const row=document.createElement('div');row.className='score-row';for(const n of phrase.notes){const block=document.createElement('span');block.className='note-block';block.style.left=`${(n.beat-phrase.index*8)/8*100}%`;block.style.width=`${n.beats/8*100-.5}%`;block.style.bottom=`${(n.midi-55)/12*37}px`;block.title=`${n.lyric} · ${n.pitch} · ${n.beats} 拍`;row.append(block);}return row;}));
  if(ready)$('evidence').textContent=`音频检查：未修改的三句人声与伴奏逐样本保持一致；只在第 2 句替换人声。${result.duration} 秒 / ${result.sampleRate/1000} kHz。音质尚待试听评价。`;
  function refresh(){
    const time=audio.currentTime||0,playing=!audio.paused;audio.pause();
    const mode=$('listen-mode').value,file=mode==='guide'?'melody-guide.wav':mode==='backing'?'accompaniment.wav':`${mode==='mix'?'song':'vocal'}-${version}.wav`;
    audio.src=`/score-trial/${file}`;
    $('download').href=audio.src;$('download').download=file;$('download').removeAttribute('aria-disabled');
    $('midi').href=`/score-trial/melody-${version}.mid`;
    $('play-label').textContent=mode==='guide'?'器乐旋律示范，不含歌声':mode==='backing'?'原创合成伴奏，不含歌声':`${version} 版 · Ria / 狸安合成演唱${mode==='mix'?'，搭配原创合成伴奏':''}`;
    $('lyrics').replaceChildren(...score.phrases.map((p,i)=>{const row=document.createElement('div');row.className=`lyric ${version==='B'&&i===1?'changed':''}`;const number=document.createElement('small');number.textContent=`0${i+1}`;const text=document.createElement('span');text.textContent=version==='A'?p.lyrics:p.revisedLyrics;row.append(number,text);return row;}));
    for(const v of ['A','B']){$(`choose-${v}`).classList.toggle('selected',v===version);$(`choose-${v}`).setAttribute('aria-pressed',String(v===version));}
    audio.onloadedmetadata=()=>{audio.currentTime=Math.min(time,Number.isFinite(audio.duration)?audio.duration:score.duration);if(playing)audio.play().catch(()=>{});};
  }
  for(const v of ['A','B'])$(`choose-${v}`).addEventListener('click',()=>{if(v!==version){version=v;refresh();}});
  $('listen-mode').addEventListener('change',refresh);
  audio.addEventListener('timeupdate',()=>{document.querySelectorAll('.lyric').forEach((row,i)=>row.classList.toggle('playing',audio.currentTime>=score.phrases[i].start&&audio.currentTime<score.phrases[i].end));});
  audio.addEventListener('error',()=>{$('status').textContent='音频加载失败，请刷新页面后重试。';$('download').setAttribute('aria-disabled','true');});
  refresh();
}catch(error){$('status').textContent=error.message;}
