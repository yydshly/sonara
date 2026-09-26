import importlib.util
import unittest
from pathlib import Path
import numpy as np

spec = importlib.util.spec_from_file_location('expression', Path(__file__).with_name('voice-expression.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExpressionTests(unittest.TestCase):
    def test_controls_reach_curves_but_preserve_unvoiced_regions_and_pitch(self):
        voice = np.full(200, -20.)
        voice[60:75] = -120
        ds = {'voicing':' '.join(map(str,voice)), 'voicing_timestep':'.01', 'breathiness':' '.join(['-30']*200), 'breathiness_timestep':'.01', 'tension':' '.join(['-10']*200), 'tension_timestep':'.01', 'f0_seq':'220 221 222'}
        phrase = {'start':0, 'notes':[{'start':.2,'duration':.6},{'start':.8,'duration':.8}]}
        controls = {'breathinessDb':[1.5,0], 'tensionDb':[-1,.5], 'velocity':[1.05,.95]}
        result = module.apply_delivery(ds,phrase,controls)
        breath = np.fromstring(ds['breathiness'],sep=' ')
        self.assertGreater(breath[45],-30)
        self.assertTrue(np.all(breath[:20]==-30))
        self.assertTrue(np.all(breath[60:75]==-30))
        self.assertTrue(np.all(breath[160:]==-30))
        self.assertEqual(ds['f0_seq'],'220 221 222')
        self.assertEqual(len(np.fromstring(ds['velocity'],sep=' ')),200)
        self.assertGreater(result['curves']['breathinessDb']['controlledFrames'],0)
        self.assertNotEqual(result['curves']['tensionDb']['beforeHash'],result['curves']['tensionDb']['afterHash'])

    def test_invalid_controls_cannot_be_silently_clamped(self):
        for values in [[float('nan')],[10],[True],[]]:
            with self.assertRaises(ValueError):
                module.validate_delivery({'breathinessDb':values,'tensionDb':[0],'velocity':[1]},1)


if __name__ == '__main__':
    unittest.main()
