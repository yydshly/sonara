const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const time=s=>`${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;
const energy=['','很轻','收着讲','向前推进','充分展开','强烈爆发'];
const tension=['','安定','舒展','牵挂','悬着一口气','强烈悬念'];
const verdicts={met:'符合目标',unsure:'还不确定',gap:'需要打磨'};
export function initEmotionJourney(host,{score,getBrief,getRecords,getPlayback,onChange,onListen,onCraft,onObserve,isDirty,state={sectionId:'verse1',reviews:{}}}){
  let selected=state.sectionId,requestId=null,saving=false,lastPayload='',updatePosition=()=>{};
  const header=el('div',undefined,'journey-heading');header.append(el('h3','先亲近，再怀念，最后走向释怀。'),el('p','把感受放进歌曲的起伏里。点击一段，听声音与预期是否一致。','project-intro'));host.append(header);
  const legend=el('div',undefined,'journey-legend');legend.append(el('span','━ 音乐力度 · 从收敛到展开','energy-key'),el('span','┄ 情绪张力 · 从安定到悬念','tension-key'),el('small','下面是可编辑的创作目标，尚非音频分析。'));host.append(legend);
  const scroll=el('div',undefined,'journey-scroll'),timeline=el('div',undefined,'journey-timeline');
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 1100 112');svg.setAttribute('aria-hidden','true');svg.classList.add('journey-chart');
  for(const y of [16,56,96]){const line=document.createElementNS(ns,'line');for(const [k,v]of Object.entries({x1:0,x2:1100,y1:y,y2:y}))line.setAttribute(k,String(v));line.classList.add('chart-rule');svg.append(line);}
  const paths={};for(const key of ['energy','tension']){const p=document.createElementNS(ns,'polyline');p.classList.add('curve-'+key);svg.append(p);paths[key]=p;}
  timeline.append(svg);const nav=el('div',undefined,'journey-nav');nav.setAttribute('aria-label','选择情绪段落');timeline.append(nav);scroll.append(timeline);host.append(scroll);
  const detail=el('section',undefined,'journey-detail');host.append(detail);
  const buttons=new Map();
  for(const s of score.sections){const b=el('button');b.type='button';b.dataset.section=s.id;b.append(el('span',s.name.split(' · ')[0]),el('small',time(s.start)),el('b',undefined,'emotion-label'));b.onclick=()=>{selected=s.id;state.sectionId=s.id;requestId=null;draw();};buttons.set(s.id,b);nav.append(b);}
  function field(parent,label,value,onInput,id,max=400,rows=2){const wrap=el('label',label,'project-field'),input=el('textarea');input.id=id;input.value=value;input.maxLength=max;input.rows=rows;input.oninput=()=>{onInput(input.value);onChange();sync();};wrap.append(input);parent.append(wrap);return input;}
  function sync(){const brief=getBrief();header.querySelector('h3').textContent=brief.goal.feeling;
    for(const key of ['energy','tension'])paths[key].setAttribute('points',brief.sections.map((p,i)=>`${(i+.5)*1100/brief.sections.length},${116-p.expression[key]*20}`).join(' '));
    for(const s of score.sections){const p=brief.sections.find(p=>p.id===s.id),b=buttons.get(s.id);b.querySelector('.emotion-label').textContent=p.emotion;b.setAttribute('aria-pressed',String(s.id===selected));b.setAttribute('aria-label',`${s.name}，${p.emotion}，音乐力度 ${p.expression.energy}，情绪张力 ${p.expression.tension}`);}
  }
  function draw(){sync();detail.replaceChildren();const s=score.sections.find(s=>s.id===selected),p=getBrief().sections.find(p=>p.id===selected);
    const head=el('div',undefined,'section-head');head.append(el('div',`${s.name} · ${time(s.start)}–${time(s.end)}`,'segment-title'));const listen=el('button','▶ 听这一段','primary');listen.onclick=()=>onListen(s.start);head.append(listen);detail.append(head);
    const columns=el('div',undefined,'journey-columns'),plan=el('div',undefined,'segment-plan'),review=el('div',undefined,'segment-review');columns.append(plan,review);detail.append(columns);
    const lyrics=el('div',undefined,'segment-lyrics');const phrases=score.phrases.filter(q=>q.section===s.id);
    for(const q of phrases){const b=el('button',q.lyrics);b.type='button';b.dataset.phrase=q.index;b.onclick=()=>onListen(q.start);lyrics.append(b);}
    if(!phrases.length)lyrics.append(el('p','器乐段落 · 留意它如何承接前后的情绪。'));plan.append(lyrics);
    field(plan,'希望听到的感受',p.emotion,v=>p.emotion=v,'journey-emotion',400,1);
    const sliders=el('div',undefined,'expression-sliders');
    for(const [key,label,labels,hint] of [['energy','音乐力度',energy,'乐器密度、节奏与展开程度'],['tension','情绪张力',tension,'期待或牵挂是否得到释放']]){
      const wrap=el('label',undefined,'expression-control'),title=el('span',label),output=el('output',`${p.expression[key]} / 5 · ${labels[p.expression[key]]}`),input=el('input');input.type='range';input.min='1';input.max='5';input.step='1';input.value=p.expression[key];input.id=`journey-${key}`;output.htmlFor=input.id;input.setAttribute('aria-label',label);input.setAttribute('aria-valuetext',labels[p.expression[key]]);
      input.oninput=()=>{p.expression[key]=Number(input.value);output.textContent=`${input.value} / 5 · ${labels[input.value]}`;input.setAttribute('aria-valuetext',labels[input.value]);onChange();sync();};wrap.append(title,output,input,el('small',hint));sliders.append(wrap);
    }plan.append(sliders,el('p','轻声也能有张力；充分展开的结尾，也可以是放松的。','expression-hint'));
    const cooperation=el('div',undefined,'cooperation');for(const [key,label] of [['lyrics','词 · 具体表达'],['music','曲 · 旋律与层次'],['performance','唱 · 语气与留白']]){const item=el('div');item.append(el('b',label),el('p',p[key]));cooperation.append(item);}plan.append(cooperation);
    const edit=el('details');edit.append(el('summary','编辑故事、歌词、曲子与唱法的配合'));for(const [key,label] of [['story','故事怎样向前走'],['lyrics','歌词表达要求'],['music','旋律与编配要求'],['performance','演唱表达要求']])field(edit,label,p[key],v=>{p[key]=v;const i=['lyrics','music','performance'].indexOf(key);if(i>=0)cooperation.children[i].querySelector('p').textContent=v;},`journey-${key}`);plan.append(edit);
    field(plan,'这一段，试听时重点判断什么？',p.expression.listenFor,v=>p.expression.listenFor=v,'journey-question',200,2);
    const next=el('button',phrases.length?'按这段目标打磨词与唱 →':'器乐段落可在“混音与版本”调整层次');next.disabled=!phrases.length;next.onclick=()=>onCraft(s.id);plan.append(next,el('p','保存后，这些要求会进入模型表达方案。可选择等字数改词，并调整节奏、气声与发声张力；原旋律与伴奏保留，效果仍需试听。','honest'));
    review.append(el('span','LISTEN & DECIDE','eyebrow'),el('h3','听感，由你来判断'),el('p','情绪贴合、音乐成立、声音自然，分别记录。','project-intro'));
    const form=el('form',undefined,'listening-check'),fields={},draft=state.reviews[s.id]||={};
    for(const [key,label] of [['emotion','情绪 · 感受是否传达了'],['musicality','音乐 · 旋律、起伏是否成立'],['sound','声音 · 咬字、音色是否自然']]){const wrap=el('label',label,'project-field'),select=el('select');select.id=`heard-${key}`;select.required=true;for(const [value,text] of [['','先听，再选择'],...Object.entries(verdicts)]){const o=el('option',text);o.value=value;select.append(o);}wrap.append(select);form.append(wrap);fields[key]=select;}
    for(const [key,control] of Object.entries(fields)){control.value=draft[key]||'';control.onchange=()=>draft[key]=control.value;}
    const noteWrap=el('label','听到了什么？下一步想改什么？','project-field'),note=el('textarea');note.id='heard-note';note.rows=3;note.required=true;note.minLength=2;note.maxLength=1200;note.placeholder='例如：怀念的感觉有了，但句尾像在念词；希望收尾更从容。';note.value=draft.note||'';note.oninput=()=>draft.note=note.value;noteWrap.append(note);form.append(noteWrap);
    const capture=el('p','记录会关联正在听的版本与位置。','listening-position'),submit=el('button','保存这一刻的听感');submit.type='submit';form.append(capture,submit);const message=el('p','目标与试听结论分开保存，旧版本的判断不会被新目标覆盖。','project-status');message.setAttribute('role','status');
    form.onsubmit=async event=>{event.preventDefault();if(saving)return;const playback=getPlayback();
      const fail=text=>{message.textContent=text;message.classList.add('error');};
      if(isDirty())return fail('请先保存上方的创作目标，再记录对应的听感。');
      if(playback.mode!=='song'||playback.currentTime<s.start||playback.currentTime>=s.end||(playback.sectionListenedSeconds?.[s.id]||0)<2)return fail('请先用“演唱与伴奏”试听这一段至少两秒，并停在这一段记录。');
      const body={sectionId:s.id,version:playback.version,at:playback.currentTime,emotion:fields.emotion.value,musicality:fields.musicality.value,sound:fields.sound.value,note:note.value};
      const signature=JSON.stringify(body);if(signature!==lastPayload){requestId=crypto.randomUUID();lastPayload=signature;}saving=true;submit.disabled=true;
      try{await onObserve({...body,requestId});message.textContent='听感已保存，已关联这版音频、位置和创作目标。';message.classList.remove('error');requestId=null;lastPayload='';renderRecords(records,s.id);}catch(e){fail(e.message);}finally{saving=false;submit.disabled=false;}
    };review.append(form,message);const records=el('div',undefined,'listening-records');review.append(records);renderRecords(records,s.id);
    const update=()=>{const play=getPlayback();capture.textContent=`正在听：${play.label||play.version} · ${time(play.currentTime)}${play.currentTime>=s.start&&play.currentTime<s.end?' · 当前段落':' · 请定位到当前段落'}`;if(play.score)for(const b of lyrics.querySelectorAll('[data-phrase]')){const p=play.score.phrases.find(p=>p.index===Number(b.dataset.phrase));if(p&&b.textContent!==p.lyrics)b.textContent=p.lyrics;}};updatePosition=update;update();form.addEventListener('focusin',update);listen.addEventListener('click',update);
  }
  function renderRecords(host,sectionId){host.replaceChildren();const records=getRecords().filter(r=>r.sectionId===sectionId).slice().reverse();host.append(el('h4',records.length?`这一段的听感 · ${records.length} 条`:'这一段还没有试听判断'));
    for(const r of records){const d=el('details');d.append(el('summary',`${r.source.label} · ${time(r.at)} · ${new Date(r.createdAt).toLocaleDateString('zh-CN')}`),el('p',`当时的目标：${r.target.section.emotion}（第 ${r.revision} 次保存）`),el('p',`情绪：${verdicts[r.emotion]} / 音乐：${verdicts[r.musicality]} / 声音：${verdicts[r.sound]}`),el('p',r.note));host.append(d);}
  }
  draw();return {sync,refresh:draw,state,updatePlayback:()=>updatePosition()};
}
