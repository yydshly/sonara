import { SAMPLE_RATE, clamp } from './core.mjs';
const TAU=Math.PI*2;
const frequency=midi=>440*Math.pow(2,(midi-69)/12);
const envelope=(t,d)=>Math.min(1,t/.018)*Math.min(1,(d-t)/.09)*Math.exp(-t*1.6);
function note(target,start,duration,midi,amp,timbre,sr){const offset=Math.floor(start*sr),length=Math.min(Math.floor(duration*sr),target.length-offset),f=frequency(midi);for(let i=0;i<length;i++){const t=i/sr,phase=TAU*f*t;let signal=Math.sin(phase);if(timbre==='keys')signal+=.23*Math.sin(phase*2)*Math.exp(-t*3)+.09*Math.sin(phase*3);if(timbre==='pluck')signal+=.3*Math.sin(phase*2)+.16*Math.sin(phase*4)*Math.exp(-t*8);if(timbre==='bass')signal+=.22*Math.sin(phase*2);target[offset+i]+=signal*amp*envelope(t,duration);}}
export function generateDemo(direction='warm',sr=SAMPLE_RATE) {
  const bpm=direction==='warm'?88:108,beat=60/bpm,duration=128*beat,length=Math.ceil(duration*sr);
  const tracks=Object.fromEntries(['melody','harmony','bass','drums'].map(k=>[k,new Float32Array(length)]));
  const chords=[[60,64,67,71],[57,60,64,67],[53,57,60,64],[55,59,62,65]];
  const melody=[[76,74,72,71,72,67,69,72],[72,71,69,67,64,67,69,71],[69,67,65,64,65,69,72,74],[71,69,67,62,67,71,74,72]];
  let rng=43711;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296*2-1;};
  function drum(start,kind,amp){const offset=Math.floor(start*sr),len=Math.min(Math.floor((kind==='kick'?.4:.17)*sr),length-offset);for(let j=0;j<len;j++){const t=j/sr;let s;if(kind==='kick')s=Math.sin(TAU*(45*t+7*(1-Math.exp(-t*25))))*Math.exp(-t*14);else if(kind==='snare')s=(random()*.7+Math.sin(TAU*180*t)*.2)*Math.exp(-t*24);else s=random()*Math.exp(-t*60);tracks.drums[offset+j]+=s*amp;}}
  for(let bar=0;bar<32;bar++){
    const chord=chords[Math.floor(bar/2)%4],start=bar*4*beat,chorus=bar>=16&&bar<24,intro=bar<4,outro=bar>=28,level=outro?.65:1;
    for(let n=0;n<8;n++){const pitch=chord[n%4]+(n>=4?12:0);note(tracks.harmony,start+n*.5*beat,1.3*beat,pitch,.083*level,direction==='warm'?'keys':'pluck',sr);}
    if(!intro){for(let n=0;n<4;n++)note(tracks.bass,start+n*beat,.82*beat,chord[0]-24+(n===3?7:0),.17*level,'bass',sr);}
    if(bar>=2&&!outro){for(let n=0;n<4;n++){drum(start+n*beat,n%2?'snare':'kick',n%2?.16:.32);drum(start+(n+.5)*beat,'hat',chorus?.062:.036);if(chorus||direction==='bright')drum(start+n*beat,'hat',.024);}}
    if(!intro){const phrase=melody[Math.floor(bar/2)%4];for(let n=0;n<4;n++){const pitch=phrase[(bar%2)*4+n]+(chorus?0:-12);note(tracks.melody,start+(n+.12)*beat,.87*beat,pitch,.11*level,'keys',sr);}}
  }
  // A quiet, fixed delay adds space while keeping every stem independently editable.
  for(const kind of ['melody','harmony']){const a=tracks[kind],delay=Math.floor(beat*.75*sr);for(let i=delay;i<a.length;i++)a[i]+=a[i-delay]*.16;}
  const fade=Math.floor(1.8*sr);for(const a of Object.values(tracks)){for(let i=0;i<fade;i++){a[i]*=i/fade;a[a.length-1-i]*=i/fade;}}
  return {tracks,duration,sampleRate:sr};
}
export function effectGainAt(effects,trackId,time){let gain=1;for(const effect of effects||[]){if(time<effect.start||time>=effect.end)continue;const change=effect.changes.find(c=>c.trackId===trackId);if(!change)continue;const edge=Math.min(1,(time-effect.start)/.025,(effect.end-time)/.025);gain*=1+(change.gain-1)*Math.max(0,edge);}return clamp(gain,0,3);}
export function renderMix(version,sources,sr=version.sampleRate||SAMPLE_RATE){
  const length=Math.ceil(version.duration*sr),left=new Float32Array(length),right=new Float32Array(length),solo=version.tracks.some(t=>t.solo);
  for(const track of version.tracks){if(track.muted||(solo&&!track.solo))continue;const source=sources[track.id];if(!source)throw new Error(`找不到「${track.name}」音频，请重新导入。`);const channels=source.channels||[source];const l=channels[0],r=channels[1]||l;const pan=track.kind==='harmony'&&!track.assetId?.12:0;
    for(let i=0;i<Math.min(length,l.length);i++){const gain=clamp(track.gain,0,1.8)*effectGainAt(version.effects,track.id,i/sr);left[i]+=l[i]*gain*(1-pan*.3);right[i]+=(r[i]??0)*gain;}}
  // Keep normal peaks intact; report actual overload instead of silently lowering every peak.
  let clippedSamples=0;for(let i=0;i<length;i++){if(Math.abs(left[i])>1||Math.abs(right[i])>1)clippedSamples++;left[i]=clamp(left[i],-1,1);right[i]=clamp(right[i],-1,1);}
  return {left,right,sampleRate:sr,duration:version.duration,clippedSamples};
}
export function peaksFor(data,count=120){const peaks=[];const step=Math.max(1,Math.floor(data.length/count));for(let i=0;i<count;i++){let peak=0;for(let j=i*step;j<Math.min(data.length,(i+1)*step);j+=8)peak=Math.max(peak,Math.abs(data[j]));peaks.push(peak);}const max=Math.max(...peaks,.01);return peaks.map(p=>p/max);}
export function encodeWav(mix,start=0,end=mix.duration,bitDepth=16){
  if(![16,24].includes(bitDepth))throw new Error('Unsupported PCM depth');
  const sr=mix.sampleRate,begin=Math.floor(start*sr),finish=Math.min(mix.left.length,Math.floor(end*sr)),length=Math.max(0,finish-begin),bytes=bitDepth/8,block=bytes*2,buffer=new ArrayBuffer(44+length*block),view=new DataView(buffer);
  const str=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  str(0,'RIFF');view.setUint32(4,36+length*block,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,sr,true);view.setUint32(28,sr*block,true);view.setUint16(32,block,true);view.setUint16(34,bitDepth,true);str(36,'data');view.setUint32(40,length*block,true);
  for(let i=0;i<length;i++)for(let c=0;c<2;c++){const sample=clamp((c?mix.right:mix.left)[begin+i],-1,1),n=Math.round(sample*(2**(bitDepth-1)-1)),at=44+i*block+c*bytes;if(bytes===2)view.setInt16(at,n,true);else{view.setUint8(at,n&255);view.setUint8(at+1,(n>>8)&255);view.setUint8(at+2,(n>>16)&255);}}
  return buffer;
}
