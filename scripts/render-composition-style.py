"""Render a chosen arrangement and melody guide from an arbitrary short score."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import numpy as np
import soundfile as sf

ROOT=Path(__file__).resolve().parents[1]
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def render(path):
    score=json.loads((path/'score.json').read_text(encoding='utf-8'));music=score['music']
    styles=load('styles','arrangement-styles.py');sr=score['sampleRate'];size=round(score['duration']*sr)
    tools=ROOT/'.local/arrangement-tools';exe=next(tools.glob('fluidsynth-2.6.1/**/fluidsynth.exe'));bank=tools/'GeneralUser-GS.sf2'
    if hashlib.sha256(bank.read_bytes()).hexdigest()!='9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe':raise ValueError('Sound bank identity changed')
    expressive=score.get('format')=='expressive-v1'
    full_tracks=score['arrangementTracks'] if expressive else styles.arrange(score['chords'],music['style'])
    tracks=full_tracks if expressive else {k:v for k,v in full_tracks.items() if music.get('texture')!='sparse' or k not in ['clean-guitar','warm-pad']}
    bars=sum(len(p['chords']) for p in score['phrases'])
    (path/'arrangement.mid').write_bytes(styles.midi(tracks,score['bpm'],bars))
    guide={'program':0,'channel':0,'pan':64,'volume':100,'notes':[{'beat':n['beat'],'beats':n['beats']*.90,'midi':n['midi'],'velocity':76} for p in score['phrases'] for n in p['notes']]}
    (path/'guide-instrument.mid').write_bytes(styles.midi({'melody':guide},score['bpm'],bars))
    def synth(name,midi):
        target=path/(name+'-raw.wav')
        proc=subprocess.run([str(exe),'-ni','-r',str(sr),'-g','.6','-R','0','-C','0','-T','wav','-O','float','-F',str(target),str(bank),str(path/midi)],capture_output=True,timeout=90,check=True,creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
        (path/(name+'-synth.log')).write_bytes(proc.stdout+proc.stderr)
        raw,rate=sf.read(target,dtype='float64',always_2d=True)
        if rate!=sr or raw.shape[1]!=2 or not np.isfinite(raw).all():raise ValueError('Invalid instrument render')
        audio=np.zeros((size,2));audio[:min(size,len(raw))]=raw[:size]
        fade=min(round(sr*.15),size);audio[-fade:]*=np.linspace(1,0,fade)[:,None]
        return audio
    backing=synth('backing','arrangement.mid');melody=synth('melody','guide-instrument.mid')
    reference=backing
    if music.get('texture')=='sparse' and not expressive:
        (path/'reference-arrangement.mid').write_bytes(styles.midi(full_tracks,score['bpm'],bars))
        reference=synth('reference','reference-arrangement.mid')
    backing*=min(.055/max(np.sqrt(np.mean(reference**2)),1e-8),.26/max(np.max(np.abs(reference)),1e-8))
    melody*=min(.08/max(np.sqrt(np.mean(melody**2)),1e-8),.45/max(np.max(np.abs(melody)),1e-8))
    sf.write(path/'accompaniment.wav',backing,sr,subtype='PCM_24');sf.write(path/'guide.wav',backing+melody,sr,subtype='PCM_24')
    record={'engine':'fluidsynth-generaluser-v1','style':music['style'],'texture':music.get('texture','standard'),'bpm':score['bpm'],'sampleRate':sr,'duration':score['duration'],'tracks':tracks,'source':'authored arrangement patterns driven by project chords and tempo','assessment':'unreviewed'}
    if expressive:
        record['source']='model-authored note events for this story; no preset arrangement loop'
        record['roles']=[{'instrument':t['instrument'],'role':t['role']} for t in score['authored']['arrangement']]
    (path/'arrangement.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    print('ARRANGEMENT_READY '+music['style'],flush=True)

if __name__=='__main__':render(Path(sys.argv[1]))
