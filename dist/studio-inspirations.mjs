import {emptyDraft,validateDraft} from './studio-core.mjs';

// Fictional scenarios written for product exploration, not user project data.
export const inspirations=[
  {
    id:'late-shift',label:'城市生活',title:'晚班的便利店',
    idea:'一个在城市里工作的九零后，晚上十点下班，在便利店热一份饭。店员已经记得他不要辣，他接起朋友的电话，绕了一站路走回家。写疲惫里的小小善意，不写成功学。',
    style:'城市流行 / City Pop；电钢琴、干净吉他、弹性贝斯、轻巧鼓组',tempo:'108 BPM，中速偏轻快，有切分律动，句尾利落',voice:'自然的中低音，主歌像说话，副歌明亮但不喊',
    emotionStart:'下班后的疲惫，有一点孤单',emotionPeak:'被记住的小习惯，让心情亮起来',emotionEnd:'今天也算好好过完了，轻松地回家',details:'便利店微波炉、不要辣的饭、朋友打来的电话、多走一站路',
    focus:'检验中速律动下的中文咬字，副歌能否展开又不喊口号。'
  },
  {
    id:'station-home',label:'亲情',title:'到家再说',
    idea:'离家工作几年后坐末班火车回县城，母亲在出站口提着一袋剥好的橘子。她没有追问过得好不好，只说锅里还留着汤。想表达成年以后终于可以在家人面前松一口气。',
    style:'温暖民谣流行；木吉他、轻钢琴、刷鼓，副歌加入温暖弦乐',tempo:'88 BPM，叙事有呼吸但不拖沓，停顿留给句子',voice:'亲近、松弛的女中音，少气声，不刻意哭腔',
    emotionStart:'一路逞强，见面时还故作轻松',emotionPeak:'听见锅里留着汤，才肯放下防备',emotionEnd:'平静安心，今晚不必解释自己',details:'末班火车、剥好的橘子、出站口、锅里留下的汤',
    focus:'检验克制情绪能否通过动作和细节表达，避免过长拖音。'
  },
  {
    id:'last-school-bus',label:'青春友情',title:'最后一班校车',
    idea:'三十岁那年几个高中朋友再聚，翻到毕业当天最后一班校车的合影。有人记得借来的耳机，有人记得没写完的留言册；现在各有生活，还会为同一个老笑话笑出声。是有冲劲的青春友情，不把怀念写成悲伤。',
    style:'明亮流行摇滚；清晰电吉他、贝斯、真实鼓组，副歌适量和声',tempo:'128 BPM，向前走的八分音符节奏，副歌短句有力',voice:'清爽、有少年感的自然人声，轻微沙感，不挤高音',
    emotionStart:'重逢时一点生疏，笑着翻旧照片',emotionPeak:'笑话接上了，像又坐回同一排',emotionEnd:'各自向前，但随时可以再见',details:'校车合影、单边耳机、没写完的留言册、同一个老笑话',
    focus:'检验快节奏中文可唱性与副歌记忆点，避免青春口号。'
  },
  {
    id:'old-mugs',label:'感情遗憾',title:'两只旧杯子',
    idea:'搬家时发现两只旧杯子，其中一只杯沿有缺口。年轻时两个人挤在出租屋里，后来因为不会好好说话而分开。现在懂得照顾人了，也明白不该再去打扰。用收拾物件的过程写遗憾，不复述任何已有歌曲。',
    style:'克制的华语 R&B；Rhodes 电钢琴、松弛的鼓、圆润贝斯，副歌温和铺开',tempo:'94 BPM，轻微后拍感，主歌有留白，副歌不刻意拉长句尾',voice:'温柔中低音，连贯而清楚，少转音，不模仿特定歌手',
    emotionStart:'收拾旧物时若无其事',emotionPeak:'终于承认当时没学会好好相处',emotionEnd:'把杯子包好，也把祝福留给对方',details:'杯沿缺口、旧报纸、搬家纸箱、过去的出租屋',
    focus:'检验遗憾是否具体而不煽情，R&B 转音会不会损害语义。'
  },
  {
    id:'sunday-room',label:'轻快日常',title:'星期天晒被子',
    idea:'独居的人周日把房间打扫了一遍，给自己做了稍微丰盛的早饭，在阳台把被子晒到太阳里。没有突然变好的人生，只是终于有心情照顾自己。想写轻盈、幽默、可以跟着摇摆的歌。',
    style:'轻快复古流行 / 轻 Disco；跳跃贝斯、节奏吉他、轻鼓和少量合成器',tempo:'122 BPM，松弛的四拍律动，短句不赶字',voice:'明亮松弛的女声，像笑着聊天，避免幼态和夸张卖萌',
    emotionStart:'周末睡醒，有一点懒散',emotionPeak:'小房间变亮，自己也愿意跟着动起来',emotionEnd:'满足但不过分，今天就这样很好',details:'阳台晾衣夹、煎蛋边缘、干净床单、被太阳晒暖的被子',
    focus:'检验轻快情绪与幽默感，避免所有作品都唱成慢情歌。'
  },
  {
    id:'green-light',label:'英文夜行',title:'One More Green Light',language:'en',
    idea:'Two old friends drive home after a late shift, taking the long road along the river. One is moving away next week. A coffee cup rattles in the holder; neither knows how to say goodbye, so they let one more green light carry them forward. Quiet affection, no grand promise.',
    style:'Warm indie synth-pop; muted guitar, rounded bass, soft analog pads, steady live-feeling drums',tempo:'112 BPM, a gentle driving pulse, conversational verses and concise chorus endings',voice:'Natural intimate mid-range vocal, clear English consonants, restrained chorus lift',
    emotionStart:'Tired, comfortable silence between old friends',emotionPeak:'An ordinary drive becomes a goodbye neither can say',emotionEnd:'Grateful, still moving, leaving room for another visit',details:'Rattling coffee cup, river road, changing traffic lights, a move next week',
    focus:'检验英文自然重音、断句和韵脚，避免为了押韵牺牲意思。'
  },
  {
    id:'after-rain',label:'纯音乐 · 松弛',title:'雨停以后的街',mode:'instrumental',
    idea:'雨刚停，晚高峰的街道慢慢安静。路灯映在积水里，脚步从匆忙变得放松。做一段适合夜晚散步的原创纯音乐，有旋律和发展，不是循环同一小节。',
    style:'Lo-fi / 氛围爵士；柔和电钢琴、拨弦贝斯、刷鼓、少量街道雨后氛围',tempo:'92 BPM，松弛的律动，前半克制、后半有和声展开',voice:'无演唱、无哼唱',
    emotionStart:'雨后潮湿、稍显疲惫',emotionPeak:'灯光倒影中有一点明亮，步子渐渐轻快',emotionEnd:'平静放松，自然收束',details:'电钢琴为主旋律，街道氛围轻到不影响音乐；必须有一次发展和回归',
    focus:'检验无人声约束、旋律发展与配器层次，避免机械循环。'
  },
  {
    id:'ridge-wind',label:'纯音乐 · 开阔',title:'风从山脊过',mode:'instrumental',
    idea:'天亮前徒步上山，开始只能听见自己的呼吸，走到山脊时云层被晨光打开。做一首有推进感但不喧闹的电子纯音乐，从窄到宽，从紧到松，最后留下风的空间。',
    style:'旋律电子 / Cinematic Electronica；短音琶音、深而干净的贝斯、分层打击乐与宽阔合成器',tempo:'136 BPM，清楚的推进脉冲，约中段形成一次展开，不用持续满编配制造张力',voice:'无演唱、无采样人声、无合唱',
    emotionStart:'天未亮，专注、有一点紧张',emotionPeak:'登上山脊，空间突然变开阔',emotionEnd:'放松而明亮，保留呼吸感',details:'前段窄声场，中段打开；给鼓组与旋律留下空间，结尾自然消散',
    focus:'检验较快速度中的情绪曲线、动态层次与干净低频。'
  }
];

export function inspirationDraft(sample){
  const {id,label,focus,...input}=sample;
  return validateDraft({...emptyDraft(),...input});
}

// A shuffled bag visits every direction before repeating, without blending
// incompatible scene fragments into a story that no longer makes sense.
export function createInspirationPicker(samples=inspirations,random=Math.random){
  let remaining=[],previous=null;
  return ()=>{
    if(!samples.length)throw new Error('没有可用的灵感方向。');
    if(!remaining.length){
      remaining=[...samples];
      for(let i=remaining.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[remaining[i],remaining[j]]=[remaining[j],remaining[i]];}
      if(remaining.length>1&&remaining.at(-1).id===previous)[remaining[0],remaining[remaining.length-1]]=[remaining.at(-1),remaining[0]];
    }
    const sample=remaining.pop();previous=sample.id;return structuredClone(sample);
  };
}
