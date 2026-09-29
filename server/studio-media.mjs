import {StudioError} from '../dist/studio-core.mjs';
export function inspectAudio(data){
  if(!Buffer.isBuffer(data)||data.length<44||data.length>50*1024*1024)throw new StudioError('请选择不超过 50 MB 的完整 MP3 或 WAV 音频。',422);
  if(data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WAVE'){
    let format,size;for(let i=12;i+8<=data.length;){const length=data.readUInt32LE(i+4),end=i+8+length;if(end>data.length)throw new StudioError('WAV 文件不完整。',422);const tag=data.toString('ascii',i,i+4);if(tag==='fmt '&&length>=16)format={encoding:data.readUInt16LE(i+8),channels:data.readUInt16LE(i+10),rate:data.readUInt32LE(i+12),bytesPerSecond:data.readUInt32LE(i+16)};if(tag==='data')size=length;i=end+(length%2);}
    if(!format||![1,3,65534].includes(format.encoding)||!size||format.channels<1||format.channels>8||format.rate<8000||format.rate>192000||!format.bytesPerSecond)throw new StudioError('无法识别 WAV 音频内容。',422);
    const duration=size/format.bytesPerSecond;if(duration<.5||duration>1200)throw new StudioError('音频时长应在 0.5 秒到 20 分钟之间。',422);return {extension:'wav',type:'audio/wav',duration,bytes:data.length};
  }
  let start=0;if(data.toString('ascii',0,3)==='ID3'){if(data.length<10)throw new StudioError('MP3 文件不完整。',422);start=10+((data[6]&127)*2097152+(data[7]&127)*16384+(data[8]&127)*128+(data[9]&127));if(data[5]&16)start+=10;}
  const bitrates1=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],bitrates2=[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
  let duration=0,frames=0,pos=start;
  while(pos+4<=data.length){
    const b=data[pos+1],c=data[pos+2],version=(b>>3)&3,layer=(b>>1)&3,rateIndex=(c>>2)&3,bitrateIndex=(c>>4)&15;
    if(data[pos]!==255||(b&224)!==224||version===1||layer!==1||rateIndex===3||!bitrateIndex||bitrateIndex===15)break;
    const rate=[44100,48000,32000][rateIndex]/(version===3?1:version===2?2:4),bitrate=(version===3?bitrates1:bitrates2)[bitrateIndex]*1000;
    const length=Math.floor((version===3?144:72)*bitrate/rate)+((c>>1)&1);if(pos+length>data.length)break;duration+=(version===3?1152:576)/rate;pos+=length;frames++;
  }
  if(frames<3||duration<.5||duration>1200||pos-start<(data.length-start)*.9)throw new StudioError('文件不是完整可识别的 MP3/WAV；未保存为成功作品。',422);
  return {extension:'mp3',type:'audio/mpeg',duration,bytes:data.length};
}
