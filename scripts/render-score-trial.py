"""Render the original score and one lyric edit with the author's Ria voicebank.

All synthesis stays local. The second version reuses the original pitch curve
and three untouched vocal phrases. Voice credit: Ria / 狸安, RibosomeK.
"""
import hashlib
import importlib.util
import json
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf
import yaml

root = Path(__file__).resolve().parents[1]
work = root / '.local' / 'score-trial'
out = root / 'dist' / 'score-trial'
sys.path.insert(0, str(work / 'diffsinger_utau-master'))
from diffsinger_utau.voice_bank import PredAll
from diffsinger_utau.voice_bank.commons.ds_reader import DSReader
from diffsinger_utau.voice_bank.commons.voice_bank_reader import OnnxReader
from diffsinger_utau.voice_bank.commons.utils import resample_align_curve

# Avoid each of the seven ONNX sessions creating an entire CPU-sized thread pool.
def load_model(self, device='cpu'):
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    self.session = ort.InferenceSession(str(self.onnx_path), options, providers=['CPUExecutionProvider'])
    self.input_names = [i.name for i in self.session.get_inputs()]
    self.output_names = [i.name for i in self.session.get_outputs()]
    print(f'Loaded {self.onnx_path.name}: {self.input_names}', flush=True)
    return True

OnnxReader.load_model = load_model
original_predict = OnnxReader.predict
def predict(self, inputs):
    # Older DiffSinger exports use speedup rather than a diffusion step count.
    if 'speedup' in self.input_names and 'speedup' not in inputs:
        inputs = {**inputs, 'speedup': np.array(20, dtype=np.int64)}
    return original_predict(self, inputs)
OnnxReader.predict = predict

score = json.loads((out/'score.json').read_text(encoding='utf-8'))
bank = globals().get('bank_override') or next(path.parent for path in (work/'voicebank').rglob('dsconfig.yaml') if (path.parent/'dsdur').exists())
dictionary = yaml.load((bank/'dsdur'/'dsdict-zh.yaml').read_text(encoding='utf-8'), Loader=getattr(yaml, 'CSafeLoader', yaml.SafeLoader))
entries = {entry['grapheme']: entry['phonemes'] for entry in dictionary['entries']}
symbol_types = {item['symbol']: item['type'] for item in dictionary['symbols']}
alignment_spec = importlib.util.spec_from_file_location('phoneme_alignment', root/'scripts/phoneme-alignment.py')
alignment = importlib.util.module_from_spec(alignment_spec)
alignment_spec.loader.exec_module(alignment)
timing_spec = importlib.util.spec_from_file_location('phrase_timing', root/'scripts/phrase-timing.py')
timing = importlib.util.module_from_spec(timing_spec)
timing_spec.loader.exec_module(timing)
performance_spec = importlib.util.spec_from_file_location('performance_score', root/'scripts/performance-score.py')
performance = importlib.util.module_from_spec(performance_spec)
performance_spec.loader.exec_module(performance)
predictor = PredAll(bank)
speaker = predictor.available_speakers[0] if predictor.available_speakers else None
sample_rate = predictor.dsvocoder.sample_rate
assert sample_rate == score['sampleRate']
started = time.time()
cache = work/'rendered-phrases'
cache.mkdir(exist_ok=True)

def make_ds(phrase, version):
    notes = phrase['notes']
    phonemes, durations, pitches = timing.make_groups(phrase,version,entries,symbol_types,alignment.align_groups)
    return DSReader.DSSection({
        'offset': phrase['start'],
        'text': 'AP '+phrase['lyrics' if version=='A' else 'revisedLyrics']+' SP',
        'ph_seq': ' '.join(p for word in phonemes for p in word),
        'ph_num': ' '.join(str(len(word)) for word in phonemes),
        'note_seq': ' '.join(pitches),
        'note_dur': ' '.join(map(str,durations)),
        'note_slur': ' '.join(['0']*len(durations)),
        'phonemeAlignment': alignment.ALIGNMENT_POLICY,
    })

