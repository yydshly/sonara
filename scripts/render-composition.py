"""Validate / sing a private score with its selected installed voice."""
import importlib.util
import json
import hashlib
import shutil
import sys
import time
from pathlib import Path
import numpy as np
import soundfile as sf
import yaml

root = Path(__file__).resolve().parents[1]
path = Path(sys.argv[1])
mode = sys.argv[2]
score = json.loads((path/'score.json').read_text(encoding='utf-8'))
profile_spec = importlib.util.spec_from_file_location('singer_profile', root/'scripts/local-singer-profile.py')
profiles = importlib.util.module_from_spec(profile_spec)
profile_spec.loader.exec_module(profiles)
voice = score.get('music', {}).get('voice', 'ria')
voice_info = profiles.profile(voice)
dictionary = profiles.dictionary(voice)
allowed = {item['grapheme'] for item in dictionary['entries']}
for phrase in score['phrases']:
    for note in phrase['notes']:
        if note['pinyin'] not in allowed:
            raise ValueError('Unsupported voicebank pronunciation: '+note['pinyin'])
if mode == 'check':
    print('Pronunciation checked', flush=True)
    sys.exit(0)
if mode != 'sing':
    raise ValueError('Unknown mode')

started = time.time()
arrangement_file = path/'rearrangement.json'
arrangement = json.loads(arrangement_file.read_text(encoding='utf-8')) if arrangement_file.exists() else None
reuse_vocal = bool(arrangement and arrangement['reuseVocal'])
if not reuse_vocal:
    spec = importlib.util.spec_from_file_location('engine', root/'scripts/render-score-trial.py')
    engine = importlib.util.module_from_spec(spec)
    engine.bank_override = voice_info['bank']
    spec.loader.exec_module(engine)
    profiles.configure(engine, voice)
sr = score['sampleRate']
length = round(score['duration']*sr)
revision_file = path/'revision.json'
revision = json.loads(revision_file.read_text(encoding='utf-8')) if revision_file.exists() else None
backing, backing_sr = sf.read(path/'accompaniment.wav', dtype='float64', always_2d=True)
assert backing_sr == sr and len(backing) == length
preservation = {}
def sing_phrase(phrase, keep_pitch=None, performance_source=None):
    kwargs={}
    if score.get('format')=='expressive-v1':
        prepared, _ = engine.performance.compile_phrase(phrase, score['bpm'], engine.entries, engine.symbol_types, engine.alignment.align_groups)
        controls={key:[phrase['syllables'][n['syllable']][key] for n in phrase['notes']] for key in ['breathinessDb','velocity']}
        kwargs={'prepared_ds':prepared,'controls':controls}
    return engine.render_phrase(phrase, 'A', preserved_pitch=keep_pitch, performance_source=performance_source, cache_dir=path/'phrases', cache_key=str(phrase['index']+1), **kwargs)

def copy_phrase_cache(source, index):
    for ext in ['wav', 'ds', 'sha256']:
        shutil.copyfile(source/'phrases'/f'{index+1}.{ext}', path/'phrases'/f'{index+1}.{ext}')
    if score.get('format')=='expressive-v1':
        visited=set()
        while not (source/'phrases'/f'{index+1}.expression.json').exists():
            if source in visited:
                raise ValueError('Cyclic expression provenance')
            visited.add(source)
            parent=json.loads((source/'revision.json').read_text(encoding='utf-8'))
            source=Path(parent['basePath'])
        shutil.copyfile(source/'phrases'/f'{index+1}.expression.json',path/'phrases'/f'{index+1}.expression.json')
if arrangement:
    base_path = Path(arrangement['basePath'])
    assert hashlib.sha256((base_path/'score.json').read_bytes()).hexdigest() == arrangement['sourceFileHash'], 'Source score changed since proposal'
    base_score = json.loads((base_path/'score.json').read_text(encoding='utf-8'))
    def content(s):
        return [(p['lyrics'], p['chords'], [(n['midi'], n['beats'], n['pinyin'], n.get('restAfter',0)) for n in p['notes']]) for p in s['phrases']]
    assert content(base_score) == content(score), 'Rearrangement changed score content'
    preservation = {'reusedVocal': reuse_vocal, 'scoreNotesPreserved': True}
if reuse_vocal:
    assert base_score['bpm'] == score['bpm'] and base_score.get('music', {}).get('voice', 'ria') == voice
    vocal, base_sr = sf.read(base_path/'vocal.wav', dtype='float64')
    assert base_sr == sr and len(vocal) == length
    (path/'phrases').mkdir(exist_ok=True)
    for i in range(4):
        copy_phrase_cache(base_path, i)
    mix = backing + vocal[:, None]
