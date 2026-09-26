import {ServiceError} from './generation-service.mjs';
import {musicStyles,singerChoices} from '../dist/music-styles.mjs';
export function validateMusicDirection(value){
  if(value===undefined||value===null)return null;
  if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['style','bpm','voice','texture'].includes(k))||!musicStyles.some(s=>s.id===value.style)||!Number.isInteger(value.bpm)||value.bpm<72||value.bpm>144||!singerChoices.some(s=>s.id===value.voice))throw new ServiceError('请选择支持的音乐风格、声线，以及 72–144 BPM 的整数速度。');
  if(value.texture!==undefined&&(!['standard','sparse'].includes(value.texture)||(value.texture==='sparse'&&value.style!=='retro')))throw new ServiceError('简约层次目前适用于复古律动。');
  return {style:value.style,bpm:value.bpm,voice:value.voice,...(value.texture==='sparse'?{texture:'sparse'}:{})};
}
export function musicInstructions(music){
  if(!music)return 'Choose a tempo that fits the intention within 72–144 BPM.';
  const style=musicStyles.find(s=>s.id===music.style);
  return `Requested style: ${style.name}. EXACT tempo: ${music.bpm} BPM; never silently change it. ${style.writing} The arrangement will use ${music.texture==='sparse'?'电钢琴、贝斯和鼓，留出空间，不加入清音吉他与铺底声部':style.instruments}. This is a choice for this project, not evidence of a permanent personal taste. Style must affect lyric phrasing and note rhythm, not just the description. For a lively style at 108 BPM or above, prefer note durations <=1.5 beats and put expressive weight on meaningful words. Voice profile: ${music.voice}.`;
}
