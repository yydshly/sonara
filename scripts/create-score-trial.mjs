import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { encodeWav } from '../dist/audio-core.mjs';

// The score is the source of truth. Both lyric versions use exactly these notes.
const out = new URL('../dist/score-trial/', import.meta.url);
await mkdir(out, { recursive: true });
const bpm=80, beat=60/bpm, sr=44100, duration=26;
const lines=['让晚风替我拥抱你','把心事唱给星星听','就让遗憾随风远去','在天亮以后遇见你'];
const revised=[...lines]; revised[1]='把想念藏进晚风里';
const pinyin=['rang wan feng ti wo yong bao ni','ba xin shi chang gei xing xing ting','jiu rang yi han sui feng yuan qu','zai tian liang yi hou yu jian ni'];
const revisedPinyin=[...pinyin]; revisedPinyin[1]='ba xiang nian cang jin wan feng li';
const pitches=[[57,60,62,64,62,60,57,55],[59,62,64,67,64,62,60,60],[62,65,64,62,60,59,57,59],[60,64,67,64,62,60,62,60]];
const lengths=[[.5,.5,1,.5,.5,1,1,2],[.5,.5,1,1,.5,.5,1,2],[.5,.5,1,.5,.5,1,1,2],[.5,.5,1,.5,.5,1,1,2]];
const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const pitchName=n=>names[n%12]+(Math.floor(n/12)-1);
const phrases=lines.map((line,i)=>{let position=i*8+.5; return {index:i,lyrics:line,revisedLyrics:revised[i],start:i*8*beat,end:(i+1)*8*beat,notes:[...line].map((char,j)=>{const n={lyric:char,revisedLyric:[...revised[i]][j],pinyin:pinyin[i].split(' ')[j],revisedPinyin:revisedPinyin[i].split(' ')[j],midi:pitches[i][j],pitch:pitchName(pitches[i][j]),beat:position,beats:lengths[i][j],start:position*beat,duration:lengths[i][j]*beat}; position+=n.beats;return n;})};});
const chordNames=['Fmaj7','G6','Em7','Am7','Dm7','G7','Cmaj7','C'];
const chords=[[53,57,60,64],[55,59,62,64],[52,55,59,62],[57,60,64,67],[50,57,60,65],[55,59,62,65],[48,55,59,64],[48,55,60,64]];
const score={title:'晚风来信 · 副歌试作',bpm,meter:'4/4',key:'C major',duration,scoreDuration:24,sampleRate:sr,voice:'Ria / 狸安',lyrics:lines,revisedLyrics:revised,chords:chordNames,phrases};
await writeFile(new URL('score.json',out),JSON.stringify(score,null,2));
await writeFile(new URL('lyrics-A.txt',out),lines.join('\n')+'\n');
await writeFile(new URL('lyrics-B.txt',out),revised.join('\n')+'\n');

// Standard MIDI: tempo, time signature, UTF-8 lyric meta events and one vocal track.
const vlq=value=>{let b=[value&127];while(value>>=7)b.unshift((value&127)|128);return b;};
const chunk=(name,data)=>{const header=Buffer.alloc(8);header.write(name);header.writeUInt32BE(data.length,4);return Buffer.concat([header,Buffer.from(data)]);};
function midi(variant){const events=[{tick:0,order:0,bytes:[0xff,0x51,3,0x0b,0x71,0xb0]},{tick:0,order:0,bytes:[0xff,0x58,4,4,2,24,8]}];for(const p of phrases)for(const n of p.notes){const at=Math.round(n.beat*480),lyric=Buffer.from(variant==='A'?n.lyric:n.revisedLyric);events.push({tick:at,order:1,bytes:[0xff,5,...vlq(lyric.length),...lyric]},{tick:at,order:2,bytes:[0x90,n.midi,90]},{tick:Math.round((n.beat+n.beats)*480),order:0,bytes:[0x80,n.midi,0]});}events.sort((a,b)=>a.tick-b.tick||a.order-b.order);let prev=0,data=[];for(const e of events){data.push(...vlq(e.tick-prev),...e.bytes);prev=e.tick;}data.push(0,255,47,0);const header=Buffer.from([0,0,0,1,1,224]);return Buffer.concat([chunk('MThd',header),chunk('MTrk',data)]);}
for(const v of ['A','B'])await writeFile(new URL(`melody-${v}.mid`,out),midi(v));

