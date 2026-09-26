"""A short, isolated listening study; never modifies a saved song or its defaults."""
import importlib.util
import json
import hashlib
import subprocess
import time
from pathlib import Path
import numpy as np
import soundfile as sf

root = Path(__file__).resolve().parents[1]
source = root / '.local/compositions/43555959-01b9-4785-bf61-f5b7f38206ec'
out = root / 'validation/product-reset/voice'
out.mkdir(parents=True, exist_ok=True)
score = json.loads((source / 'score.json').read_text(encoding='utf8'))
original, sr = sf.read(source / 'vocal.wav', dtype='float64')
backing, _ = sf.read(source / 'accompaniment.wav', dtype='float64', always_2d=True)
start, end = 0, round(score['phrases'][1]['end'] * sr)
old = original[start:end]
backing = backing[start:end]
changed = old.copy()
spec = importlib.util.spec_from_file_location('singer', root / 'scripts/render-score-trial.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)
began = time.time()
evidence = []
for phrase in score['phrases'][:2]:
    ds = json.loads((source / 'phrases' / f"{phrase['index']+1}.ds").read_text(encoding='utf8'))[0]
    keep_pitch, keep_dur = ds['f0_seq'], ds['ph_dur']
    v = np.fromstring(ds['voicing'], sep=' ')
    # Mild changes in supported dB controls, only in voiced frames.
    for name, offset in [('tension', -1.5), ('breathiness', 1.5)]:
        values = np.fromstring(ds[name], sep=' ')
        values[v > -55] += offset
        ds[name] = ' '.join(f'{x:.6f}' for x in values)
    ds['velocity'] = ' '.join(['1.08'] * len(v))
    ds['velocity_timestep'] = ds['voicing_timestep']
    parsed = engine.DSReader.DSSection(ds)
    mel = engine.predictor.pred_acoustic.predict(parsed, lang='zh', speaker=engine.speaker, steps=50, gender=0)
    inputs = engine.predictor.pred_acoustic._prepare_inputs(parsed, lang='zh', speaker=engine.speaker, gender=0)
    assert all(name in inputs for name in ['tension', 'breathiness', 'velocity'])
    f0 = engine.resample_align_curve(np.fromstring(ds['f0_seq'], sep=' ', dtype=np.float32), float(ds['f0_timestep']), engine.predictor.pred_vocoder.timestep, mel.shape[1])
    raw = np.asarray(engine.predictor.pred_vocoder.predict(mel, f0)).reshape(-1)
    a, b = round(phrase['start']*sr), round(phrase['end']*sr)
    sound = np.zeros(b-a, dtype='float64')
    sound[:min(len(sound),len(raw))] = raw[:len(sound)]
    fade = round(.012*sr)
    sound[:fade] *= np.linspace(0,1,fade)
    sound[-fade:] *= np.linspace(1,0,fade)
    target = np.sqrt(np.mean(old[a:b]**2))
    sound *= target / max(np.sqrt(np.mean(sound**2)), 1e-8)
    assert np.isfinite(sound).all() and .001 < np.max(np.abs(sound)) < .98
    changed[a:b] = sound
    assert ds['f0_seq'] == keep_pitch and ds['ph_dur'] == keep_dur
    (out / f"candidate-{phrase['index']+1}.ds").write_text(json.dumps([ds],ensure_ascii=False),encoding='utf8')
    evidence.append({'phrase':phrase['index'],'pitchCurvePreserved':True,'phonemeDurationsPreserved':True,'rmsDifference':float(np.sqrt(np.mean((sound-old[a:b])**2)))})

# Identical accompaniment and a shared headroom gain; avoid louder-wins comparisons.
mix_a = backing + old[:,None]
mix_c = backing + changed[:,None]
gain = min(1, .95 / max(float(np.max(np.abs(mix_a))),float(np.max(np.abs(mix_c)))))
sf.write(out/'A-original.wav',mix_a*gain,sr,subtype='PCM_24')
sf.write(out/'C-relaxed.wav',mix_c*gain,sr,subtype='PCM_24')
ffmpeg = Path('D:/26project/26audio_and_video_project/ffmpeg-n6.1.3-win64-gpl-shared-6.1/bin/ffmpeg.exe')
subprocess.run([str(ffmpeg),'-y','-v','error','-i',str(out/'A-original.wav'),'-af','atempo=1.125','-c:a','pcm_s24le',str(out/'B-faster.wav')],check=True)
result={'sourceJob':source.name,'sourceSongHash':hashlib.sha256((source/'song.wav').read_bytes()).hexdigest(),'lyrics':score['lyrics'][:2],'bpm':score['bpm'],'seconds':end/sr,'candidateRenderSeconds':round(time.time()-began,2),'variants':{'A':'Original tempo and original voice','B':'Tempo-only preview at 1.125x using FFmpeg atempo; score unchanged','C':'Original tempo, new acoustic inference: tension -1.5 dB, breathiness +1.5 dB on voiced frames; velocity 1.08'},'phrases':evidence,'quality':'unreviewed','voice':'Ria / 狸安, RibosomeK; existing noncommercial vocoder','files':{name:{'sha256':hashlib.sha256((out/name).read_bytes()).hexdigest(),'seconds':sf.info(out/name).duration} for name in ['A-original.wav','B-faster.wav','C-relaxed.wav']}}
(out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(result,ensure_ascii=False),flush=True)