def render_phrase(phrase, version, preserved_pitch=None, cache_dir=None, cache_key=None, delivery=None, prepared_ds=None, controls=None, performance_source=None):
    label=cache_key or f'{version}-{phrase["index"]+1}'
    ds=DSReader.DSSection(performance_source if performance_source is not None else prepared_ds) if prepared_ds is not None else make_ds(phrase,version)
    fingerprint_data={"ds":dict(ds),"pitch":preserved_pitch}
    if 'voice_identity' in globals():
        fingerprint_data['voiceIdentity']=voice_identity
    if delivery is not None:
        fingerprint_data.update({'delivery': delivery, 'expressionPolicy': 'voiced-note-centres-linear-v1'})
    if controls is not None:
        fingerprint_data.update({'controls': controls, 'performancePolicy': performance.POLICY})
    fingerprint=hashlib.sha256(json.dumps(fingerprint_data,sort_keys=True).encode()).hexdigest()
    target_cache=Path(cache_dir) if cache_dir else cache
    target_cache.mkdir(parents=True,exist_ok=True)
    wav_path=target_cache/f'{label}.wav'; ds_path=target_cache/f'{label}.ds'; marker=target_cache/f'{label}.sha256'
    expression_path=target_cache/f'{label}.expression.json'
    if wav_path.exists() and ds_path.exists() and marker.exists() and marker.read_text()==fingerprint and (delivery is None and controls is None or expression_path.exists()):
        print(f'Reusing rendered phrase {label}',flush=True)
        return sf.read(wav_path,dtype='float32')[0],json.loads(ds_path.read_text(encoding='utf-8'))[0]
    print(f'Rendering {label}: {ds["text"]}',flush=True)
    if performance_source is None:
        durations=predictor.pred_duration.predict(ds,lang='zh',speaker=speaker)
        # Align vowel/glide onsets to beats; leading consonants prepare the next note.
        offset=0
        for count,target in zip(map(int,ds['ph_num'].split()),performance.word_durations(ds)):
            values=np.maximum(durations[offset:offset+count],.001)
            durations[offset:offset+count]=values*(target/values.sum())
            offset+=count
        ds['ph_dur']=' '.join(f'{v:.8f}' for v in durations)
        if preserved_pitch:
            ds['f0_seq']=preserved_pitch['f0_seq']; ds['f0_timestep']=preserved_pitch['f0_timestep']
        else:
            f0=predictor.pred_pitch.predict(ds,lang='zh',speaker=speaker,steps=20)
            ds['f0_seq']=' '.join(f'{v:.5f}' for v in f0)
            ds['f0_timestep']=str(predictor.pred_pitch.timestep)
        variances=predictor.pred_variance.predict(ds,lang='zh',speaker=speaker,steps=20,retake_all=True)
        for name,values in variances.items():
            ds[name]=' '.join(f'{v:.6f}' for v in values)
            ds[f'{name}_timestep']=str(predictor.pred_variance.timestep)
    if delivery is not None:
        module_spec=importlib.util.spec_from_file_location('voice_expression',root/'scripts/voice-expression.py')
        expression=importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(expression)
        audit=expression.apply_delivery(ds,phrase,delivery)
        inputs=predictor.pred_acoustic._prepare_inputs(ds,lang='zh',speaker=speaker,gender=0)
        if not all(name in inputs for name in ['breathiness','tension','velocity']):
            raise ValueError('Singer does not expose requested acoustic inputs')
        for name in ['breathiness','tension','velocity']:
            actual=np.asarray(inputs[name]).reshape(-1)
            expected=resample_align_curve(np.array(ds[name].split(),dtype=np.float32),float(ds[name+'_timestep']),predictor.pred_acoustic.timestep,len(actual))
            if not np.isfinite(actual).all() or not np.allclose(actual,expected,atol=1e-6,rtol=0):
                raise ValueError('Singer did not receive the approved expression curve: '+name)
        audit['acousticInputsVerified']=True
        expression_path.write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    if controls is not None:
        audit=performance.apply_controls(ds,phrase,controls,predictor.dsacoustic)
        actual=predictor.pred_acoustic._prepare_inputs(ds,lang='zh',speaker=speaker,gender=0)
        for name in ['breathiness','velocity']:
            received=np.asarray(actual[name]).reshape(-1)
            expected=resample_align_curve(np.array(ds[name].split(),dtype=np.float32),float(ds[name+'_timestep']),predictor.pred_acoustic.timestep,len(received))
            if not np.allclose(received,expected,atol=1e-6,rtol=0):
                raise ValueError('Performance controls did not reach singer')
        audit['acousticInputsVerified']=True
        expression_path.write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    mel=predictor.pred_acoustic.predict(ds,lang='zh',speaker=speaker,steps=50,gender=0)
    f0=resample_align_curve(np.array(ds['f0_seq'].split(),dtype=np.float32),float(ds['f0_timestep']),predictor.pred_vocoder.timestep,mel.shape[1])
    raw=np.asarray(predictor.pred_vocoder.predict(mel,f0)).reshape(-1)
    length=round((phrase['end']-phrase['start'])*sample_rate)
    wav=np.zeros(length,np.float32); wav[:min(length,len(raw))]=raw[:length]
    # Short boundary fades stay within the phrase, so other regions are untouched.
    fade=round(.012*sample_rate)
    wav[:fade]*=np.linspace(0,1,fade); wav[-fade:]*=np.linspace(1,0,fade)
    if not np.isfinite(wav).all() or np.max(np.abs(wav))<.001:
        raise RuntimeError(f'Invalid rendered audio: {label}')
    sf.write(wav_path,wav,sample_rate,subtype='FLOAT')
    ds_path.write_text(json.dumps([dict(ds)],ensure_ascii=False,indent=2),encoding='utf-8')
    marker.write_text(fingerprint)
    return wav,dict(ds)

