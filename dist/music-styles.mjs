export const musicStyles=[
  {id:'folk',name:'校园民谣',bpm:100,feeling:'亲近、自在，像边走边讲故事',instruments:'钢弦吉他 · 木贝斯 · 轻打击乐',writing:'Use conversational 8–12 character lines, a clear walking pulse, a repeated singable motif, and space between natural word groups.'},
  {id:'retro',name:'复古律动',bpm:116,feeling:'轻快里带着怀念，有向前的脚步',instruments:'电钢琴 · 清音吉他 · 律动贝斯 · 鼓组',writing:'Use 10–14 character lines, syncopation and repeated rhythmic hooks; alternate short notes and accents. Avoid long drawn-out syllables on every line.'},
  {id:'rock',name:'轻快流行摇滚',bpm:132,feeling:'明亮、有冲劲，把心里的话唱出来',instruments:'电吉他 · 电贝斯 · 有力鼓组',writing:'Use 10–14 character lines, short energetic phrases, a memorable repeated hook, strong offbeat pickups and a decisive cadence. Most notes should be 0.5 or 0.75 beats; avoid monotonous sustained singing.'},
  {id:'ballad',name:'温暖抒情',bpm:88,feeling:'从克制的讲述，走向温暖的展开',instruments:'钢琴 · 弦乐 · 低音与轻鼓',writing:'Use 7–11 character lines, purposeful pauses, a few expressive sustained vowels and a melodic rise followed by release. Do not stretch every syllable equally.'}
];
export const singerChoices=[{id:'ria',name:'狸安 Ria'},{id:'qixuan',name:'绮萱 Qixuan'}];
export const musicLabel=music=>music?`${musicStyles.find(s=>s.id===music.style)?.name||(music.style==='legacy'?'早期编配':music.style)} · ${music.bpm} BPM${music.texture==='sparse'?' · 简约伴奏':''} · ${singerChoices.find(s=>s.id===music.voice)?.name||music.voice}`:'早期编配';
