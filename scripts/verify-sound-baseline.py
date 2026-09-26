"""Verify published PCM and estimate note centres from the actual dry waveform.

Pitch estimates are diagnostics, never a musicality or human approval score.
"""
import hashlib
import json
from pathlib import Path
import numpy as np
import soundfile as sf
import librosa

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist/sound-baseline-v1'
manifest=json.loads((OUT/'manifest.json').read_text(encoding='utf8'))
result={'qualityAssessment':'awaiting-user-listening','files':{},'pitchDiagnostics':[],
        'limits':'pYIN 对干声的音高估计会受辅音、滑音与泛音影响。偏差只用于排查执行问题，不是好听程度或专业演唱评分。'}
for name,digest in manifest['files'].items():
    path=OUT/name
    assert hashlib.sha256(path.read_bytes()).hexdigest()==digest
    if path.suffix=='.wav':
        x,sr=sf.read(path,always_2d=True)
        assert sr==44100 and np.isfinite(x).all() and 0<np.max(np.abs(x))<.99
        result['files'][name]={'duration':len(x)/sr,'peak':float(np.max(np.abs(x))),'sha256':digest}
mix,sr=sf.read(OUT/'original-mix.wav',always_2d=True)
vocal,_=sf.read(OUT/'original-vocal.wav',always_2d=True)
backing,_=sf.read(OUT/'original-accompaniment.wav',always_2d=True)
error=float(np.max(np.abs((mix-backing)-vocal)))
assert error<=3*2**-23
result['mixMinusBackingVsDryMaxError']=error
for name,scorefile in [('reference-low','reference-low-score.json'),('reference-high','reference-high-score.json'),('original','score.json')]:
    score=json.loads((OUT/scorefile).read_text(encoding='utf8'))
    audio,rate=sf.read(OUT/(name+'-vocal.wav'))
    audio=librosa.resample(audio,orig_sr=rate,target_sr=16000)
    f0,flag,prob=librosa.pyin(audio,sr=16000,fmin=librosa.note_to_hz('C3'),fmax=librosa.note_to_hz('E6'),frame_length=1024,hop_length=160)
    times=librosa.times_like(f0,sr=16000,hop_length=160)
    rows=[]
    for phrase in score['phrases']:
        for syllable in phrase['syllables']:
            cursor=syllable['beat']*60/score['bpm']
            for midi,beats in syllable['notes']:
                length=beats*60/score['bpm']
                valid=(times>=cursor+length*.25)&(times<cursor+length*.8)&flag&np.isfinite(f0)&(prob>.5)
                row={'lyric':syllable['lyric'],'expectedMidi':midi,'start':cursor,'duration':length,'reliableFrames':int(valid.sum())}
                if valid.sum()>=3:
                    row['medianMidi']=float(np.median(librosa.hz_to_midi(f0[valid])))
                    row['centsDeviation']=round((row['medianMidi']-midi)*100,1)
                rows.append(row);cursor+=length
    cents=[abs(r['centsDeviation']) for r in rows if 'centsDeviation' in r]
    record={'name':name,'notesMeasured':len(cents),'notesTotal':len(rows),'medianAbsoluteCents':round(float(np.median(cents)),1) if cents else None,'notes':rows}
    result['pitchDiagnostics'].append(record)
    print(json.dumps({k:v for k,v in record.items() if k!='notes'}),flush=True)
(ROOT/'validation/sound-baseline-waveform.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print('Waveform checks complete; musical quality awaits listening.',flush=True)
