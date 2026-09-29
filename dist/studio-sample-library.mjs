import {validateDraft} from './studio-core.mjs';
import {inspirations,inspirationDraft,createInspirationPicker} from './studio-inspirations.mjs';

export function validateSamples(data){
  if(data?.format!=='sonara-studio-samples-v1'||!Array.isArray(data.cases)||data.cases.length!==inspirations.length)throw Error('样例资料格式不正确。');
  const ids=new Set();
  return data.cases.map(sample=>{
    if(!inspirations.some(s=>s.id===sample.id)||ids.has(sample.id))throw Error('样例标识不正确。');
    ids.add(sample.id);
    const draft=validateDraft(sample.draft);
    if(sample.musicStatus!=='not-generated')throw Error('这个样例没有可验证的音频。');
    if(draft.mode==='song'&&(sample.lyricsStatus!=='generated-draft'||draft.lyrics.length<8||sample.provenance?.provider!=='Codex'))throw Error('歌词来源不完整。');
    if(draft.mode==='instrumental'&&(draft.lyrics||sample.lyricsStatus!=='not-needed'))throw Error('纯音乐样例不应带有歌词。');
    return {...sample,draft};
  });
}

export function sampleCopy(sample,includeLyrics=true){
  const draft=validateDraft(structuredClone(sample.draft));
  return {...draft,title:draft.title.slice(0,70)+' · 我的版本',lyrics:includeLyrics?draft.lyrics:''};
}

export async function mountSampleLibrary({onUse}){
  const $=id=>document.getElementById(id);
  const dialog=$('samples-dialog'),list=$('sample-list');
  let samples=inspirations.map(s=>({...s,draft:inspirationDraft(s),lyricsStatus:s.mode==='instrumental'?'not-needed':'not-generated',musicStatus:'not-generated',provenance:{provider:'创作方向设计',direction:s.focus}}));
  let active=null,filter='all',busy=false,loadError=false;
  let picker=createInspirationPicker(samples);

  const describe=sample=>sample.draft.mode==='instrumental'?'纯音乐方案 · 音频待生成':sample.lyricsStatus==='generated-draft'?'Codex 歌词草稿 · 音频待生成':'创作方向 · 歌词待生成';
  function select(sample){
    active=sample;
    for(const b of list.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.sample===sample.id));
    $('sample-title').textContent=sample.draft.title;
    $('sample-expression-label').textContent=sample.draft.mode==='instrumental'?'音乐与情绪的展开':'看看歌词与表达';
    $('sample-limit').textContent=sample.draft.mode==='instrumental'?'这是待制作的纯音乐方案，尚未生成音频或完成试听。':'歌词是候选表达；尚未生成对应音乐，也没有经过用户试听认可。';
    $('sample-status').textContent=describe(sample);
    $('sample-story').textContent=sample.draft.idea;
    $('sample-direction').textContent=[sample.draft.style,sample.draft.tempo,sample.draft.voice].join(' · ');
    for(const [id,key] of [['sample-start','emotionStart'],['sample-peak','emotionPeak'],['sample-end','emotionEnd']])$(id).textContent=sample.draft[key];
    $('sample-focus').textContent=sample.focus;
    $('sample-revision').hidden=!sample.wordingRevision;
    $('sample-revision-reason').textContent=sample.wordingRevision?.reason||'';
    $('sample-original').textContent=sample.wordingRevision?.originalLyrics||'';
    $('sample-lyrics').textContent=sample.draft.lyrics||(sample.draft.mode==='instrumental'?'纯音乐不需要歌词。复制方向后，可以准备音乐任务。':'这里是创作方向。开始新作品后，可以让已连接的模型写歌词。');
    $('sample-source').textContent=sample.provenance?.generatedAt?`歌词由 ${sample.provenance.provider} 实际生成 · ${new Date(sample.provenance.generatedAt).toLocaleDateString('zh-CN')} · 耗时 ${sample.provenance.elapsedSeconds} 秒。仍需确认可唱性。`:'原创虚构场景，用于探索创作方向。';
    $('use-sample').textContent=sample.draft.lyrics?'用这版歌词开始新作品':'用这个方向开始新作品';
    $('use-sample-idea').hidden=!sample.draft.lyrics;
  }
  function render(){
    list.replaceChildren();
    const visible=samples.filter(s=>filter==='all'||s.draft.mode===filter);
    $('sample-summary').textContent=loadError?'歌词样例暂时无法读取，可以先使用下面的创作方向。':`${samples.filter(s=>s.lyricsStatus==='generated-draft').length} 份模型歌词草稿 · ${samples.filter(s=>s.draft.mode==='instrumental').length} 个纯音乐方向 · 尚无新生成音频`;
    for(const sample of visible){
      const button=document.createElement('button');button.className='sample-card';button.dataset.sample=sample.id;button.id='sample-'+sample.id;
      const label=document.createElement('small'),title=document.createElement('strong'),state=document.createElement('span'),arc=document.createElement('p');
      label.textContent=sample.label;title.textContent=sample.draft.title;state.textContent=describe(sample);arc.textContent=`${sample.draft.emotionStart} → ${sample.draft.emotionEnd}`;
      button.append(label,title,state,arc);button.onclick=()=>select(sample);list.append(button);
    }
    picker=createInspirationPicker(visible);
    select(visible.find(s=>s.id===active?.id)||visible[0]);
  }
  async function use(includeLyrics){
    if(busy||!active)return;
    busy=true;$('use-sample').disabled=true;$('use-sample-idea').disabled=true;
    try{await onUse(active,includeLyrics);dialog.close();}
    catch(error){$('sample-summary').textContent=error.message||'样例未能保存，原作品未被替换。';}
    finally{busy=false;$('use-sample').disabled=false;$('use-sample-idea').disabled=false;}
  }
  for(const button of document.querySelectorAll('[data-open-samples]'))button.onclick=()=>dialog.showModal();
  $('close-samples').onclick=()=>dialog.close();
  $('sample-filter').onchange=()=>{filter=$('sample-filter').value;render();};
  $('shuffle-sample').onclick=()=>{
    let next=picker();
    if(next.id===active?.id&&samples.filter(s=>filter==='all'||s.draft.mode===filter).length>1)next=picker();
    select(next);
  };
  $('use-sample').onclick=()=>use(true);
  $('use-sample-idea').onclick=()=>use(false);
  render();
  if(new URL(location.href).searchParams.get('samples')==='1')dialog.showModal();
  try{const response=await fetch(new URL('./studio-samples.json',import.meta.url));if(!response.ok)throw Error('无法读取样例');samples=validateSamples(await response.json());}
  catch{loadError=true;}
  render();
}
