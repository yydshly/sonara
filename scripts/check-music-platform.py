"""Validate real generated style artifacts; does not assign listening scores."""
import hashlib
import json
from pathlib import Path
import numpy as np
import soundfile as sf

ROOT=Path(__file__).resolve().parents[1]
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
record=read(ROOT/'validation/music-style-run.json')
jobs={key:ROOT/'.local/compositions'/id for key,id in record['jobs'].items()}
assert set(jobs)=={'folk','retro','rock','ballad','reuse','ria'}
base=read(jobs['rock']/'score.json')
content=lambda s:[(p['lyrics'],p['chords'],[(n['midi'],n['beats'],n['beat'],n['pinyin']) for n in p['notes']]) for p in s['phrases']]
report=[]
for key,path in jobs.items():
    job=read(path/'job.json');score=read(path/'score.json');arr=read(path/'arrangement.json')
    assert job['state']=='succeeded' and content(score)==content(base)
    assert arr['style']==job['music']['style'] and arr['bpm']==score['bpm']
    midi=(path/'arrangement.mid').read_bytes();tempo=round(60_000_000/score['bpm'])
    assert b'\xff\x51\x03'+tempo.to_bytes(3,'big') in midi
    waves={}
    for name in ['song','vocal','accompaniment','guide']:
        wav,rate=sf.read(path/(name+'.wav'),dtype='float64',always_2d=True)
        assert rate==44100 and sf.info(path/(name+'.wav')).subtype=='PCM_24'
        assert len(wav)==round(score['duration']*rate) and np.isfinite(wav).all()
        assert .001<np.max(np.abs(wav))<.98
        waves[name]=wav
    assert np.max(np.abs(waves['song']-waves['vocal']-waves['accompaniment']))<=2/2**23
    for i,p in enumerate(score['phrases']):
        ds=read(path/'phrases'/f'{i+1}.ds')[0]
        assert ds['note_seq']==' '.join(['rest']+[n['pitch'] for n in p['notes']]+['rest'])
        assert ds['phonemeAlignment']=='vowel-onset-v1'
        durations=np.fromstring(ds['ph_dur'],sep=' ');counts=np.fromstring(ds['ph_num'],sep=' ',dtype=int)
        onsets=np.cumsum(np.r_[0,durations])[np.cumsum(counts)[:-1]]
        assert np.allclose(onsets[:-1],[n['start']-p['start'] for n in p['notes']],atol=1e-6,rtol=0)
        assert abs(durations.sum()-(p['end']-p['start']))<1e-6
    if key not in ['reuse','ria']:assert '0101_qixuan_muon1_acoustic.qixuan.onnx' in (path/'sing-log.txt').read_text(encoding='utf-8')
    report.append({'direction':key,'bpm':score['bpm'],'duration':score['duration'],'voice':job['result']['voice'],'samplePeak':float(np.max(np.abs(waves['song']))),'renderSeconds':job['result']['renderSeconds'],'alignedSyllables':sum(len(p['notes']) for p in score['phrases']),'tracks':list(arr['tracks']),'songHash':sha(path/'song.wav')})
assert sha(jobs['rock']/'vocal.wav')==sha(jobs['reuse']/'vocal.wav')
assert sha(jobs['rock']/'vocal.wav')!=sha(jobs['ria']/'vocal.wav')
assert len({sha(jobs[k]/'arrangement.mid') for k in ['folk','retro','rock','ballad']})==4
assert sha(ROOT/'dist/youth-song/song.wav')=='e59722964fe4101988ae8eea5c061148cd666698cea5a1459de2462ac83c2fe4'
assert sha(ROOT/'dist/youth-song/score.json')=='f3f87758d6329cdf91589769d2a908c2d42c9524698f45613e74132e656513b1'
manifest=read(ROOT/'dist/style-demos/manifest.json')
for v in manifest['versions']:assert v['hash']==sha(ROOT/'dist'/v['audio'].lstrip('/'))
output={'passed':True,'assessment':'Technical checks only; listening quality remains unreviewed','originalFullSongPreserved':True,'styleOnlyVocalIdentical':True,'versions':report}
(ROOT/'validation/music-style-audio-check.json').write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(output,ensure_ascii=False,indent=2))
