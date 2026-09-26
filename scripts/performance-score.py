"""Compile lyric syllables independently of notes; no model imports required.

One syllable may continue across several notes. Word durations are sums of those
notes, not one duration per phone group. Rest groups keep consonant preparation.
"""
import math

POLICY = 'syllable-performance-v1'


def compile_phrase(phrase, bpm, entries, symbol_types, align):
    if not 40 <= bpm <= 220 or not math.isfinite(bpm):
        raise ValueError('Invalid tempo')
    unit = 60 / bpm
    syllables = phrase['syllables']
    if not syllables or phrase['endBeat'] <= phrase['startBeat']:
        raise ValueError('Empty phrase')
    groups = [['AP']]
    sequence = []
    cursor = phrase['startBeat']
    slots = []

    def rest(beats, initial=False):
        if beats <= 0:
            raise ValueError('Missing breath space')
        if not initial:
            groups.append(['SP'])
        sequence.append(('rest', beats * unit, 0))

    rest(syllables[0]['beat'] - cursor, initial=True)
    cursor = syllables[0]['beat']
    for i, syllable in enumerate(syllables):
        if not math.isfinite(syllable['beat']) or syllable['beat'] < cursor - 1e-8:
            raise ValueError('Overlapping syllables')
        if syllable['beat'] > cursor + 1e-8:
            rest(syllable['beat'] - cursor)
        if syllable['pinyin'] not in entries:
            raise ValueError('Unsupported pronunciation')
        groups.append(list(entries[syllable['pinyin']]))
        cursor = syllable['beat']
        notes = syllable['notes']
        if not notes:
            raise ValueError('Missing notes')
        for j, note in enumerate(notes):
            pitch, beats = note
            if isinstance(pitch, bool) or not isinstance(pitch, int) or not 36 <= pitch <= 84:
                raise ValueError('Invalid pitch')
            if not math.isfinite(beats) or beats <= 0:
                raise ValueError('Invalid note duration')
            name = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][pitch % 12] + str(pitch // 12 - 1)
            sequence.append((name, beats * unit, int(j > 0)))
            slots.append({'lyric': syllable['lyric'], 'syllable': i, 'midi': pitch,
                          'beat': cursor, 'beats': beats, 'start': cursor * unit,
                          'duration': beats * unit, 'continuation': j > 0})
            cursor += beats
    rest(phrase['endBeat'] - cursor)
    # Each internal rest closes one connected word group. The next consonant
    # may prepare inside that rest but never relocates a vowel across the gap.
    aligned = []
    segment = [['AP']]
    for phones in groups[1:]:
        segment.append(phones)
        if phones == ['SP']:
            part = align(segment, symbol_types)
            if aligned:
                aligned[-1].extend(part[0][1:])
                aligned.extend(part[1:])
            else:
                aligned.extend(part)
            segment = [['AP']]
    if len(aligned) != sum(s == 0 for _, _, s in sequence):
        raise ValueError('Word/note alignment mismatch')
    ds = {'offset': phrase['startBeat'] * unit,
          'text': 'AP ' + ''.join(s['lyric'] for s in syllables) + ' SP',
          'ph_seq': ' '.join(p for g in aligned for p in g),
          'ph_num': ' '.join(str(len(g)) for g in aligned),
          'note_seq': ' '.join(n for n, _, _ in sequence),
          'note_dur': ' '.join(f'{d:.9f}' for _, d, _ in sequence),
          'note_slur': ' '.join(str(s) for _, _, s in sequence),
          'phonemeAlignment': POLICY}
    if abs(sum(d for _, d, _ in sequence) - (phrase['endBeat'] - phrase['startBeat']) * unit) > 1e-6:
        raise ValueError('Phrase duration drift')
    return ds, slots


def word_durations(ds):
    durations = [float(x) for x in ds['note_dur'].split()]
    slurs = [int(x) for x in ds['note_slur'].split()]
    if len(durations) != len(slurs) or not durations or slurs[0] != 0:
        raise ValueError('Invalid note grouping')
    result = []
    for duration, slur in zip(durations, slurs):
        if not math.isfinite(duration) or duration <= 0 or slur not in (0, 1):
            raise ValueError('Invalid note grouping')
        if slur:
            result[-1] += duration
        else:
            result.append(duration)
    if len(result) != len(ds['ph_num'].split()):
        raise ValueError('Phone groups do not match lyric syllables')
    return result


def apply_controls(ds, phrase, controls, acoustic):
    """Only apply controls actually supported by the selected acoustic model."""
    import numpy as np
    if set(controls) != {'breathinessDb', 'velocity'}:
        raise ValueError('Unsupported performance controls')
    if not acoustic.use_breathiness_embed or not acoustic.use_speed_embed:
        raise ValueError('Singer does not expose requested controls')
    starts = np.array([n['start'] - phrase['start'] for n in phrase['notes']])
    ends = starts + np.array([n['duration'] for n in phrase['notes']])
    centres = (starts + ends) / 2
    audit = {}
    for key, name, neutral, low, high in [('breathinessDb', 'breathiness', 0, -1.5, 1.5), ('velocity', 'velocity', 1, .9, 1.1)]:
        values = np.array(controls[key], dtype=float)
        if len(values) != len(starts) or not np.isfinite(values).all() or np.any((values < low) | (values > high)):
            raise ValueError('Invalid performance control')
        step = float(ds.get(name + '_timestep') or ds['voicing_timestep'])
        original = np.fromstring(ds[name], sep=' ') if name in ds else np.ones(len(ds['voicing'].split()))
        times = np.arange(len(original)) * step
        active = np.zeros(len(times), bool)
        for begin, end in zip(starts, ends):
            active |= (times >= begin) & (times < end)
        # Keep all controls neutral during phrase/internal rests.
        control = np.interp(times, centres, values)
        control[~active] = neutral
        ds[name] = ' '.join(f'{x:.6f}' for x in (original + control if neutral == 0 else original * control))
        ds[name + '_timestep'] = str(step)
        audit[key] = {'controlledFrames': int(np.count_nonzero(control != neutral)),
                      'min': float(control.min()), 'max': float(control.max()), 'neutralInRests': True}
    return audit


def remove_controls(ds, phrase, controls):
    """Recover the base curves for a pure control edit; preserve all other DS data.

    A saved DS already contains its former controls. Undo those before applying
    new absolute settings, so repeated revisions never compound breath or speed.
    """
    import numpy as np
    starts = np.array([n['start'] - phrase['start'] for n in phrase['notes']])
    ends = starts + np.array([n['duration'] for n in phrase['notes']])
    centres = (starts + ends) / 2
    for key, name, neutral in [('breathinessDb', 'breathiness', 0), ('velocity', 'velocity', 1)]:
        original = np.fromstring(ds[name], sep=' ')
        times = np.arange(len(original)) * float(ds[name + '_timestep'])
        active = np.zeros(len(times), bool)
        for begin, end in zip(starts, ends):
            active |= (times >= begin) & (times < end)
        values = np.asarray(controls[key], dtype=float)
        if len(values) != len(starts) or not np.isfinite(values).all() or (neutral and np.any(values <= 0)):
            raise ValueError('Invalid previous controls')
        curve = np.interp(times, centres, values)
        curve[~active] = neutral
        ds[name] = ' '.join(f'{v:.9f}' for v in (original-curve if neutral == 0 else original/curve))
