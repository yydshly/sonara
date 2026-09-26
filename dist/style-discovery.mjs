import {musicStyles} from './music-styles.mjs';
export async function initStyleDiscovery(anchor,{pause=()=>{},choose}={}){
  if(!anchor)return;
  const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
  try{
    const response=await fetch('/style-demos/manifest.json');if(!response.ok)return;
    const manifest=await response.json();
    anchor.append(make('h2','同一段心情，也可以有不同的节奏。'),make('p','先听四个方向：同词同旋律，速度和编配不同。选择喜欢的方向，再写你自己的歌。'));
    const grid=make('div',null,'style-preview-grid');anchor.append(grid);
    for(const style of musicStyles){const demo=manifest.versions.find(v=>v.style===style.id);if(!demo)continue;
      const card=make('article',null,'style-preview');card.append(make('small',demo.bpm+' BPM · '+demo.duration+' 秒'),make('h3',style.name),make('p',style.feeling));
      const audio=make('audio');audio.controls=true;audio.preload='metadata';audio.src=demo.audio;audio.setAttribute('aria-label',style.name+'试听');
      audio.addEventListener('play',()=>{pause();for(const a of document.querySelectorAll('audio'))if(a!==audio)a.pause();});
      const action=make(choose?'button':'a','用这个方向创作','secondary');if(choose)action.onclick=()=>{for(const a of anchor.querySelectorAll('audio'))a.pause();choose({...style,voice:demo.voice});};else action.href='/compose.html?view=new&style='+style.id+'&voice='+demo.voice;
      card.append(audio,action);grid.append(card);
    }
    anchor.append(make('p','本机合成试听 · 四句原创小样 · 绮萱 Qixuan。不同速度已重新演唱；音质仍需试听判断。','disclosure'));
    for(const a of document.querySelectorAll('audio:not(.style-preview audio)'))a.addEventListener('play',()=>{for(const other of anchor.querySelectorAll('audio'))other.pause();});
  }catch{anchor.replaceChildren();}
}
