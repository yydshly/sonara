"""Render score-led timing proposals. Original sources are immutable."""
import importlib.util
import json
import hashlib
import sys
import time
from pathlib import Path
import numpy as np
import soundfile as sf


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def room(signal, rate):
    result = signal.copy()
    for channel in range(2):
        for delay, gain in [(0.041, .43), (.077, .33), (.131, .26), (.211, .18), (.313, .13), (.449, .09)]:
            shift = round((delay + channel * .011) * rate)
            if shift < len(signal):
                result[shift:, channel] += signal[:-shift, 1-channel] * .26 * gain
    return result


def render(path, mode):
    request = json.loads((path / 'request.json').read_text(encoding='utf-8'))
    score = json.loads((path / 'score.json').read_text(encoding='utf-8'))
    base, source = request['baseScore'], Path(request['source'])
    expression = request.get('expression', False)
    if expression and digest(path/'score.json') != request['scoreHash']:
        raise ValueError('Approved expression score changed')
    for name, expected in request['sourceHashes'].items():
        if digest(source / name) != expected:
            raise ValueError('Source changed')
    sr, length = score['sampleRate'], round(score['duration'] * score['sampleRate'])
    for a, b in zip(base['phrases'], score['phrases']):
        if (not request.get('rewriteLyrics') and a['lyrics'] != b['lyrics']) or [n['midi'] for n in a['notes']] != [n['midi'] for n in b['notes']]:
            raise ValueError('Protected lyric or note pitch changed')
        if expression and (len(b['notes']) != len(b['lyrics']) or ''.join(n['lyric'] for n in b['notes']) != b['lyrics']):
            raise ValueError('Unaligned approved lyrics')

    if expression:
        import yaml
        root = Path(__file__).resolve().parents[1]
        dictionary = yaml.safe_load((root/'.local/score-trial/voicebank/dsdur/dsdict-zh.yaml').read_text(encoding='utf-8'))
        allowed = {item['grapheme'] for item in dictionary['entries']}
        if any(n['pinyin'] not in allowed for p in score['phrases'] for n in p['notes']):
            raise ValueError('Unpronounceable approved lyrics')

    def read(name):
        audio, rate = sf.read(source / (name + '.wav'), dtype='float64', always_2d=True)
        if rate != sr or audio.shape != (length, 2) or not np.isfinite(audio).all():
            raise ValueError('Invalid source audio')
        return audio

    if mode == 'prepare':
        selected = [p for p in score['phrases'] if request['sectionId'] == 'all' or p['section'] == request['sectionId']]
        start = 0 if request['sectionId'] == 'all' else min(p['start'] for p in selected)
        end = score['duration'] if request['sectionId'] == 'all' else max(p['end'] for p in selected)
        first, last = round(start * sr), round(end * sr)
        backing = read('accompaniment')[first:last]
        for label, current in [('A', base), ('B', score)]:
            audio = backing.copy()
            for p in current['phrases']:
                for n in p['notes']:
                    pos = round(n['start'] * sr) - first
                    if pos < 0 or pos >= len(audio):
                        continue
                    count = min(round(n['duration'] * sr), len(audio)-pos)
                    t = np.arange(count) / sr
                    f = 440 * 2 ** ((n['midi']-69)/12)
                    envelope = np.minimum(1, t/.012) * np.minimum(1, (count-np.arange(count))/(sr*.04))
                    wave = .12 * (np.sin(2*np.pi*f*t) + .12*np.sin(4*np.pi*f*t)) * envelope
                    audio[pos:pos+count] += wave[:, None]
            if np.max(np.abs(audio)) >= .99:
                raise ValueError('Preview overload')
            sf.write(path / f'preview-{label}.wav', audio, sr, subtype='PCM_24')
        (path / 'preview.json').write_text(json.dumps({'scoreHash': request['scoreHash'], 'offset': start, 'duration': (last-first)/sr, 'kind': 'instrumental-timing-preview', 'voice': False}), encoding='utf-8')
        return
    if mode != 'sing':
        raise ValueError('Invalid mode')
    began = time.time()
    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location('singer', root / 'scripts/render-score-trial.py')
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    original = read('vocal')
    vocal = original.copy()
    expression_evidence = []
    for i, change in enumerate(request['changes']):
        p = next(p for p in score['phrases'] if p['index'] == change['index'])
        local = json.loads(json.dumps(p))
        for n in local['notes']:
            n['start'] -= p['start']
        local['end'] -= p['start']
        local['start'] = 0
        print(f'PHRASE {i+1}/{len(request["changes"])}', flush=True)
        delivery = p.get('delivery') if expression else None
        if expression and delivery != change['delivery']:
            raise ValueError('Requested delivery does not match approved score')
        wav, _ = engine.render_phrase(local, 'A', cache_dir=path / 'phrases', cache_key=str(p['index']), delivery=delivery)
        if expression:
            evidence = json.loads((path/'phrases'/f"{p['index']}.expression.json").read_text(encoding='utf-8'))
            if evidence.get('acousticInputsVerified') is not True:
                raise ValueError('Unverified acoustic controls')
            expression_evidence.append({'index':p['index'], **evidence})
        first, last = round(p['start'] * sr), round(p['end'] * sr)
        changed = np.zeros(last-first, dtype=np.float64)
        changed[:min(len(wav), len(changed))] = wav[:len(changed)]
        rms = float(np.sqrt(np.mean(original[first:last] ** 2)))
        gain = min(rms / max(float(np.sqrt(np.mean(changed**2))), 1e-8), .59/max(float(np.max(np.abs(changed))), 1e-8))
        vocal[first:last] = (changed * gain)[:, None]
    mix = read('song')
    source_mix = mix.copy()
    delta = room(vocal, sr) - room(original, sr)
    mask = np.zeros(length, dtype=bool)
    for c in request['changes']:
        first, last = round(c['start'] * sr), round(c['end'] * sr)
        mask[first:last] = True
        fade = min(round(sr * .012), (last-first)//2)
        envelope = np.ones(last-first)
        envelope[:fade] = np.linspace(0, 1, fade)
        envelope[-fade:] = np.linspace(1, 0, fade)
        mix[first:last] += delta[first:last] * envelope[:, None]
    peak = float(np.max(np.abs(mix)))
    if not np.isfinite(mix).all() or not .001 < peak < .99:
        raise ValueError('Invalid mix or insufficient headroom')
    for name, signal, before in [('song', mix, source_mix), ('vocal', vocal, original)]:
        sf.write(path / (name + '.wav'), signal, sr, subtype='PCM_24')
        actual, _ = sf.read(path / (name + '.wav'), dtype='float64', always_2d=True)
        if not np.array_equal(actual[~mask], before[~mask]):
            raise ValueError('Unselected samples changed')
        for c in request['changes']:
            first, last = round(c['start'] * sr), round(c['end'] * sr)
            if np.array_equal(actual[first:last], before[first:last]):
                raise ValueError('Requested region did not change')
    result = {'scoreHash': request['scoreHash'], 'duration': score['duration'], 'sampleRate': sr, 'bitDepth': 24,
              'peak': peak, 'renderSeconds': round(time.time()-began, 2), 'unchangedOutsideRegions': True,
              'lyricsAndNotePitchesPreserved': all(a['lyrics']==b['lyrics'] for a,b in zip(base['phrases'],score['phrases'])), 'assessment': 'unreviewed',
              'regions': [{k: c[k] for k in ['index', 'start', 'end']} for c in request['changes']],
              'files': {name: digest(path / name) for name in ['song.wav', 'vocal.wav']}}
    if expression:
        result.update({'lyricsMatchApprovedScore': True, 'notePitchesPreserved': True, 'expressionEvidence': expression_evidence})
    (path / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    render(Path(sys.argv[1]), sys.argv[2])
