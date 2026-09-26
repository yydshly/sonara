const BASE='/sound-baseline-v2/';
const element=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
export async function initSoundBaseline(root){
  root.replaceChildren(element('p','正在准备声音验证片段…'));
  try{
    const response=await fetch(BASE+'manifest.json',{cache:'no-store'});
    if(!response.ok)throw new Error('not ready');
    const data=await response.json();
    if(data.id!=='sound-baseline-v2'||!Array.isArray(data.phrases)||!data.files?.['original-mix.wav']||!data.previous)throw new Error('invalid');
    const heading=element('div',undefined,'baseline-heading');
    const intro=element('div');intro.append(element('p','这次，先把一小段歌做好。','eyebrow'),element('h2',data.title));
    const badge=element('span','少拖音版 · 待试听','tag');heading.append(intro,badge);
    const description=element('p',data.brief,'baseline-brief');
    const meta=element('p',`${Math.round(data.duration)} 秒 · ${data.bpm} BPM · 钢琴与轻节奏 · 绮萱演唱`,'baseline-meta');
    const body=element('div',undefined,'baseline-body');
    const lyrics=element('div',undefined,'baseline-lyrics');lyrics.setAttribute('aria-label','歌词，可点击定位');
    const lyricButtons=data.phrases.map((p,index)=>{const button=element('button',p.text);button.type='button';button.title=`从第 ${index+1} 句开始试听`;button.onclick=()=>{if(!current.startsWith('original'))select('original-mix');seek(p.start);};lyrics.append(button);return button;});
    const listening=element('div',undefined,'baseline-listening');
    const versionLabel=element('label','演唱版本','baseline-version-label');
    const version=element('select');version.id='baseline-version';version.setAttribute('aria-label','演唱版本');
    for(const [value,label] of [['current','少拖音版 · 收尾更短'],['previous','原版 · 较长收尾']]){const option=element('option',label);option.value=value;version.append(option);}
    versionLabel.append(version);
    const changeNote=element('p',data.changeSummary,'baseline-prompt');listening.append(versionLabel,changeNote);
    const modes=element('div',undefined,'baseline-modes');modes.setAttribute('role','group');modes.setAttribute('aria-label','切换试听内容');
    const labels={'original-mix':'完整效果','original-vocal':'只听清唱','original-melody':'只听旋律','original-accompaniment':'只听伴奏','reference-low-vocal':'参考旋律 · 原调演唱','reference-high-vocal':'参考旋律 · 升高演唱','reference-low-melody':'参考旋律 · 钢琴'};
    const mainModes=['original-mix','original-vocal','original-melody'];
    const help={
      'original-mix':'听词、曲和演唱是否像一个完整的表达。',
      'original-vocal':'同一份人声，去掉伴奏：听咬字、连贯和长音。',
      'original-melody':'同一份乐谱，用钢琴演奏：先判断旋律本身是否顺。',
      'original-accompaniment':'仅播放为这段主唱编写的伴奏。',
      'reference-low-vocal':'熟悉旋律的啦音演唱，C4–G4。用于检查歌声，不是原创片段。',
      'reference-high-vocal':'相同节奏与声线，乐谱升高五个半音后重新演唱，F4–C5。',
      'reference-low-melody':'《欢乐颂》主题开头的钢琴导奏。只用于辨认旋律。'
    };
    const buttons=[];
    function option(key){const button=element('button',labels[key]);button.type='button';button.dataset.sound=key;button.setAttribute('aria-pressed','false');button.onclick=()=>select(key);buttons.push(button);return button;}
    mainModes.forEach(key=>modes.append(option(key)));
    const audio=element('audio');audio.controls=true;audio.preload='metadata';audio.id='baseline-player';audio.setAttribute('aria-label','声音验证播放器');
    const status=element('p','','baseline-status');status.setAttribute('role','status');
    const caption=element('p','','baseline-caption');
    const download=element('a','下载当前试听 ↓','baseline-download');
    let current='',pendingSeek=null;
    const update=()=>lyricButtons.forEach((button,i)=>button.classList.toggle('playing',current.startsWith('original')&&audio.currentTime>=data.phrases[i].start&&audio.currentTime<data.phrases[i].end));
    function seek(at){if(audio.readyState>=1){audio.currentTime=Math.min(at,audio.duration||at);pendingSeek=null;update();}else pendingSeek=at;}
    function select(key,force=false){
      if(current===key&&!force)return;
      const position=current.startsWith('original')&&key.startsWith('original')&&!audio.ended?audio.currentTime:0;
      audio.pause();current=key;pendingSeek=position;
      buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.sound===key)));
      const filename=key+'.wav',isReference=key.startsWith('reference');
      const active=version.value==='previous'?data.previous:data;
      const directory=isReference?data.referenceBase:version.value==='previous'?data.previous.base:BASE;
      const files=isReference?data.referenceFiles:active.files;
      audio.src=directory+filename+'?v='+files[filename].slice(0,12);
      download.href=audio.src;download.download=(isReference?'':version.value==='previous'?'原版-':'少拖音版-')+filename;
      caption.textContent=help[key];status.textContent='已选择：'+labels[key]+'。点击播放试听。';update();
    }
    audio.addEventListener('loadedmetadata',()=>{if(pendingSeek!==null)seek(pendingSeek);});
    audio.addEventListener('timeupdate',update);
    audio.addEventListener('play',()=>{for(const other of document.querySelectorAll('audio'))if(other!==audio)other.pause();status.textContent='正在播放：'+labels[current];});
    audio.addEventListener('ended',()=>{status.textContent='试听结束，可切换清唱或旋律继续判断。';});
    audio.addEventListener('error',()=>{status.textContent='这段音频读取失败，请刷新页面后重试。';});
    // Every player, including the older experiments, participates in one-at-a-time playback.
    document.addEventListener('play',event=>{if(event.target instanceof HTMLMediaElement&&event.target!==audio)audio.pause();},true);
    listening.append(modes,audio,status,caption,download);body.append(lyrics,listening);
    const details=element('details',undefined,'baseline-details');details.append(element('summary','这段歌怎么设计的'));
    const intentions=element('ol');for(const phrase of data.phrases)intentions.append(element('li',phrase.intent));
    details.append(intentions,element('p','词曲与演唱指令由本轮模型编写。已实际合成，尚未经过独立音乐人审阅；能否成立仍要听。这套设计尚未接入任意想法自动创作。'),option('original-accompaniment'));
    const scoreDownload=element('a','下载本段词曲与演唱设计');scoreDownload.href=BASE+'score.json';scoreDownload.download='靠窗那边-词曲与演唱设计.json';scoreDownload.style.marginLeft='14px';details.append(scoreDownload);
    version.addEventListener('change',()=>{
      const previous=version.value==='previous',active=previous?data.previous:data;
      badge.textContent=previous?'原版对照 · 拖音偏长':'少拖音版 · 待试听';
      changeNote.textContent=previous?'这是修改前的演唱，用来比较句尾的延长和转音。':data.changeSummary;
      intentions.replaceChildren(...active.phrases.map(phrase=>element('li',phrase.intent)));
      scoreDownload.href=(previous?data.previous.base:BASE)+'score.json';
      scoreDownload.download=(previous?'原版-':'少拖音版-')+'靠窗那边-词曲与演唱设计.json';
      select(current.startsWith('original')?current:'original-mix',true);
    });
    const reference=element('details',undefined,'baseline-details');reference.append(element('summary','如果唱法仍不自然：用熟悉旋律检查歌声'));
    reference.append(element('p','先排除原创旋律的影响，再比较两个声区。这里唱“啦”，不能代替中文歌词与情绪表达的验证。'));
    const referenceModes=element('div',undefined,'baseline-reference-modes');for(const key of ['reference-low-melody','reference-low-vocal','reference-high-vocal'])referenceModes.append(option(key));
    const source=element('a','旋律出处：贝多芬《第九交响曲》');source.href=data.referenceSource;source.target='_blank';source.rel='noreferrer';
    reference.append(referenceModes,source);
    root.replaceChildren(heading,description,meta,body,details,reference);select('original-mix');
  }catch{
    const retry=element('button','重新读取试听','secondary');retry.type='button';retry.onclick=()=>initSoundBaseline(root);
    root.replaceChildren(element('h2','声音验证片段'),element('p','试听文件尚未准备好或暂时无法读取。已有作品仍可正常打开。'),retry);
  }
}
