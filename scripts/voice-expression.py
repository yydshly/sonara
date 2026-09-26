"""Bounded model directives -> smooth, voiced-region acoustic controls.

This transforms control curves, not perceived emotions or quality scores.
"""
import hashlib
import numpy as np

LIMITS = {'breathinessDb': [-1.5, -1, -.5, 0, .5, 1, 1.5],
          'tensionDb': [-1.5, -1, -.5, 0, .5, 1, 1.5],
          'velocity': [.9, .95, 1, 1.05, 1.1]}


def validate_delivery(delivery, count):
    if not isinstance(delivery, dict) or set(delivery) != set(LIMITS):
        raise ValueError('Invalid delivery fields')
    for key, allowed in LIMITS.items():
        values = delivery[key]
        if not isinstance(values, list) or len(values) != count or any(isinstance(x, bool) or not isinstance(x, (int, float)) or x not in allowed for x in values):
            raise ValueError('Delivery outside approved bounds')


def apply_delivery(ds, phrase, delivery):
    validate_delivery(delivery, len(phrase['notes']))
    voicing = np.fromstring(ds['voicing'], sep=' ')
    voice_step = float(ds['voicing_timestep'])
    if not len(voicing) or not np.isfinite(voicing).all() or not voice_step > 0:
        raise ValueError('Invalid voicing curve')
    notes = phrase['notes']
    begins = np.array([n['start'] - phrase['start'] for n in notes])
    ends = begins + np.array([n['duration'] for n in notes])
    centres = (begins + ends) / 2
    audit = {'requested': delivery, 'curves': {}, 'policy': 'voiced-note-centres-linear-v1'}
    for key, name in [('breathinessDb', 'breathiness'), ('tensionDb', 'tension'), ('velocity', 'velocity')]:
        multiplier = key == 'velocity'
        neutral = 1 if multiplier else 0
        if multiplier and name not in ds:
            original = np.ones(len(voicing))
            step = voice_step
        else:
            if name not in ds or name + '_timestep' not in ds:
                raise ValueError('Voicebank is missing expression capability: ' + name)
            original = np.fromstring(ds[name], sep=' ')
            step = float(ds[name + '_timestep'])
        if not len(original) or not np.isfinite(original).all() or not step > 0:
            raise ValueError('Invalid expression curve')
        times = np.arange(len(original)) * step
        voiced = np.interp(times, np.arange(len(voicing))*voice_step, voicing, left=-120, right=-120) > -55
        active = voiced & (times >= begins[0]) & (times < ends[-1])
        points = np.concatenate(([begins[0]], centres, [ends[-1]]))
        values = np.concatenate(([neutral], np.array(delivery[key]), [neutral]))
        control = np.interp(times, points, values, left=neutral, right=neutral)
        control[~active] = neutral
        changed = original * control if multiplier else original + control
        before = ' '.join(f'{v:.6f}' for v in original)
        after = ' '.join(f'{v:.6f}' for v in changed)
        ds[name] = after
        ds[name + '_timestep'] = str(step)
        audit['curves'][key] = {
            'frames': len(changed), 'controlledFrames': int(np.count_nonzero(control != neutral)),
            'controlMin': float(control.min()), 'controlMax': float(control.max()),
            'beforeHash': hashlib.sha256(before.encode()).hexdigest(),
            'afterHash': hashlib.sha256(after.encode()).hexdigest(),
        }
    return audit
