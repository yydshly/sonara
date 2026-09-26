import {esc,fmt,clone,uid,createProject,toCSV} from './core.mjs';
import {qualityFields,qualityDecision,evaluationSummary,validateEvaluation,evaluationLyrics} from './evaluation-core.mjs';

const modeLabel = mode => mode === 'instrumental' ? '纯音乐' : '歌词演唱';
const sourceLabel = version => !version ? '还没有音频' : version.source === 'demo' ? '器乐演示 · 不计入评测' : version.source === 'generated' ? '服务生成 · 等待试听判断' : '导入的音频';
export function evaluationPage(state) {
  const records=state.evaluations||[],m=evaluationSummary(records),v=state.project.working;
  const eligible=v&&['generated','import'].includes(v.source);
  return `<main class="page evaluation-page" id="workspace"><div class="page-header"><div><span class="eyebrow">GOOD MUSIC COMES FIRST</span><h1>先听见好作品</h1><p>同一份歌词，留下每次真实的尝试。用具体问题决定保留、重做，或换一个声音方向。</p></div><div class="flex evaluation-actions"><button class="btn" data-act="evaluation-export" ${records.length?'':'disabled'}>导出评测记录</button><button class="btn primary" data-act="evaluation-new" ${eligible?'':'disabled'}>评测当前版本</button></div></div>
  <div class="metrics">${[['已记录的试听',m.total,'每条对应一份音频快照'],['达到本次质量要求',m.passed,'适用评分均 ≥ 4 / 5'],['中文歌曲达标',m.chinese,'逐句核对后记录'],['英文歌曲达标',m.english,'逐句核对后记录']].map(([label,n,hint])=>`<section class="panel metric"><h3>${label}</h3><strong>${n}<span class="small muted"> 次</span></strong><p>${hint}</p></section>`).join('')}</div>
  <section class="panel evaluation-current"><div><span class="eyebrow">当前作品</span><h2>${esc(state.project.title)}</h2><p>${esc(v?.name||'准备第一段真实音频')} · ${esc(sourceLabel(v))}</p></div><div class="flex evaluation-actions"><button class="btn" data-act="page" data-page="studio">回到创作室</button><button class="btn quiet" data-act="import">导入音频</button></div></section>
  <div class="notice evaluation-note">${eligible?'评分是你的试听判断。保存时固定歌词、混音和裁剪范围，后续修改不会覆盖这份记录。':'准备一首真实生成或导入的作品后再开始评测。内置器乐演示与测试音不作为音质结论。'} 歌词演唱需逐句核对；纯音乐只评旋律编曲与音频质量。这些结果用于挑选作品，尚不能证明整体服务质量或市场需求。</div>
  <div class="flex between evaluation-heading"><div><h2>真实试听记录</h2><p class="small muted">失败的尝试也留下来，看看问题是否反复出现。</p></div><span class="badge">${records.length?'本机记录':'待实测'}</span></div>
  ${records.length?`<section class="panel table-scroll"><table class="record-table"><thead><tr><th>作品 / 版本</th><th>类型与来源</th><th>试听结论</th><th>次数 / 费用</th><th>记录</th></tr></thead><tbody>${records.slice().reverse().map(r=>{const d=qualityDecision(r);return `<tr><td>${esc(r.projectTitle||r.projectId)}<br><span class="small muted">${esc(r.versionSnapshot.name)}</span></td><td>${modeLabel(r.mode)} · ${r.language==='en'?'EN':'中文'}<br><span class="small muted">${esc(r.provider)}</span></td><td><span class="badge ${d.passed?'lime':'amber'}">${esc(d.label)}</span></td><td>第 ${r.attempt} 次<br><span class="small muted">${r.cost===null?'费用未记录':`${esc(r.currency)} ${r.cost.toFixed(2)}`}</span></td><td><button class="btn quiet compact" data-act="evaluation-detail" data-record="${esc(r.id)}">查看与回听</button></td></tr>`;}).join('')}</tbody></table></section>`:`<section class="panel evaluation-empty"><div class="empty-disc" aria-hidden="true">♪</div><h3>还没有真实试听结论</h3><p>先生成或导入音频，完整听过后再评分。<br>你听见的瑕疵、喜欢的细节，都是下一次修改的起点。</p><button class="btn" data-act="generation-open">准备歌词与声音</button></section>`}
  <div class="flex between evaluation-heading"><div><h2>从八份原创歌词开始</h2><p class="small muted">中文、英文各四份。选择样例只创建作品，不提交生成，也不产生费用。</p></div><span class="badge">演唱评测题库</span></div>
  <section class="evaluation-cases">${(state.musicCases||[]).map(c=>`<article class="panel evaluation-case"><div class="flex between"><span class="case-code">${esc(c.id)} · ${c.language==='zh'?'中文':'English'}</span><span class="small muted">${c.duration} 秒</span></div><h3>${esc(c.title)}</h3><p class="case-excerpt">${esc(c.lyrics.split('\n').filter(l=>!l.startsWith('[')).slice(0,2).join('\n'))}</p><p class="small muted">重点：${c.check.map(esc).join(' · ')}</p><button class="btn quiet compact" data-act="evaluation-case" data-case="${esc(c.id)}">查看歌词与检查点</button></article>`).join('')||'<div class="notice">样例暂时未能载入。可以先评测自己的作品，刷新页面再试。</div>'}</section></main>`;
}

