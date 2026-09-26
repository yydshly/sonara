"""Check the produced files, not subjective musical quality or user acceptance."""
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
import soundfile as sf


def inspect(path):
    score = json.loads((path/'score.json').read_text(encoding='utf-8'))
    assert score['format'] == 'expressive-v1'
    arrangement = json.loads((path/'arrangement.json').read_text(encoding='utf-8'))
    assert arrangement['tracks'] == score['arrangementTracks']
    files = {}
    audio = {}
    for name in ['song', 'vocal', 'accompaniment', 'guide']:
        file = path/(name+'.wav')
        samples, rate = sf.read(file, dtype='float64', always_2d=True)
        assert rate == score['sampleRate'] and len(samples) == round(score['duration']*rate)
        assert sf.info(file).subtype == 'PCM_24'
        assert np.isfinite(samples).all() and 0 < np.max(np.abs(samples)) < .99
        files[name] = {'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'peak': float(np.max(np.abs(samples)))}
        audio[name] = samples
    audits = []
    for i, phrase in enumerate(score['phrases']):
        ds = json.loads((path/'phrases'/f'{i+1}.ds').read_text(encoding='utf-8'))[0]
        # Reused phrases may predate control audit copying; source audit can be
        # followed through revision metadata while cache audio stays immutable.
        audit_path = path/'phrases'/f'{i+1}.expression.json'
        if not audit_path.exists():
            revision = json.loads((path/'revision.json').read_text(encoding='utf-8'))
            audit_path = Path(revision['basePath'])/'phrases'/f'{i+1}.expression.json'
        audit = json.loads(audit_path.read_text(encoding='utf-8'))
        assert audit['acousticInputsVerified'] is True
        assert sum(int(v) for v in ds['note_slur'].split()) == sum(n['continuation'] for n in phrase['notes'])
        assert abs(sum(float(v) for v in ds['note_dur'].split()) - (phrase['end']-phrase['start'])) < 1e-5
        audits.append({'phrase': i+1, 'syllables': len(phrase['syllables']), 'notes': len(phrase['notes']), 'acousticInputsVerified': True})
    return score, audio, {'id': path.name, 'title': score['title'], 'duration': score['duration'], 'files': files, 'phrases': audits, 'arrangementMatchesModelNotes': True, 'listeningAssessment': 'pending user judgment'}


if __name__ == '__main__':
    base_path, next_path, output = map(Path, sys.argv[1:4])
    base, before, a = inspect(base_path)
    next_score, after, b = inspect(next_path)
    job = json.loads((next_path/'job.json').read_text(encoding='utf-8'))
    region = job['difference']['region']
    start, end = (round(region[k]*base['sampleRate']) for k in ['start', 'end'])
    assert (base_path/'accompaniment.wav').read_bytes() == (next_path/'accompaniment.wav').read_bytes()
    for name in ['song', 'vocal']:
        assert np.array_equal(before[name][:start], after[name][:start])
        assert np.array_equal(before[name][end:], after[name][end:])
        assert np.any(before[name][start:end] != after[name][start:end])
    index = job['revision']['lineIndex']
    for i in range(4):
        if i != index:
            assert base['phrases'][i] == next_score['phrases'][i]
        elif job['revision']['mode'] == 'performance':
            assert base['phrases'][i]['notes'] == next_score['phrases'][i]['notes']
            old_ds = json.loads((base_path/'phrases'/f'{i+1}.ds').read_text(encoding='utf-8'))[0]
            new_ds = json.loads((next_path/'phrases'/f'{i+1}.ds').read_text(encoding='utf-8'))[0]
            assert old_ds['f0_seq'] == new_ds['f0_seq']
            assert all(old_ds.get(k) == new_ds.get(k) for k in old_ds if k not in ['breathiness','velocity'])
            assert old_ds['breathiness'] != new_ds['breathiness'] and old_ds['velocity'] != new_ds['velocity']
    report = {'versions':[a,b], 'revision': {'region':region, 'outsideRegionPcmIdentical':True, 'selectedRegionChanged':True, 'backingFileIdentical':True, 'performancePitchCurveIdentical':job['revision']['mode']=='performance'}, 'assessment':'Technical checks only; no human preference or quality score inferred.'}
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'checked':2,'outsideRegionPcmIdentical':True,'actualSingerControlsVerified':True,'output':str(output)},ensure_ascii=False))
