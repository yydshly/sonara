import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
import soundfile as sf

spec = importlib.util.spec_from_file_location('phrasing', Path(__file__).with_name('render-phrasing.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PreviewTests(unittest.TestCase):
    def test_preview_uses_note_timing_and_validates_source_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder)/'source', Path(folder)/'output'
            source.mkdir()
            output.mkdir()
            rate = 8000
            accompaniment = np.zeros((rate*2, 2))
            sf.write(source/'accompaniment.wav', accompaniment, rate, subtype='PCM_24')
            base = {'duration': 2, 'sampleRate': rate, 'phrases': [{'index': 0, 'section': 'verse', 'lyrics': '晚风', 'start': .4, 'end': 1.6, 'notes': [{'midi': 60, 'start': .5, 'duration': .4}, {'midi': 62, 'start': .9, 'duration': .6}]}]}
            score = json.loads(json.dumps(base))
            score['phrases'][0]['notes'][0]['duration'] = .6
            score['phrases'][0]['notes'][1]['start'] = 1.1
            score['phrases'][0]['notes'][1]['duration'] = .4
            request = {'source': str(source), 'sourceHashes': {'accompaniment.wav': module.digest(source/'accompaniment.wav')}, 'baseScore': base, 'scoreHash': 'fixture', 'sectionId': 'all'}
            (output/'request.json').write_text(json.dumps(request))
            (output/'score.json').write_text(json.dumps(score))
            module.render(output, 'prepare')
            a, sr = sf.read(output/'preview-A.wav')
            b, _ = sf.read(output/'preview-B.wav')
            self.assertEqual(sr, rate)
            self.assertEqual(len(a), rate*2)
            self.assertTrue(np.array_equal(a[:int(.9*rate)-400], b[:int(.9*rate)-400]))
            self.assertGreater(np.count_nonzero(a != b), 1000)
            self.assertEqual(json.loads((output/'preview.json').read_text())['voice'], False)
            (source/'accompaniment.wav').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'Source changed'):
                module.render(output, 'prepare')


if __name__ == '__main__':
    unittest.main()
