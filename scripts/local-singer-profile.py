"""The two installed singers, shared by private score validation and rendering."""
import hashlib
import json
from pathlib import Path
import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]
PROFILES = {
    'ria': {'name': 'Ria / 狸安', 'author': 'RibosomeK', 'bank': ROOT/'.local/score-trial/voicebank'},
    'qixuan': {'name': '绮萱 Qixuan', 'author': '颜绮萱、YQ之神及制作组', 'bank': ROOT/'.local/voice-comparison/qixuan/Qixuan_v2.7.0_DiffSinger_OpenUtau'},
}

def profile(voice):
    if voice not in PROFILES:
        raise ValueError('Unknown singer')
    value = PROFILES[voice]
    if not (value['bank']/'dsdur/dsdict-zh.yaml').is_file():
        raise ValueError('Singer is not installed')
    return value

def dictionary(voice):
    return yaml.load((profile(voice)['bank']/'dsdur/dsdict-zh.yaml').read_text(encoding='utf-8'), Loader=getattr(yaml, 'CSafeLoader', yaml.SafeLoader))

def configure(engine, voice):
    value = profile(voice)
    bank = value['bank']
    if engine.bank != bank:
        data = dictionary(voice)
        engine.bank = bank
        engine.entries = {e['grapheme']: e['phonemes'] for e in data['entries']}
        engine.symbol_types = {s['symbol']: s['type'] for s in data['symbols']}
        engine.predictor = engine.PredAll(bank)
        engine.speaker = engine.predictor.available_speakers[0] if engine.predictor.available_speakers else None
        engine.sample_rate = engine.predictor.dsvocoder.sample_rate
    if voice == 'qixuan':
        original = engine.OnnxReader.predict
        pauses = [engine.predictor.dsacoustic.phonemes.content[p] for p in ['AP', 'SP']]
        def predict(self, inputs):
            if 'languages' in inputs and 'tokens' in inputs:
                inputs = {**inputs, 'languages': np.where(np.isin(inputs['tokens'], pauses), 0, inputs['languages']).astype(np.int64)}
            return original(self, inputs)
        engine.OnnxReader.predict = predict
    hashes = {str(p.relative_to(bank)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(bank.rglob('*.onnx'))}
    engine.voice_identity = voice + ':' + hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()
    return value
