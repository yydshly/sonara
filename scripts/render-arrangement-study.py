"""Render three local sampled-instrument sketches against one unchanged vocal."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import soundfile as sf

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'dist/youth-song'
OUT=SOURCE/'arrangement-study-v1'
WORK=ROOT/'.local/arrangement-study-v1'
TOOLS=ROOT/'.local/arrangement-tools'
FFMPEG=Path(r'D:\26project\26audio_and_video_project\ffmpeg-n6.1.3-win64-gpl-shared-6.1\bin\ffmpeg.exe')
spec=importlib.util.spec_from_file_location('styles',ROOT/'scripts/arrangement-styles.py')
styles=importlib.util.module_from_spec(spec);spec.loader.exec_module(styles)


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def execute(args):
    return subprocess.run([str(a) for a in args],check=True,capture_output=True,
                          creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0,timeout=180)


def run():
    began=time.time();OUT.mkdir(parents=True,exist_ok=True);WORK.mkdir(parents=True,exist_ok=True)
    score=json.loads((SOURCE/'score.json').read_text(encoding='utf-8'))
    section=next(s for s in score['sections'] if s['id']=='chorus1')
    source_names=['score.json','song.wav','accompaniment.wav','vocal-alignment-v1/song.wav','vocal-alignment-v1/vocal.wav']
    source_hashes={name:digest(SOURCE/name) for name in source_names}
    sr=score['sampleRate'];first,last=round(section['start']*sr),round(section['end']*sr)
    chords=[h['symbol'] for h in score['harmony'] if h['section']==section['id']]
    assert len(chords)==8
    exe=next(TOOLS.glob('fluidsynth-2.6.1/**/fluidsynth.exe'));bank=TOOLS/'GeneralUser-GS.sf2'
    if digest(bank)!='9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe':
        raise ValueError('Unexpected sound bank; review before rendering')
    def render(style):
        path=OUT/style;path.mkdir(exist_ok=True)
        tracks=styles.arrange(chords,style)
        (path/'arrangement.mid').write_bytes(styles.midi(tracks,score['bpm'],len(chords)))
        (path/'arrangement.json').write_text(json.dumps({'bpm':score['bpm'],'chords':chords,'tracks':tracks,'method':'authored arrangement sketch'},ensure_ascii=False,indent=2),encoding='utf-8')
        raw=WORK/(style+'.wav')
        proc=execute([exe,'-ni','-r',sr,'-g','.6','-R','0','-C','0','-T','wav','-O','float','-F',raw,bank,path/'arrangement.mid'])
        (WORK/(style+'.log')).write_bytes(proc.stdout+proc.stderr)
        audio,rate=sf.read(raw,dtype='float64',always_2d=True)
        if rate!=sr or len(audio)<last-first or audio.shape[1]!=2 or not np.isfinite(audio).all():raise ValueError('Invalid render')
        audio=audio[:last-first]
        sf.write(raw,audio,sr,subtype='FLOAT')
        measure=execute([FFMPEG,'-hide_banner','-i',raw,'-af','loudnorm=I=-25:TP=-2:LRA=11:print_format=json','-f','null','-'])
        info=json.loads(re.findall(r'\{[^{}]+\}',measure.stderr.decode('utf-8',errors='replace'))[-1])
        loudness=float(info['input_i']);peak=float(np.max(np.abs(audio)))
        if not np.isfinite(loudness) or peak<.001:raise ValueError('Silent or invalid backing')
        print('STYLE_RENDERED '+style,flush=True)
        return style,audio,loudness,peak,tracks
    with ThreadPoolExecutor(max_workers=3) as pool:rendered=list(pool.map(render,styles.STYLES))
    # One loudness target for all backings, bounded by the same peak budget.
    target=min(-25.,min(loud+20*np.log10(.34/peak) for _,_,loud,peak,_ in rendered))
    base_song,rate=sf.read(SOURCE/'vocal-alignment-v1/song.wav',dtype='float64',always_2d=True)
    base_back,back_rate=sf.read(SOURCE/'accompaniment.wav',dtype='float64',always_2d=True)
    assert rate==back_rate==sr and base_song.shape==base_back.shape
    envelope=np.ones(last-first);fade=round(.02*sr)
    envelope[:fade]=np.linspace(0,1,fade);envelope[-fade:]=np.linspace(1,0,fade)
    entries=[]
    for style,audio,loudness,peak,tracks in rendered:
        path=OUT/style;gain=10**((target-loudness)/20)
        backing=base_back.copy()
        backing[first:last]=audio*gain*envelope[:,None]+base_back[first:last]*(1-envelope[:,None])
        song=base_song+(backing-base_back)
        if not np.isfinite(song).all() or np.max(np.abs(song))>=.99:raise ValueError('Mix exceeds headroom')
        for name,data,before in [('song',song,base_song),('accompaniment',backing,base_back)]:
            sf.write(path/(name+'.wav'),data,sr,subtype='PCM_24')
            actual,_=sf.read(path/(name+'.wav'),dtype='float64',always_2d=True)
            assert np.array_equal(actual[:first],before[:first]) and np.array_equal(actual[last:],before[last:])
            sf.write(path/(name+'-clip.wav'),actual[first:last],sr,subtype='PCM_24')
        exported_song,_=sf.read(path/'song.wav',dtype='float64',always_2d=True)
        exported_back,_=sf.read(path/'accompaniment.wav',dtype='float64',always_2d=True)
        voice_error=float(np.max(np.abs((exported_song-exported_back)-(base_song-base_back))))
        assert voice_error<=2/(2**23)
        entries.append({'id':style,**styles.STYLES[style],'start':first/sr,'end':last/sr,
            'matchedBackingLufs':target,'originalBackingLufs':loudness,'backingGain':gain,
            'peak':float(np.max(np.abs(song))),'vocalResidualError':voice_error,
            'outsideRegionUnchanged':True,'vocalPreserved':True,
            'noteEvents':sum(len(t['notes']) for t in tracks.values()),
            'files':{p.name:digest(p) for p in path.iterdir() if p.is_file()}})
    assert source_hashes=={name:digest(SOURCE/name) for name in source_names}
    (OUT/'GeneralUser-GS-LICENSE.txt').write_bytes((TOOLS/'GeneralUser-GS-LICENSE.txt').read_bytes())
    result={'status':'rendered','id':'arrangement-study-v1','assessment':'unreviewed',
            'sourceHashes':source_hashes,'sourceVocal':'S1 咬字校正 · 首段副歌',
            'bpm':score['bpm'],'sampleRate':sr,'duration':score['duration'],
            'engine':'FluidSynth 2.6.1','soundBank':'GeneralUser GS 2.0.3 · S. Christian Collins',
            'soundBankHash':digest(bank),'arrangements':entries,'renderSeconds':round(time.time()-began,2)}
    (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'status':result['status'],'renderSeconds':result['renderSeconds'],'targetLufs':target,'styles':[e['id'] for e in entries]}),flush=True)


if __name__=='__main__':run()
