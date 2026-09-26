const vlq=value=>{const bytes=[value&127];while(value>>=7)bytes.unshift((value&127)|128);return bytes;};
const chunk=(name,data)=>{const header=Buffer.alloc(8);header.write(name);header.writeUInt32BE(data.length,4);return Buffer.concat([header,Buffer.from(data)]);};
export function scoreMidi(score,lyrics){
  const tempo=Math.round(60000000/score.bpm),events=[{tick:0,order:0,bytes:[255,81,3,(tempo>>16)&255,(tempo>>8)&255,tempo&255]},{tick:0,order:0,bytes:[255,88,4,4,2,24,8]}];
  for(const [i,phrase] of score.phrases.entries())for(const [j,note] of phrase.notes.entries()){
    const lyric=Buffer.from(score.format==='expressive-v1'?note.lyric:[...lyrics[i]][j]);const tick=Math.round(note.beat*480);
    if(!note.continuation)events.push({tick,order:1,bytes:[255,5,...vlq(lyric.length),...lyric]});
    events.push({tick,order:2,bytes:[144,note.midi,90]},{tick:Math.round((note.beat+note.beats)*480),order:0,bytes:[128,note.midi,0]});
  }
  events.sort((a,b)=>a.tick-b.tick||a.order-b.order);let last=0;const bytes=[];
  for(const event of events){bytes.push(...vlq(event.tick-last),...event.bytes);last=event.tick;}
  bytes.push(0,255,47,0);return Buffer.concat([chunk('MThd',[0,0,0,1,1,224]),chunk('MTrk',bytes)]);
}
