"""An original, controlled pair: add guitar/pad while keeping all shared audio fixed."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import numpy as np
import soundfile as sf

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'.local/compositions/e68ea465-be24-48ca-a640-61a37aa64e6b'
OUT=ROOT/'dist/listening-trial';WORK=ROOT/'.local/listening-trial-render'
FFMPEG=Path('D:/26project/26audio_and_video_project/ffmpeg-n6.1.3-win64-gpl-shared-6.1/bin/ffmpeg.exe')
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,value):p.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
def execute(args):return subprocess.run([str(x) for x in args],capture_output=True,check=True,timeout=90,creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
def loudness(path):
    r=execute([FFMPEG,'-hide_banner','-i',path,'-af','loudnorm=I=-23:TP=-1:LRA=11:print_format=json','-f','null','-'])
    return float(json.loads(re.findall(r'\{[^{}]*"input_i"[^{}]*\}',r.stderr.decode(),re.S)[-1])['input_i'])

if __name__=='__main__':
    OUT.mkdir(exist_ok=True);WORK.mkdir(parents=True,exist_ok=True)
    score=json.loads((SOURCE/'score.json').read_text(encoding='utf-8'));sr=score['sampleRate'];size=round(score['duration']*sr)
    spec=importlib.util.spec_from_file_location('styles',ROOT/'scripts/arrangement-styles.py');styles=importlib.util.module_from_spec(spec);spec.loader.exec_module(styles)
    tracks=styles.arrange(score['chords'],'retro');exe=next((ROOT/'.local/arrangement-tools').glob('fluidsynth-2.6.1/**/fluidsynth.exe'));bank=ROOT/'.local/arrangement-tools/GeneralUser-GS.sf2'
    assert digest(bank)=='9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe'
    stems={}
    for name,track in tracks.items():
        midi=WORK/(name+'.mid');target=WORK/(name+'.wav');midi.write_bytes(styles.midi({name:track},score['bpm'],8))
        execute([exe,'-ni','-r',sr,'-g','.6','-R','0','-C','0','-T','wav','-O','float','-F',target,bank,midi])
        raw,rate=sf.read(target,dtype='float64',always_2d=True);assert rate==sr
        out=np.zeros((size,2));out[:min(size,len(raw))]=raw[:size];fade=round(sr*.15);out[-fade:]*=np.linspace(1,0,fade)[:,None];stems[name]=out
    total=sum(stems.values());gain=min(.055/max(np.sqrt(np.mean(total**2)),1e-8),.26/max(np.max(np.abs(total)),1e-8))
    common=sum(stems[k] for k in ['electric-piano','finger-bass','drums'])*gain
    extra=(stems['clean-guitar']+stems['warm-pad'])*gain
    vocal,rate=sf.read(SOURCE/'vocal.wav',dtype='float64');assert rate==sr and len(vocal)==size
    a=common+vocal[:,None];b=a+extra
    for name,wav in [('A',a),('B',b)]:sf.write(OUT/(name+'.wav'),wav,sr,subtype='PCM_24')
    la,lb=loudness(OUT/'A.wav'),loudness(OUT/'B.wav')
    # Limit loudness bias without independently changing vocal/common-track gains.
    scale=1.0
    while abs(lb-la)>.5 and scale>.2:
        scale*=.8;b=a+extra*scale;sf.write(OUT/'B.wav',b,sr,subtype='PCM_24');lb=loudness(OUT/'B.wav')
    assert abs(lb-la)<=.5
    aa,_=sf.read(OUT/'A.wav',dtype='float64',always_2d=True);bb,_=sf.read(OUT/'B.wav',dtype='float64',always_2d=True)
    assert np.max(np.abs((bb-aa)-extra*scale))<=2/2**23
    assert np.isfinite(aa).all() and np.isfinite(bb).all() and max(np.max(np.abs(aa)),np.max(np.abs(bb)))<.98
    variants=[{'id':key,'file':key+'.wav','hash':digest(OUT/(key+'.wav')),'description':desc,'music':{'style':'retro','bpm':116,'voice':'qixuan',**({'texture':'sparse'} if key=='A' else {})}} for key,desc in [('A','简约伴奏：电钢琴、贝斯与鼓'),('B','增加层次：在相同基础上加入清音吉他和铺底声部')]]
    manifest={'id':'reunion-layers-v1','title':score['title'],'duration':score['duration'],'bpm':116,'factor':'accompaniment-layers','factorLabel':'伴奏层次','question':'哪一版让你更想继续听？','story':'周五下班，和许久未见的朋友骑车去海边。听见朋友在前面喊自己的名字，终于笑着追上去。','lyrics':score['lyrics'],'preserved':['歌词与旋律','116 BPM 的节奏','同一份绮萱演唱','相同的电钢琴、贝斯与鼓音频'],'variants':variants,'evidence':{'sourceScoreHash':digest(SOURCE/'score.json'),'sourceVocalHash':digest(SOURCE/'vocal.wav'),'sameVocalSamples':True,'sameCommonInstrumentSamples':True,'integratedLufs':{'A':la,'B':lb},'extraGain':scale,'differenceWithinPCM24Tolerance':True},'assessment':'awaiting-user-choice'}
    write(OUT/'manifest.json',manifest);write(ROOT/'validation/listening-trial-audio.json',manifest['evidence'])
    print(json.dumps({'ready':True,'duration':score['duration'],'lufs':[la,lb],'extraGain':scale},ensure_ascii=False))