elif revision:
    base_path = Path(revision['basePath'])
    phrase = score['phrases'][revision['lineIndex']]
    start, end = round(phrase['start']*sr), round(phrase['end']*sr)
    base_vocal, base_sr = sf.read(base_path/'vocal.wav', dtype='float64')
    base_mix, mix_sr = sf.read(base_path/'song.wav', dtype='float64', always_2d=True)
    assert base_sr == mix_sr == sr and len(base_vocal) == len(base_mix) == length
    vocal, mix = base_vocal.copy(), base_mix.copy()
    (path/'phrases').mkdir(exist_ok=True)
    for i in range(4):
        if i != revision['lineIndex']:
            copy_phrase_cache(base_path, i)
    original_ds = json.loads((base_path/'phrases'/f"{phrase['index']+1}.ds").read_text(encoding='utf-8'))[0]
    keep_pitch = original_ds if revision['mode'] in ['lyrics','performance'] else None
    performance_source = None
    if revision['mode'] == 'performance':
        performance_source = dict(original_ds)
        base_score = json.loads((base_path/'score.json').read_text(encoding='utf-8'))
        old_phrase = base_score['phrases'][revision['lineIndex']]
        old_controls = {key:[old_phrase['syllables'][n['syllable']][key] for n in old_phrase['notes']] for key in ['breathinessDb','velocity']}
        engine.performance.remove_controls(performance_source, old_phrase, old_controls)
    wav, ds = sing_phrase(phrase, keep_pitch, performance_source)
    changed = np.zeros(end-start, np.float64)
    changed[:min(len(wav),len(changed))] = wav[:len(changed)]
    original_rms = float(np.sqrt(np.mean(base_vocal[start:end]**2)))
    changed_rms = float(np.sqrt(np.mean(changed**2)))
    gain = min(original_rms/max(changed_rms,1e-8), .62/max(float(np.max(np.abs(changed))),1e-8))
    changed *= gain
    vocal[start:end] = changed
    mix[start:end] = backing[start:end]+changed[:,None]
    if keep_pitch:
        assert ds['f0_seq'] == original_ds['f0_seq'] and ds['f0_timestep'] == original_ds['f0_timestep']
    if performance_source:
        assert all(ds.get(k) == original_ds.get(k) for k in original_ds if k not in ['breathiness','velocity'])
    preservation = {'changedRegion':{'start':phrase['start'],'end':phrase['end']}, 'unchangedOutsideRegion':True, 'identicalPitchControl':bool(keep_pitch), 'reusedPhrases':3}
    if performance_source:
        preservation['otherPerformanceCurvesPreserved'] = True
else:
    vocal = np.zeros(length, np.float64)
    for phrase in score['phrases']:
        print('SONARA_PROGRESS '+json.dumps({'message':f"正在演唱第 {phrase['index']+1} / 4 句"}, ensure_ascii=False), flush=True)
        wav, ds = sing_phrase(phrase)
        start = round(phrase['start']*sr)
        vocal[start:start+len(wav)] = wav
    vocal *= .62/max(float(np.max(np.abs(vocal))), .01)
    mix = backing+vocal[:, None]
peak = float(np.max(np.abs(mix)))
if peak >= .98:
    if revision or reuse_vocal:
        raise RuntimeError('Revised phrase needs a gain adjustment; original audio retained')
    scale = .95/peak
    mix *= scale
    vocal *= scale
    peak = float(np.max(np.abs(mix)))
if not np.isfinite(mix).all() or peak < .001:
    raise RuntimeError('Invalid mixed audio')
sf.write(path/'song.wav', mix, sr, subtype='PCM_24')
sf.write(path/'vocal.wav', vocal, sr, subtype='PCM_24')
if revision:
    for name, base in [('song',base_mix), ('vocal',base_vocal)]:
        saved, _ = sf.read(path/(name+'.wav'), dtype='float64', always_2d=(name=='song'))
        assert np.array_equal(saved[:start],base[:start]) and np.array_equal(saved[end:],base[end:])
        assert np.any(saved[start:end]!=base[start:end])
if reuse_vocal:
    assert (path/'vocal.wav').read_bytes() == (base_path/'vocal.wav').read_bytes(), 'Original vocal was altered'
result = {'sampleRate':sr, 'duration':score['duration'], 'bitDepth':24, 'peak':peak, 'renderSeconds':round(time.time()-started,2), 'voice':voice_info['name'], 'voiceAuthor':voice_info['author'], **preservation, 'files':{name:hashlib.sha256((path/name).read_bytes()).hexdigest() for name in ['song.wav','vocal.wav']}}
(path/'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print('SONARA_PROGRESS '+json.dumps({'message':'演唱已完成，正在保存试听文件'}, ensure_ascii=False), flush=True)
