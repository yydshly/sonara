import {initSongProject} from './song-project.mjs';
import {initVoiceComparison} from './voice-comparison.mjs';
const $=id=>document.getElementById(id),player=$('player');
const time=s=>`${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;
const make=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
let score,baseScore,versionScore,customAssets,mode='song',ready=false,nextTime=0,continuePlaying=false,sectionButtons=[],lyricButtons=[],projectVersion=null,versionLabel='V1 原版',comparisonActive=false,projectUI;
const listened=new Map(),sectionListened=new Map(),versions=new Map();let previousPlay=null;
async function fetchJson(path){const r=await fetch(path);if(!r.ok)throw Error('这份作品暂时无法读取');return r.json();}
function status(text,error=false){$('player-status').textContent=text;$('player-status').classList.toggle('error',error);}
const revisedAudio=()=>!!projectVersion&&(customAssets?!!customAssets[mode]:['song','accompaniment'].includes(mode));
function showScore(value){score=value;for(const {button,phrase} of lyricButtons)button.textContent=score.phrases.find(p=>p.index===phrase.index)?.lyrics||phrase.lyrics;for(const [i,row] of [...document.querySelectorAll('.note-row')].entries()){row.replaceChildren();for(const n of score.phrases[i].notes){const cell=make('div',undefined,'note');cell.style.flex=String(n.beats);cell.append(make('span',n.lyric),make('small',n.pitch),make('small',n.beats+' 拍'));row.append(cell);}}$('notation-version').textContent=`当前显示${revisedAudio()?versionLabel:'V1 原版'}的逐字乐谱。`;}
function changeAudio(){if(player.readyState)nextTime=player.currentTime||0;continuePlaying=!player.paused||continuePlaying;player.pause();previousPlay=null;const revised=revisedAudio(),extension=(revised||comparisonActive)?'wav':'mp3';player.src=revised?(customAssets?.[mode]||`/api/song-project/${projectVersion}/assets/${mode}`):`/youth-song/${mode}.${extension}`;$('download-audio').href=player.src;$('download-audio').download=`那条放学后的路-${revised?versionLabel:'V1'}-${mode}.${extension}`;$('ready').textContent=(revised?versionLabel:'V1 原版')+' · 完整演唱小样';showScore(revised&&versionScore?versionScore:baseScore);projectUI?.updatePlayback();$('download-lyrics').href=revised&&customAssets?.lyrics?customAssets.lyrics:'/youth-song/lyrics.txt';$('download-score').href=revised&&customAssets?.score?customAssets.score:'/youth-song/score.json';$('download-midi').href=revised&&customAssets?.midi?customAssets.midi:'/youth-song/melody.mid';status(`当前试听：${revised?versionLabel:'V1 原版'} · ${$('audio-mode').selectedOptions[0].textContent}`);}
function audition(start){if(!ready)return;nextTime=start;if(player.readyState){player.currentTime=start;continuePlaying=false;}else continuePlaying=true;player.play().catch(()=>status('点击播放器的播放按钮，即可开始试听。'));}
function setVersion(id,label,options){comparisonActive=true;projectVersion=id;versionLabel=label;customAssets=options?.assets;versionScore=options?.score;mode='song';$('audio-mode').value=mode;const value=id||'original';if(![...$('listen-version').options].some(o=>o.value===value)){const o=make('option',label);o.value=value;$('listen-version').append(o);}versions.set(value,{id,label,options});$('listen-version').value=value;changeAudio();}
player.addEventListener('loadedmetadata',()=>{player.currentTime=Math.min(nextTime,player.duration||0);if(continuePlaying)player.play().catch(()=>{});continuePlaying=false;});
player.addEventListener('timeupdate',()=>{
  const t=player.currentTime,current=score?.sections.find(s=>t>=s.start&&t<s.end);
  const key=revisedAudio()?projectVersion:'original';if(!player.paused&&mode==='song'&&!player.seeking){const delta=previousPlay?.key===key?t-previousPlay.time:0;if(delta>0&&delta<1.5){listened.set(key,(listened.get(key)||0)+delta);const sections=sectionListened.get(key)||{};for(const s of score.sections){const overlap=Math.max(0,Math.min(t,s.end)-Math.max(previousPlay.time,s.start));if(overlap)sections[s.id]=(sections[s.id]||0)+overlap;}sectionListened.set(key,sections);}previousPlay={key,time:t};}else previousPlay=null;
  sectionButtons.forEach(({button,section})=>button.setAttribute('aria-pressed',String(section.id===current?.id)));
  lyricButtons.forEach(({button,phrase})=>button.classList.toggle('active',t>=phrase.start&&t<phrase.end));
  projectUI?.updatePlayback();
  status(`${time(t)} / ${time(score?.duration||0)}${current?' · '+current.name:''} · ${revisedAudio()?versionLabel:'V1 原版'} · ${$('audio-mode').selectedOptions[0].textContent}`);
});
player.addEventListener('error',()=>status('音频未能加载，请刷新页面后重试。',true));
player.addEventListener('play',()=>{for(const audio of document.querySelectorAll('audio'))if(audio!==player)audio.pause();});
player.addEventListener('seeking',()=>{previousPlay=null;});
$('listen-version').addEventListener('change',()=>{const version=versions.get($('listen-version').value);if(version)setVersion(version.id,version.label,version.options);});
$('audio-mode').addEventListener('change',()=>{mode=$('audio-mode').value;changeAudio();});
$('play-all').addEventListener('click',()=>audition(0));$('play-chorus').addEventListener('click',()=>audition(score.sections.find(s=>s.id==='chorus1').start));
try{
  score=await fetchJson('/youth-song/score.json');
  baseScore=score;const notationVersion=make('p','当前显示 V1 原版的逐字乐谱。','small muted');notationVersion.id='notation-version';$('lyrics').before(notationVersion);
  $('facts').textContent=`${score.bpm} BPM · C 大调 · ${score.meter} 拍 · ${time(score.duration)}`;
  for(const section of score.sections){
    const tab=make('button',section.name.split(' · ')[0]);tab.disabled=true;tab.setAttribute('aria-pressed','false');tab.addEventListener('click',()=>audition(section.start));$('sections').append(tab);sectionButtons.push({button:tab,section});
    const block=make('section',undefined,'lyric-section'),heading=make('h3',section.name),jump=make('button',time(section.start));jump.disabled=true;jump.addEventListener('click',()=>audition(section.start));heading.append(jump);block.append(heading);
    const phrases=score.phrases.filter(p=>p.section===section.id);
    for(const phrase of phrases){const button=make('button',phrase.lyrics,'lyric-button');button.disabled=true;button.addEventListener('click',()=>audition(phrase.start));block.append(button);lyricButtons.push({button,phrase});}
    block.append(make('p',section.intention,'intention'));
    if(phrases.length){const details=make('details'),summary=make('summary','查看逐字乐谱与和弦'),notation=make('div',undefined,'notation');details.append(summary);details.append(make('p',score.harmony.filter(h=>h.bar>=section.startBar&&h.bar<section.startBar+section.bars).map(h=>h.symbol).join(' / ')));
      for(const p of phrases){const row=make('div',undefined,'note-row');for(const n of p.notes){const cell=make('div',undefined,'note');cell.style.flex=String(n.beats);cell.append(make('span',n.lyric),make('small',n.pitch),make('small',n.beats+' 拍'));row.append(cell);}notation.append(row);}details.append(notation);block.append(details);}
    $('lyrics').append(block);
  }
  const result=await fetchJson('/youth-song/result.json');if(result.status!=='rendered')throw Error('演唱小样仍在准备中');
  ready=true;$('ready').textContent='完整演唱小样 · 第一稿';for(const id of ['play-all','play-chorus','audio-mode'])$(id).disabled=false;
  for(const button of document.querySelectorAll('#sections button,#lyrics button'))button.disabled=false;
  $('download-audio').hidden=false;changeAudio();status('可以从头听，也可以先听副歌。每一行歌词都能定位试听。');
  versions.set('original',{id:null,label:'V1 原版'});
  const history=await Promise.allSettled([fetchJson('/api/song-project'),fetchJson('/api/song-phrasing')]);
  if(history[0].status==='fulfilled')for(const v of history[0].value.versions.filter(v=>v.state==='succeeded'))versions.set(v.id,{id:v.id,label:`V${v.number} 混音`});
  const vocalStudy=history[0].status==='fulfilled'&&history[0].value.vocalStudy;
  if(vocalStudy){
    const v={id:vocalStudy.id,label:vocalStudy.label,options:{score:baseScore,assets:{song:`/youth-song/${vocalStudy.id}/song.wav`,vocal:`/youth-song/${vocalStudy.id}/vocal.wav`}}};versions.set(v.id,v);
    const comparison=make('details',undefined,'vocal-comparison');comparison.id='vocal-comparison';
    comparison.append(make('summary','同一段旋律，比较咬字与落拍'),make('p','首段副歌 00:46–01:10 · 歌词、乐谱和伴奏相同。修正版调整字头与元音的衔接，其余段落保留原版。'));
    const actions=make('div',undefined,'project-actions');
    for(const [label,version] of [['A · 听原版副歌',versions.get('original')],['B · 听咬字修正版',v]]){const button=make('button',label);button.type='button';button.onclick=()=>{const priorMode=mode;setVersion(version.id,version.label,version.options);if(priorMode==='vocal'){mode='vocal';$('audio-mode').value=mode;changeAudio();}audition(vocalStudy.start);};actions.append(button);}
    comparison.append(actions,make('p','重点听“路”的长音，以及字与字之间是否连贯；也可切到“单独人声”。效果待试听判断。','honest'));$('player-status').after(comparison);
  }
  if(history[1].status==='fulfilled')for(const v of history[1].value.jobs.filter(v=>v.state==='succeeded'))versions.set(`phrasing:${v.id}`,{id:`phrasing:${v.id}`,label:`P${v.number} ${v.request.expression?'表达':'乐句'}演唱`,options:{score:v.score,assets:{song:`/api/song-phrasing/${v.id}/assets/song`,vocal:`/api/song-phrasing/${v.id}/assets/vocal`,lyrics:`/api/song-phrasing/${v.id}/assets/lyrics`,score:`/api/song-phrasing/${v.id}/assets/score`,midi:`/api/song-phrasing/${v.id}/assets/midi`}}});
  const arrangements=history[0].status==='fulfilled'?history[0].value.arrangementStudies||[]:[];
  if(arrangements.length){
    const study=make('details',undefined,'arrangement-study');study.id='arrangement-study';study.append(make('summary','探索不同伴奏 · 三种情绪方向'));
    study.append(make('p','先比较伴奏，再合上同一段人声。三版都是首段副歌的编配草稿，速度与人声相同；整首其余部分沿用 S1。','honest'));
    const rows=make('div',undefined,'arrangement-options');
    for(const a of arrangements){
      const base=`/youth-song/arrangement-study-v1/${a.id}`,v={id:`arrangement:${a.id}`,label:a.label,options:{score:baseScore,assets:{song:`${base}/song.wav`,accompaniment:`${base}/accompaniment.wav`,vocal:'/youth-song/vocal-alignment-v1/vocal.wav'}}};versions.set(v.id,v);
      const row=make('section',undefined,'arrangement-option');row.append(make('h3',a.name),make('p',a.feeling),make('p',a.detail,'honest'));
      const actions=make('div',undefined,'project-actions');
      for(const [text,targetMode] of [['只听伴奏','accompaniment'],['听演唱与伴奏','song']]){const button=make('button',text);button.type='button';button.setAttribute('aria-label',`${a.name} · ${text}`);button.onclick=()=>{setVersion(v.id,v.label,v.options);if(targetMode!==mode){mode=targetMode;$('audio-mode').value=mode;changeAudio();}audition(a.start);};actions.append(button);}
      const midi=make('a','编配 MIDI ↓');midi.href=`${base}/arrangement.mid`;midi.download=`那条放学后的路-${a.name}-编配.mid`;actions.append(midi);row.append(actions);rows.append(row);
    }
    study.append(rows,make('p','本机采样乐器：FluidSynth + GeneralUser GS。三版伴奏对齐响度后比较；这是人工编写的编配方案，尚非任意歌曲的自动风格生成。','honest'));
    ($('vocal-comparison')||$('player-status')).after(study);
  }
  for(const [id,v] of versions)if(id!=='original'){const option=make('option',v.label);option.value=id;$('listen-version').append(option);}$('listen-version').disabled=false;
  projectUI=await initSongProject({score,audition,pauseMain:()=>{player.pause();continuePlaying=false;},getPlayback:()=>{const key=revisedAudio()?projectVersion:'original';return {score,version:key,label:revisedAudio()?versionLabel:'V1 原版',mode,currentTime:player.currentTime||0,listenedSeconds:listened.get(key)||0,sectionListenedSeconds:sectionListened.get(key)||{}};},setVersion});
  await initVoiceComparison($('player-status'),()=>{player.pause();continuePlaying=false;});
}catch(error){$('ready').textContent='试听暂不可用';status(error.message,true);}