export function createEvaluations({state,storage,player,modal,closeModal,save,flush,render,stopForChange,preserveDraft,toast,download}) {
  let subject=null,saving=false;
  const $=s=>document.querySelector(s);
  async function load(){
    state.evaluations=(await storage.get('meta','audio-evaluations'))?.value||[];
    try{const response=await fetch('/music-cases.json');if(!response.ok)throw new Error();state.musicCases=(await response.json()).cases;}catch{state.musicCases=[];}
  }
  function caseModal(id){const c=state.musicCases.find(c=>c.id===id);if(!c)return;modal(`${c.id} · ${c.title}`,`<div class="dialog-body"><p>${c.language==='zh'?'中文':'英文'}歌词演唱 · ${c.duration} 秒候选。先创建作品，再选择生成或导入已有结果。</p><pre class="submitted-lyrics">${esc(c.lyrics)}</pre><div class="notice">试听重点：${c.check.map(esc).join(' · ')}。每个候选先尝试至多三轮，保留不满意的结果。</div><button class="btn primary" data-act="evaluation-create-case" data-case="${c.id}">用这份歌词创建作品</button><p>会创建独立作品，现有创作与版本继续保留。</p><div class="form-error" id="form-error" role="alert"></div></div>`);}
  async function createCase(el){
    const c=state.musicCases.find(c=>c.id===el.dataset.case);if(!c)return;
    el.disabled=true;
    try{await flush();const project=createProject({title:c.title,language:c.language,brief:`${c.id} 演唱评测。重点：${c.check.join('、')}。`,demo:false});
      project.seedLyrics=c.lyrics;project.benchmarkCaseId=c.id;project.generationDraft={mode:'song',style:c.style,voice:'any',duration:c.duration,lyrics:c.lyrics,baseLyrics:c.lyrics};
      await storage.put('projects',project);await storage.put('meta',{id:'last-project',value:project.id});
      stopForChange();state.project=project;state.projects.push(clone(project));state.page='studio';state.tab='lyrics';state.editingLyrics=false;closeModal();render();toast('评测作品已创建，歌词已准备好。尚未提交生成。');
    }finally{if(el.isConnected)el.disabled=false;}
  }
  function scoreInputs(mode){return qualityFields(mode).map(f=>`<label>${esc(f.label)}<select name="score-${f.key}" required><option value="">未评分</option>${[[1,'明显不可用'],[2,'问题较多'],[3,'仍需修改'],[4,'愿意保留'],[5,'非常满意']].map(([n,label])=>`<option value="${n}">${n} · ${label}</option>`).join('')}</select></label>`).join('');}
  function openForm(){
    if(state.ab==='A')throw new Error('你正在试听 A 基准。请切回 B，完整试听当前版本后再评测。');
    const p=state.project,v=p.working;if(!v||!['generated','import'].includes(v.source))throw new Error('请先生成或导入真实音频。器乐演示不能作为评测结果。');
    subject={project:p,version:clone(v)};const mode=v.mode==='instrumental'?'instrumental':'song',reference=evaluationLyrics(v);
    modal('记录这一次真实试听',`<form id="evaluation-form"><div class="dialog-body"><div class="notice">${esc(p.title)} / ${esc(v.name)}<br>评测范围 ${fmt(v.trim.start)}–${fmt(v.trim.end)}。记录会保留此刻的音频设置和歌词快照。请先在创作室完整试听，再填写。</div><div class="form-grid"><label>作品类型<select name="mode" id="evaluation-mode" ${v.source==='generated'?'disabled':''}><option value="song" ${mode==='song'?'selected':''}>歌词演唱</option><option value="instrumental" ${mode==='instrumental'?'selected':''}>纯音乐</option></select></label><label>第几次尝试<input name="attempt" type="number" min="1" max="3" step="1" value="1" required></label><label>来源 / 制作工具<input name="provider" required maxlength="80" placeholder="例如：人工制作、使用的服务" value="${esc(v.generation?.provider||'')}"></label><label>模型或制作版本（选填）<input name="model" maxlength="80" value="${esc(v.generation?.model||'')}"></label></div><details id="evaluation-reference" ${mode==='instrumental'?'hidden':''}><summary>本次核对的参考歌词</summary><p>${v.source==='generated'?'核对这次生成时提交的歌词。后续草稿修改不会改变音频中的唱词。':'核对下列歌词草稿与实际演唱。没有参考歌词时，可以保存待核对记录。'}</p><pre class="submitted-lyrics">${esc(reference||'还没有参考歌词，请回到创作室补充。')}</pre></details><div class="score-guide"><strong>4 分代表你愿意留下这一项表现</strong><p>按实际听感逐项判断。没有评过的项目保持空白，低分也可以保存。</p></div><div class="form-grid" id="evaluation-scores">${scoreInputs(mode)}</div><div class="form-grid"><label>本次用时（分钟）<input name="minutes" type="number" min="0" step="0.1" required placeholder="包括等待与试听"></label><label>实际费用（选填）<input name="cost" type="number" min="0" step="0.01" placeholder="留空表示未知"></label><label>费用币种<select name="currency"><option value="CNY">人民币 CNY</option><option value="USD">美元 USD</option></select></label></div><label>具体问题、喜欢的部分与人工帮助<textarea name="notes" rows="4" maxlength="5000" placeholder="例如：00:18 ‘经过’咬字模糊；副歌情绪不错，希望保留。"></textarea></label><label class="check"><input type="checkbox" name="listened" required>我已完整听过本次评测范围</label><label class="check" id="evaluation-lyrics-check" ${mode==='instrumental'?'hidden':''}><input type="checkbox" name="lyricsChecked" ${reference?'':'disabled'}>我已逐句核对实际演唱与提交的歌词</label><label class="check"><input type="checkbox" name="realAudio" required>这是实际创作结果，不是演示或测试音</label><p>这是人工试听记录，系统不会自动识别是否唱对。歌曲尚未核对歌词时会保留为“待核对”。</p><div class="form-error" id="form-error" role="alert"></div></div><div class="dialog-footer"><button type="button" class="btn quiet" data-act="close-dialog">先继续试听</button><button class="btn primary" type="submit">保存试听记录</button></div></form>`);
  }
  async function submit(form){
    if(saving||!subject)return;const data=new FormData(form),mode=subject.version.source==='generated'?(subject.version.mode||'song'):String(data.get('mode'));
    const cost=String(data.get('cost')||'').trim();
    const record=validateEvaluation({id:uid(),projectId:subject.project.id,projectTitle:subject.project.title,versionId:subject.version.id,caseId:subject.project.benchmarkCaseId||null,language:subject.project.language,mode,provider:String(data.get('provider')||''),model:String(data.get('model')||''),attempt:Number(data.get('attempt')),minutes:Number(data.get('minutes')),cost:cost===''?null:Number(cost),currency:String(data.get('currency')),scores:Object.fromEntries(qualityFields(mode).map(f=>[f.key,Number(data.get(`score-${f.key}`))])),notes:String(data.get('notes')||''),listened:data.has('listened'),lyricsChecked:data.has('lyricsChecked'),realAudio:data.has('realAudio'),createdAt:new Date().toISOString()},subject.version);
    const records=[...(state.evaluations||[]),record],button=form.querySelector('button[type=submit]');saving=true;button.disabled=true;
    try{await storage.put('meta',{id:'audio-evaluations',value:records});state.evaluations=records;subject=null;state.page='evaluation';closeModal();render();toast('试听结论与版本快照已保存在本机。');}finally{saving=false;if(button.isConnected)button.disabled=false;}
  }
  function detail(id){const r=state.evaluations.find(r=>r.id===id);if(!r)return;const d=qualityDecision(r),v=r.versionSnapshot;
    modal('试听记录与版本快照',`<div class="dialog-body"><span class="badge ${d.passed?'lime':'amber'}">${esc(d.label)}</span><h3>${esc(r.projectTitle||r.projectId)} · ${esc(v.name)}</h3><p>${esc(d.reason)}<br>${modeLabel(r.mode)} · ${esc(r.provider)} ${esc(r.model)} · 第 ${r.attempt} 次 · ${r.minutes} 分钟<br>${r.cost===null?'费用未记录':`${esc(r.currency)} ${r.cost.toFixed(2)}`} · ${new Date(r.createdAt).toLocaleString('zh-CN')}</p><div class="evaluation-score-list">${qualityFields(r.mode).map(f=>`<div><span>${esc(f.label)}</span><strong>${r.scores[f.key]} / 5</strong></div>`).join('')}</div><p class="submitted-lyrics">${esc(r.notes||'未填写具体观察。')}</p><details><summary>评测时的歌词与范围</summary><p>${fmt(v.trim.start)}–${fmt(v.trim.end)}。${r.caseId?`关联样例 ${esc(r.caseId)}，以这份快照为准。`:''}</p><pre class="submitted-lyrics">${esc(evaluationLyrics(v)||'本次没有参考歌词。')}</pre></details><button class="btn primary" data-act="evaluation-restore" data-record="${esc(r.id)}">在创作室回听这个快照</button><p>会恢复评测时的音频设置。现有调整与其他版本会保留。</p><div class="form-error" id="form-error" role="alert"></div></div>`);
  }
  async function restore(id){
    const r=state.evaluations.find(r=>r.id===id);if(!r)return;await flush();
    const target=state.project.id===r.projectId?state.project:await storage.get('projects',r.projectId);if(!target)throw new Error('原项目已不在此浏览器，记录仍可导出。');
    for(const track of r.versionSnapshot.tracks)if(track.assetId&&!await storage.get('assets',track.assetId))throw new Error('这份快照的音频素材已不在此浏览器，暂时无法回听。');
    stopForChange();state.project=target;preserveDraft();let snapshot=clone(r.versionSnapshot);
    const saved=target.versions.find(v=>JSON.stringify(v)===JSON.stringify(snapshot));
    if(saved)snapshot=clone(saved);else{snapshot.id=uid();snapshot.name=`评测快照 · ${snapshot.name}`;target.versions.push(clone(snapshot));}
    target.working=snapshot;state.page='studio';state.tab=r.mode==='instrumental'?'stems':'lyrics';state.ab='B';player.offset=snapshot.trim.start;save();await flush();await storage.put('meta',{id:'last-project',value:target.id});closeModal();render();toast('已恢复评测时的音频设置，可以开始回听。');
  }
  function exportRecords(){const records=state.evaluations||[];if(!records.length)return;
    modal('导出真实试听记录',`<div class="dialog-body"><p>CSV 便于汇总评分；完整记录同时保留歌词、段落和音轨设置。两者都不包含音频文件，请另行导出重要音频。</p><button class="btn primary" data-act="evaluation-export-json">下载完整记录 JSON</button><button class="btn" data-act="evaluation-export-csv">下载评分表 CSV</button></div>`);
  }
  async function action(el){switch(el.dataset.act){
    case 'evaluation-case':return caseModal(el.dataset.case);
    case 'evaluation-create-case':return createCase(el);
    case 'evaluation-new':return openForm();
    case 'evaluation-detail':return detail(el.dataset.record);
    case 'evaluation-restore':return restore(el.dataset.record);
    case 'evaluation-export':return exportRecords();
    case 'evaluation-export-json':return download(new Blob([JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),records:state.evaluations},null,2)],{type:'application/json'}),'声间-真实试听记录.json');
    case 'evaluation-export-csv':{const fields=qualityFields('song');return download(new Blob([toCSV([['作品','版本','类型','语言','来源','模型','样例','尝试','用时分钟','费用','币种',...fields.map(f=>f.label),'已核对歌词','结论','观察','记录时间'],...state.evaluations.map(r=>[r.projectTitle,r.versionSnapshot.name,modeLabel(r.mode),r.language,r.provider,r.model,r.caseId,r.attempt,r.minutes,r.cost===null?'':r.cost,r.currency,...fields.map(f=>r.scores[f.key]??''),r.lyricsChecked,qualityDecision(r).label,r.notes,r.createdAt])])],{type:'text/csv;charset=utf-8'}),'声间-真实试听评分.csv');}
  }}
  document.addEventListener('change',event=>{if(event.target.id!=='evaluation-mode')return;const mode=event.target.value;$('#evaluation-scores').innerHTML=scoreInputs(mode);$('#evaluation-lyrics-check').hidden=mode==='instrumental';$('#evaluation-reference').hidden=mode==='instrumental';});
  return {load,action,submit};
}