const size=sr*duration,stems=Object.fromEntries(['keys','bass','drums','guide'].map(k=>[k,{left:new Float32Array(size),right:new Float32Array(size)}]));
const tau=Math.PI*2;let seed=1739;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1;};
function tone(kind,start,dur,midi,amp,pan=0){const dest=stems[kind],f=440*2**((midi-69)/12),a=Math.floor(start*sr),len=Math.min(size-a,Math.ceil((dur+.2)*sr));for(let i=0;i<len;i++){const t=i/sr,release=Math.max(0,Math.min(1,(dur+.2-t)/.2)),attack=Math.min(1,t/.009);let v;if(kind==='keys')v=(Math.sin(tau*f*t)+.28*Math.sin(tau*f*2*t)*Math.exp(-t*3)+.08*Math.sin(tau*f*3*t))*Math.exp(-t*2.3);else if(kind==='bass')v=(Math.sin(tau*f*t)+.15*Math.sin(tau*f*2*t))*Math.exp(-t*.8);else v=(Math.sin(tau*f*t)+.16*Math.sin(tau*f*2*t))*Math.exp(-t*.7);v*=amp*attack*release;dest.left[a+i]+=v*(1-pan*.3);dest.right[a+i]+=v*(1+pan*.3);}}
function drum(start,kind,amp){const a=Math.floor(start*sr),len=Math.min(size-a,Math.floor(.4*sr));for(let i=0;i<len;i++){const t=i/sr;let v=kind==='kick'?Math.sin(tau*(46*t+5*(1-Math.exp(-t*35))))*Math.exp(-t*15):kind==='snare'?(random()*.65+Math.sin(tau*180*t)*.2)*Math.exp(-t*28):random()*Math.exp(-t*95);v*=amp;stems.drums.left[a+i]+=v;stems.drums.right[a+i]+=v;}}
for(let bar=0;bar<8;bar++){const c=chords[bar],start=bar*4*beat;for(let step=0;step<8;step++)tone('keys',start+step*.5*beat,1.1*beat,c[[0,2,1,3,2,1,3,2][step]]+12,.047,step%2?.5:-.5);for(const n of c.slice(1))tone('keys',start,2.8*beat,n,.029,-.2);for(const [pos,n] of [[0,c[0]-12],[2,c[0]-12],[3.5,c[0]-5]])tone('bass',start+pos*beat,.65,n,.09);for(const b of [0,2])drum(start+b*beat,'kick',.11);for(const b of [1,3])drum(start+b*beat,'snare',.053);for(let b=0;b<8;b++)drum(start+b*.5*beat,'hat',b%2?.016:.008);}
for(const n of phrases.flatMap(p=>p.notes))tone('guide',n.start,n.duration*.92,n.midi,.1);
for(const name of ['keys','guide'])for(const channel of ['left','right']){const a=stems[name][channel],delay=Math.round(sr*(channel==='left'?.16:.23));for(let i=delay;i<a.length;i++)a[i]+=a[i-delay]*.15;}
for(const stem of Object.values(stems))for(const a of Object.values(stem))for(let i=0;i<size;i++)a[i]*=Math.min(1,i/(sr*.02),(size-i)/(sr*1.4));
function mix(kinds){const left=new Float32Array(size),right=new Float32Array(size);for(const k of kinds)for(let i=0;i<size;i++){left[i]+=stems[k].left[i];right[i]+=stems[k].right[i];}return {left,right,sampleRate:sr,duration};}
const backing=mix(['keys','bass','drums']),guide=mix(['keys','bass','drums','guide']);
for(const [file,data] of [['accompaniment.wav',backing],['melody-guide.wav',guide]])await writeFile(new URL(file,out),Buffer.from(encodeWav(data,0,duration,24)));
for(const name of ['keys','bass','drums'])await writeFile(new URL(`${name}.wav`,out),Buffer.from(encodeWav({...stems[name],sampleRate:sr,duration},0,duration,24)));
const hash=createHash('sha256').update(JSON.stringify(phrases.flatMap(p=>p.notes.map(n=>[n.midi,n.beat,n.beats])))).digest('hex');
console.log(JSON.stringify({duration,notes:32,melodyHash:hash,peak:Math.max(...Array.from({length:26},(_,s)=>Math.max(...guide.left.subarray(s*sr,(s+1)*sr).map(Math.abs)))),output:out.pathname}));
