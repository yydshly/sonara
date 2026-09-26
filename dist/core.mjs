export const SAMPLE_RATE = 22050;
export const MAX_SECONDS = 300;
export const MAX_FILE_BYTES = 30 * 1024 * 1024;
export const COLORS = ['#cffa83','#bca2e8','#8fc9d4','#efba85','#d9a3b6','#a5b6ed'];
export const uid = () => crypto.randomUUID();
export const clone = value => structuredClone(value);
export const fmt = seconds => `${String(Math.floor(Math.max(0,seconds)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,seconds)%60)).padStart(2,'0')}`;
export const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const clamp = (n,min,max) => Math.min(max,Math.max(min,n));
const lyricsZh = {verse:'把今天折进旧口袋\n沿着街灯慢慢走回来\n城市的声音轻轻散开\n留一扇窗，等晚风来',pre:'有些话，不必急着说\n让旋律替我，轻轻开口',chorus:'让晚风经过，带走我的沉默\n让微亮的灯，照见真实的我\n那些没说出口的，都写成一首歌\n唱给还在路上的你和我',bridge:'走得慢一点，也没有关系\n风会记得，我们来过这里'};
const lyricsEn = {verse:'Fold the day into my coat\nFollow lights along the road\nAll the city fades away\nLeave a window for the breeze',pre:'Some words need a little time\nLet the melody find mine',chorus:'Let the night wind carry me\nPast the words I could not speak\nEvery road becomes a song\nFor the ones still moving on',bridge:'We can take the long way home\nThere is time to make it ours'};
export function sectionsFor(duration, language='zh', demo=false) {
  const config=[['intro','前奏',4],['verse','主歌',8],['pre','预副歌',4],['chorus','副歌',8],['bridge','桥段',4],['outro','尾奏',4]];
  let cursor=0;
  return config.map(([id,name,bars])=>{const start=cursor;cursor+=duration*bars/32;return {id,name,start,end:cursor,lyrics:demo?(language==='en'?lyricsEn:lyricsZh)[id]||'':''};});
}
export function demoVersion(direction='warm',language='zh') {
  const bpm=direction==='warm'?88:108, duration=128*60/bpm;
  return {id:uid(),name:'最初的想法',notes:direction==='warm'?'暖色电钢琴、轻盈节奏和慢慢展开的旋律。':'明亮拨弦、跳动的贝斯和更轻快的节奏。',createdAt:new Date().toISOString(),source:'demo',direction,bpm,duration,trim:{start:0,end:duration},sections:sectionsFor(duration,language,true),effects:[],tracks:['主旋律','和声','贝斯','鼓组'].map((name,i)=>({id:`demo-${i}`,name,kind:['melody','harmony','bass','drums'][i],color:COLORS[i],gain:1,muted:false,solo:false}))};
}
export function createProject({title='晚风经过',brief='一首关于在城市里慢下来、重新找到自己的歌。温暖、真诚，有一点夜晚的空气。',language='zh',demo=true}={}) {
  const version=demo?demoVersion('warm',language):null;
  return {id:uid(),title:title.trim()||'未命名作品',brief,language,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),stage:demo?4:1,versions:version?[clone(version)]:[],working:version,compareId:version?.id||null,messages:[{role:'assistant',text:demo?'先听一听「晚风经过」。你可以告诉我“副歌更有力量”或“伴奏轻一点”，试听真实的音轨变化。\n\n这是器乐示例，没有演唱。对话使用规则演示，不会自动生成歌曲。':'从一个故事、一句歌词或一段小样开始。先记录你想表达的内容，再选择器乐示例试听方向，或导入你自己的音频。'}],events:[]};
}
export function logEvent(project,type,data={}) { project.events.push({type,at:new Date().toISOString(),...data}); if(project.events.length>2000)project.events.shift(); }
export function makeSnapshot(project,name,notes) {
  if(!project.working) throw new Error('请先选择一个试听方向或导入音频。');
  const v={...clone(project.working),id:uid(),name:name.trim()||`创作版本 ${project.versions.length+1}`,notes,createdAt:new Date().toISOString()};
  project.versions.push(clone(v));project.working=v;project.stage=Math.max(project.stage,4);logEvent(project,'version_saved',{versionId:v.id});return v;
}
export function versionDirty(project) {
  if(!project.working)return false;
  const saved=project.versions.find(v=>v.id===project.working.id);
  return !saved||JSON.stringify(saved)!==JSON.stringify(project.working);
}
export function assertTrim(start,end,duration) {
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>duration+0.01||end-start<0.5)throw new Error(`请设置 0 至 ${duration.toFixed(1)} 秒内的范围，并至少保留 0.5 秒。`);
  return {start,end};
}
export function interpretRequest(text,version,sectionId='chorus') {
  if(!text.trim())throw new Error('先写下你的修改想法。');
  if(!version)return {kind:'brief',title:'已记录创作想法',explanation:'可以在“生成演唱”中提交确认的歌词和声音方向，连接服务后生成真实音频。也可以导入自己的小样；器乐演示不会根据歌词自动生成。'};
  text=text.replace(/(?:保留|保持)(?:现在的|原来的|原有的)?(?:人声|旋律)(?:不变)?/g,'').replace(/(?:keep|preserve)\s+(?:the\s+)?(?:vocals?|melody)(?:\s+unchanged)?/gi,'');
  if(/分轨|拆分|分离|separat|extract/i.test(text))return {kind:'external',title:'自动分轨需要外部工具',explanation:'当前没有自动分轨服务。可以先导出制作需求单，通过外部工具得到独立音轨，再在“音轨调整”中添加，从 00:00 对齐后试听。'};
  if(/改词|歌词|换词|演唱|唱得|音色|旋律|生成|重写|lyrics|sing|voice|melody|generate/i.test(text))return {kind:'external',title:'这需要重新创作音频',explanation:'可以通过生成入口，用修改后的歌词制作一个新的候选。当前不支持只重唱一句并保持原旋律或音色，重新生成可能改变整首作品。也可以导出制作需求单。'};
  const instrumental=version.tracks.filter(t=>!['vocals','melody'].includes(t.kind));
  const section=version.sections.find(s=>s.id===sectionId)||version.sections.find(s=>s.id==='chorus'||/副歌|chorus/i.test(s.name))||version.sections[0];
  if(/人声|vocal/i.test(text)&&!version.tracks.some(t=>t.kind==='vocals'))return {kind:'external',title:'需要独立的人声音轨',explanation:version.source==='demo'?'这个器乐示例没有人声。可以导入独立人声音轨，再调整人声与伴奏。':'这份音频尚未分轨。请先通过分轨工具或人工制作获取人声与伴奏，再通过“添加音轨”导入。本产品尚未接入自动分轨。'};
  let changes=[],name='',explanation='';
  if(/力量|有力|能量|加强|energy|power|punch|强一点/i.test(text)){
    changes=version.tracks.filter(t=>['drums','bass','harmony'].includes(t.kind)).map(t=>({trackId:t.id,gain:t.kind==='drums'?1.38:t.kind==='bass'?1.18:1.1}));
    if(!changes.length)return {kind:'external',title:'先获取独立伴奏音轨',explanation:'目前只有混合音频，无法只增强鼓和贝斯。导入独立音轨后可以精确调整；也可以先用音轨面板调整整段音量。'};
    name=`${section.name}更有力量`;explanation=`仅调整${section.name}（${fmt(section.start)}–${fmt(section.end)}）的鼓、贝斯和和声电平。旋律或人声音轨保持原样，其他段落不变。这是音量层次调整，不会生成新乐器。`;
  }else if(/伴奏|轻一点|柔和|温柔|quieter|soft|backing/i.test(text)){
    changes=instrumental.filter(t=>t.kind!=='mix').map(t=>({trackId:t.id,gain:.72}));name='伴奏留出呼吸感';explanation=`把${section.name}的独立伴奏降至当前音量的 72%，保留旋律或人声。其他段落不变。`;
  }else if(/鼓|drum/i.test(text)){
    changes=version.tracks.filter(t=>t.kind==='drums').map(t=>({trackId:t.id,gain:/小|轻|低|less|lower/i.test(text)?.65:1.3}));name='调整鼓的存在感';explanation=`只调整${section.name}的鼓组音量，保留其他音轨。`;
  }else if(/人声|vocal/i.test(text)){
    changes=version.tracks.filter(t=>t.kind==='vocals').map(t=>({trackId:t.id,gain:1.2}));name='让人声更靠前';explanation=`只把${section.name}的人声音轨提高 20%，保留伴奏。`;
  }else return {kind:'guide',title:'把想法变成一次具体修改',explanation:'目前能理解的演示指令包括“副歌更有力量”“伴奏轻一点”“鼓声小一点”和“人声突出一点”。也可以在音轨面板直接调整音量。其他想法可以写进制作需求单。'};
  if(!changes.length)return {kind:'external',title:'暂时没有可单独调整的音轨',explanation:'请先导入对应的独立音轨。对混合音频降低音量会同时影响人声与伴奏，不能当作分轨处理。'};
  return {kind:'mix',title:name,explanation,sectionId:section.id,start:section.start,end:section.end,changes};
}
export function applyProposal(project,proposal) {
  if(proposal.kind!=='mix'||!project.working)throw new Error('这个方案需要外部制作，不能直接应用。');
  const baseId=project.working.id;
  project.working.effects.push({id:uid(),start:proposal.start,end:proposal.end,changes:clone(proposal.changes)});
  const result=makeSnapshot(project,proposal.title,proposal.explanation);project.compareId=baseId;logEvent(project,'proposal_applied',{versionId:result.id});return result;
}
export function evaluateStudy(records) {
  const attended=records.filter(r=>r.completed);
  const shared=attended.filter(r=>r.shareReady);
  const controlled=attended.filter(r=>r.modifications>=2&&r.improved&&r.preserved);
  const returned=attended.filter(r=>{const delta=Date.parse(r.returnDate)-Date.parse(r.sessionDate);return r.voluntaryReturn&&delta>0&&delta<=7*86400000;});
  const languages=['zh','en'].map(language=>({language,passed:shared.some(r=>r.language===language&&controlled.some(c=>c.id===r.id))}));
  return {attended:attended.length,shared:shared.length,controlled:controlled.length,returned:returned.length,languages,passed:shared.length>=4&&controlled.length>=4&&returned.length>=3&&languages.every(l=>l.passed)};
}
export function emptyStudy() {return Array.from({length:6},(_,i)=>({id:`${i<3?'ZH':'EN'}-${i%3+1}`,language:i<3?'zh':'en',completed:false,sessionDate:'',returnDate:'',voluntaryReturn:false,shareReady:false,improved:false,preserved:false,modifications:0,attempts:0,minutes:0,cost:0,helpCount:0,pronunciation:'',phrasing:'',notes:''}));}
export function validateStudyRecord(record) {
  for(const key of ['modifications','attempts','minutes','cost','helpCount'])if(!Number.isFinite(record[key])||record[key]<0)throw new Error('次数、时间和成本必须为非负数字。');
  for(const key of ['modifications','attempts','helpCount'])if(!Number.isInteger(record[key]))throw new Error('次数必须为整数。');
  if(record.completed&&!record.sessionDate)throw new Error('请填写首次测试日期。');
  const today=new Date();today.setHours(23,59,59,999);
  for(const key of ['sessionDate','returnDate'])if(record[key]&&(!Number.isFinite(Date.parse(record[key]))||Date.parse(record[key])>today.getTime()))throw new Error('测试与回访日期必须是已经发生的有效日期。');
  if(record.returnDate&&(!record.sessionDate||Date.parse(record.returnDate)<=Date.parse(record.sessionDate)))throw new Error('回访日期必须晚于首次测试日期。');
  if(record.voluntaryReturn&&!record.returnDate)throw new Error('请填写自愿回访的实际日期。');
  return record;
}
export function toCSV(rows) {
  const escape=value=>{let s=String(value??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return '\uFEFF'+rows.map(row=>row.map(escape).join(',')).join('\r\n');
}
