"""Apply a confirmed mix plan to immutable source stems; never re-sing or compose."""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def room(signal, wet, rate):
    out = signal.copy()
    for channel in range(2):
        for delay, gain in zip([.041, .077, .131, .211, .313, .449], [.43, .33, .26, .18, .13, .09]):
            offset = round((delay + channel * .011) * rate)
            if offset < len(signal):
                out[offset:, channel] += signal[:-offset, 1-channel] * wet * gain
    return out


def render(path):
    request = json.loads((path / 'request.json').read_text(encoding='utf-8'))
    source, proposal = Path(request['source']), request['proposal']
    for name, expected in proposal['sourceHashes'].items():
        if digest(source / name) != expected:
            raise ValueError('Source changed')
    score = json.loads((source / 'score.json').read_text(encoding='utf-8'))
    rate, frames = score['sampleRate'], round(score['sampleRate'] * score['duration'])

    def read(name):
        data, sr = sf.read(source / (name + '.wav'), dtype='float64', always_2d=True)
        if sr != rate or data.shape != (frames, 2) or not np.isfinite(data).all():
            raise ValueError('Invalid source')
        return data

    original_song, original_backing = read('song'), read('accompaniment')
    song, backing = original_song.copy(), original_backing.copy()
    mask = np.zeros(frames, dtype=bool)
    changes = proposal['plan']['changes']
    envelopes = []
    for change in changes:
        start, end = round(change['start'] * rate), round(change['end'] * rate)
        if start < 0 or end > frames or start >= end:
            raise ValueError('Invalid region')
        edge = min(round(proposal['plan']['transitionMs'] * rate / 1000), (end - start) // 2)
        envelope = np.ones(end - start)
        envelope[:edge] = np.linspace(0, 1, edge)
        envelope[-edge:] = np.linspace(1, 0, edge)
        envelopes.append((start, end, envelope[:, None]))
        mask[start:end] = True
    for name in ['piano', 'guitar', 'bass', 'drums', 'strings']:
        stem = read(name)
        for change, (start, end, envelope) in zip(changes, envelopes):
            delta = stem[start:end] * (10 ** (change['gains'][name] / 20) - 1) * envelope
            song[start:end] += delta
            backing[start:end] += delta
    vocal = read('vocal')
    # The source vocal is kept intact; only its mix gain and room contribution change.
    original_voice = room(vocal, .26, rate)
    for change, (start, end, envelope) in zip(changes, envelopes):
        adjusted = room(vocal, change['room'], rate) * 10 ** (change['gains']['vocal'] / 20)
        song[start:end] += (adjusted[start:end] - original_voice[start:end]) * envelope
    for name, signal, original in [('song', song, original_song), ('accompaniment', backing, original_backing)]:
        peak = float(np.max(np.abs(signal)))
        if not np.isfinite(signal).all() or not 0 < peak < .99:
            raise ValueError('Mix exceeds headroom; no automatic whole-song normalization')
        sf.write(path / (name + '.wav'), signal, rate, subtype='PCM_24')
        actual, _ = sf.read(path / (name + '.wav'), dtype='float64', always_2d=True)
        if not np.array_equal(actual[~mask], original[~mask]):
            raise ValueError('Unselected audio changed')
    result = {'proposalHash': proposal['hash'], 'duration': score['duration'], 'sampleRate': rate, 'bitDepth': 24,
              'peak': float(np.max(np.abs(song))), 'unchangedOutsideRegions': True,
              'regions': [{'id': c['id'], 'start': c['start'], 'end': c['end']} for c in changes],
              'assessment': 'unreviewed', 'files': {name: digest(path / name) for name in ['song.wav', 'accompaniment.wav']}}
    (path / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    render(Path(sys.argv[1]))