def render_demo():
    original=[]; predictions=[]
    for phrase in score['phrases']:
        wav,ds=render_phrase(phrase,'A');original.append(wav);predictions.append(ds)
    changed,changed_ds=render_phrase(score['phrases'][1],'B',preserved_pitch=predictions[1])
    assert changed_ds['f0_seq']==predictions[1]['f0_seq']
    assert changed_ds['note_seq']==predictions[1]['note_seq']
    assert changed_ds['note_dur']==predictions[1]['note_dur']
    length=round(score['duration']*sample_rate)
    vocal_a=np.zeros(length,np.float32);vocal_b=np.zeros(length,np.float32)
    for i,phrase in enumerate(score['phrases']):
        start=round(phrase['start']*sample_rate);end=start+len(original[i])
        vocal_a[start:end]=original[i];vocal_b[start:end]=changed if i==1 else original[i]
    # One shared gain for both versions keeps comparisons meaningful.
    gain=.66/max(float(np.max(np.abs(vocal_a))),float(np.max(np.abs(vocal_b))),.01)
    vocal_a*=gain;vocal_b*=gain
    backing,sr=sf.read(out/'accompaniment.wav',dtype='float32',always_2d=True)
    assert sr==sample_rate and len(backing)==length
    mix_a=backing+vocal_a[:,None];mix_b=backing+vocal_b[:,None]
    peak=max(float(np.max(np.abs(mix_a))),float(np.max(np.abs(mix_b))))
    if peak>=.99:
        raise RuntimeError(f'Mix needs headroom adjustment: {peak}')
    start=round(score['phrases'][1]['start']*sample_rate);end=round(score['phrases'][1]['end']*sample_rate)
    assert np.array_equal(mix_a[:start],mix_b[:start]) and np.array_equal(mix_a[end:],mix_b[end:])
    assert np.any(mix_a[start:end]!=mix_b[start:end])
    for name,data in [('song-A',mix_a),('song-B',mix_b),('vocal-A',vocal_a),('vocal-B',vocal_b)]:
        sf.write(out/f'{name}.wav',data,sample_rate,subtype='PCM_24')
    result={'status':'rendered','voice':'Ria / 狸安','voiceAuthor':'RibosomeK','engine':'DiffSinger ONNX via diffsinger-utau',
        'duration':score['duration'],'sampleRate':sample_rate,'bitDepth':24,'peak':peak,'renderSeconds':round(time.time()-started,2),
        'changedRegion':{'start':start/sample_rate,'end':end/sample_rate},'unchangedOutsideRegion':True,'identicalPitchControl':True,
        'melodyUnchanged':True,'qualityAssessment':'Awaiting human listening; technical checks are not a quality rating.',
        'source':'https://github.com/RibosomeK/RiaDiffSinger','files':{name:hashlib.sha256((out/name).read_bytes()).hexdigest() for name in ['song-A.wav','song-B.wav','vocal-A.wav','vocal-B.wav','accompaniment.wav']}}
    (out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False),flush=True)

if __name__ == '__main__':
    render_demo()
