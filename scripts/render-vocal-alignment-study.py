"""Re-sing the first chorus with corrected phone alignment, preserving V1.

Publishes a separate comparison only after verifying unchanged score, backing,
and all samples outside the selected region. It does not rate musical quality.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import time
import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT/'dist/youth-song'
OUTPUT = SOURCE/'vocal-alignment-v1'
CACHE = ROOT/'.local/vocal-alignment-v1'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run():
    began = time.time()
    score = json.loads((SOURCE/'score.json').read_text(encoding='utf-8'))
    protected = ['song.wav','song.mp3','vocal.wav','vocal.mp3','accompaniment.wav',
                 'score.json','lyrics.txt','melody.mid']
    source_hashes = {name:digest(SOURCE/name) for name in protected}
    phrases = [p for p in score['phrases'] if p['section'] == 'chorus1']
    assert len(phrases) == 4
    first, last = round(phrases[0]['start']*score['sampleRate']), round(phrases[-1]['end']*score['sampleRate'])
    original, sr = sf.read(SOURCE/'vocal.wav', dtype='float64', always_2d=True)
    song, rate = sf.read(SOURCE/'song.wav', dtype='float64', always_2d=True)
    assert rate == sr == score['sampleRate']
    vocal = original.copy()
    singer = load_module('singer','render-score-trial.py')
    mixing = load_module('mixing','render-phrasing.py')
    evidence = []
    for p in phrases:
        local = json.loads(json.dumps(p))
        for n in local['notes']:
            n['start'] -= p['start']
        local['end'] -= p['start']
        local['start'] = 0
        print('ALIGNMENT_PHRASE '+str(p['index']), flush=True)
        raw, ds = singer.render_phrase(local, 'A', cache_dir=CACHE, cache_key=str(p['index']))
        a, b = round(p['start']*sr), round(p['end']*sr)
        changed = np.zeros(b-a)
        changed[:min(len(raw),b-a)] = raw[:b-a]
        original_rms = float(np.sqrt(np.mean(original[a:b]**2)))
        gain = min(original_rms/max(float(np.sqrt(np.mean(changed**2))),1e-8),
                   .59/max(float(np.max(np.abs(changed))),1e-8))
        vocal[a:b] = (changed*gain)[:,None]
        counts = list(map(int,ds['ph_num'].split()))
        durations = np.fromstring(ds['ph_dur'],sep=' ')
        phones = ds['ph_seq'].split()
        offset = counts[0]
        note_evidence = []
        for n, count in zip(local['notes'], counts[1:-1]):
            onset = float(durations[:offset].sum())
            assert abs(onset-n['start']) < 1e-6
            note_evidence.append({'lyric':n['lyric'],'pitch':n['pitch'],
                'scoreOnset':n['start'],'alignedOnset':onset,
                'phones':phones[offset:offset+count],
                'durations':durations[offset:offset+count].tolist()})
            offset += count
        expected_notes = ' '.join(['rest']+[n['pitch'] for n in local['notes']]+['rest'])
        assert ds['note_seq'] == expected_notes
        assert abs(durations.sum()-(local['end']-local['start'])) < 1e-6
        evidence.append({'index':p['index'],'lyrics':p['lyrics'],'notes':note_evidence,
            'relativeRmsDb':20*np.log10(float(np.sqrt(np.mean(vocal[a:b]**2)))/original_rms)})
    mixed = song.copy()
    delta = mixing.room(vocal,sr)-mixing.room(original,sr)
    envelope = np.ones(last-first)
    fade = round(.012*sr)
    envelope[:fade] = np.linspace(0,1,fade)
    envelope[-fade:] = np.linspace(1,0,fade)
    mixed[first:last] += delta[first:last]*envelope[:,None]
    assert np.isfinite(mixed).all() and np.max(np.abs(mixed)) < .99
    OUTPUT.mkdir(parents=True,exist_ok=True)
    for name, audio, before in [('song',mixed,song),('vocal',vocal,original)]:
        path = OUTPUT/(name+'.wav')
        sf.write(path,audio,sr,subtype='PCM_24')
        actual,_ = sf.read(path,dtype='float64',always_2d=True)
        assert np.array_equal(actual[:first],before[:first])
        assert np.array_equal(actual[last:],before[last:])
        assert not np.array_equal(actual[first:last],before[first:last])
        sf.write(OUTPUT/(name+'-A.wav'),before[first:last],sr,subtype='PCM_24')
        sf.write(OUTPUT/(name+'-B.wav'),actual[first:last],sr,subtype='PCM_24')
    assert source_hashes == {name:digest(SOURCE/name) for name in protected}
    result = {'id':'vocal-alignment-v1','label':'S1 咬字校正 · 首段副歌',
        'status':'rendered','assessment':'unreviewed','voice':'Ria / 狸安（RibosomeK）',
        'policy':singer.alignment.ALIGNMENT_POLICY,'start':first/sr,'end':last/sr,
        'scoreAndLyricsUnchanged':True,'backingUnchanged':True,'outsideRegionUnchanged':True,
        'sourceHashes':source_hashes,'renderSeconds':round(time.time()-began,2),
        'evidence':evidence,'files':{p.name:digest(p) for p in OUTPUT.glob('*.wav')}}
    (OUTPUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:result[k] for k in ['status','start','end','renderSeconds']},ensure_ascii=False),flush=True)


if __name__ == '__main__':
    run()
