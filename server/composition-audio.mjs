import {writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runProcess} from './codex-composer.mjs';
import {encodeWav} from '../dist/audio-core.mjs';
import {chordNotes} from './composition-score.mjs';
import {scoreMidi} from './score-midi.mjs';

// A transparent, deterministic demo arrangement driven by the generated score.
// The melody/chords come from Codex; these instrument sounds are synthesized here.
export async function prepareCompositionAudio(path,score,{signal}={}){
  if(score.music){
    const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
    await writeFile(join(path,'melody.mid'),scoreMidi(score,score.lyrics));await writeFile(join(path,'lyrics.txt'),score.lyrics.join('\n')+'\n');
    const python=join(root,'.local/score-trial/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
    const result=await runProcess(python,['-X','utf8',join(root,'scripts/render-composition-style.py'),path],{signal,timeout:180000});
    await writeFile(join(path,'arrangement-log.txt'),result.stdout+'\n'+result.stderr);
    if(result.code!==0)throw Error('Sampled arrangement failed');return;
  }
  const sr=score.sampleRate,duration=score.duration,size=Math.round(sr*duration),beat=60/score.bpm;
  const stems=Object.fromEntries(['keys','bass','drums','guide'].map(k=>[k,{left:new Float32Array(size),right:new Float32Array(size)}]));
  const tau=2*Math.PI;let seed=1739;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1;};
  function tone(kind,start,dur,midi,amp,pan=0){
    const dest=stems[kind],f=440*2**((midi-69)/12),a=Math.floor(start*sr),len=Math.min(size-a,Math.ceil((dur+.2)*sr));
    for(let i=0;i<len;i++){const t=i/sr,release=Math.max(0,Math.min(1,(dur+.2-t)/.2)),attack=Math.min(1,t/.009);
      let v=kind==='keys'?(Math.sin(tau*f*t)+.28*Math.sin(tau*f*2*t)*Math.exp(-t*3)+.08*Math.sin(tau*f*3*t))*Math.exp(-t*2.3):kind==='bass'?(Math.sin(tau*f*t)+.15*Math.sin(tau*f*2*t))*Math.exp(-t*.8):(Math.sin(tau*f*t)+.16*Math.sin(tau*f*2*t))*Math.exp(-t*.7);
      v*=amp*attack*release;dest.left[a+i]+=v*(1-pan*.3);dest.right[a+i]+=v*(1+pan*.3);
    }
  }
  function drum(start,kind,amp){const a=Math.floor(start*sr),len=Math.min(size-a,Math.floor(.4*sr));for(let i=0;i<len;i++){const t=i/sr;let v=kind==='kick'?Math.sin(tau*(46*t+5*(1-Math.exp(-t*35))))*Math.exp(-t*15):kind==='snare'?(random()*.65+Math.sin(tau*180*t)*.2)*Math.exp(-t*28):random()*Math.exp(-t*95);v*=amp;stems.drums.left[a+i]+=v;stems.drums.right[a+i]+=v;}}
  score.chords.forEach((name,bar)=>{const c=chordNotes[name],start=bar*4*beat;
    for(let step=0;step<8;step++)tone('keys',start+step*.5*beat,1.1*beat,c[[0,2,1,3,2,1,3,2][step]]+12,.04,step%2?.5:-.5);
    for(const n of c.slice(1))tone('keys',start,2.8*beat,n,.025,-.2);
    for(const [pos,n] of [[0,c[0]-12],[2,c[0]-12],[3.5,c[0]-5]])tone('bass',start+pos*beat,.65,n,.08);
    for(const b of [0,2])drum(start+b*beat,'kick',.1);for(const b of [1,3])drum(start+b*beat,'snare',.045);for(let b=0;b<8;b++)drum(start+b*.5*beat,'hat',b%2?.014:.007);
  });
  for(const n of score.phrases.flatMap(p=>p.notes))tone('guide',n.start,n.duration*.92,n.midi,.12);
  for(const name of ['keys','guide'])for(const channel of ['left','right']){const a=stems[name][channel],delay=Math.round(sr*(channel==='left'?.16:.23));for(let i=delay;i<a.length;i++)a[i]+=a[i-delay]*.15;}
  for(const stem of Object.values(stems))for(const a of Object.values(stem))for(let i=0;i<size;i++)a[i]*=Math.min(1,i/(sr*.02),(size-i)/(sr*1.4));
  function mix(kinds){const left=new Float32Array(size),right=new Float32Array(size);for(const k of kinds)for(let i=0;i<size;i++){left[i]+=stems[k].left[i];right[i]+=stems[k].right[i];}return {left,right,sampleRate:sr,duration};}
  for(const [file,kinds] of [['accompaniment',['keys','bass','drums']],['guide',['keys','bass','drums','guide']]])await writeFile(join(path,file+'.wav'),Buffer.from(encodeWav(mix(kinds),0,duration,24)));
  await writeFile(join(path,'melody.mid'),scoreMidi(score,score.lyrics));await writeFile(join(path,'lyrics.txt'),score.lyrics.join('\n')+'\n');
}
