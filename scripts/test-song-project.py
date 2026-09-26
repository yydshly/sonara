"""Small signal fixtures verify mixing, boundaries and source identity, not artistic quality."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
import soundfile as sf

spec = importlib.util.spec_from_file_location('renderer', Path(__file__).with_name('render-song-project.py'))
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class RenderTests(unittest.TestCase):
    def test_changed_region_and_exact_preservation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, output = root / 'source', root / 'output'
            source.mkdir()
            output.mkdir()
            rate = 8000
            wave = np.tile((.03 * np.sin(np.arange(rate * 2) * 2 * np.pi * 220 / rate))[:, None], (1, 2))
            for name in ['song', 'accompaniment', 'vocal', 'piano', 'guitar', 'bass', 'drums', 'strings']:
                sf.write(source / (name + '.wav'), wave, rate, subtype='PCM_24')
            (source / 'score.json').write_text(json.dumps({'sampleRate': rate, 'duration': 2}))
            proposal = {'hash': 'fixture', 'sourceHashes': {p.name: renderer.digest(p) for p in source.iterdir()}, 'plan': {'transitionMs': 120, 'changes': [{'id': 'chorus', 'start': .5, 'end': 1.5, 'room': .28, 'gains': {name: 1 for name in ['piano', 'guitar', 'bass', 'drums', 'strings', 'vocal']}}]}}
            (output / 'request.json').write_text(json.dumps({'source': str(source), 'proposal': proposal}))
            renderer.render(output)
            original, _ = sf.read(source / 'song.wav')
            actual, _ = sf.read(output / 'song.wav')
            self.assertTrue(np.array_equal(original[:4000], actual[:4000]))
            self.assertTrue(np.array_equal(original[12000:], actual[12000:]))
            self.assertFalse(np.array_equal(original[4000:12000], actual[4000:12000]))
            result = json.loads((output / 'result.json').read_text())
            self.assertTrue(result['unchangedOutsideRegions'])
            (source / 'piano.wav').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'Source changed'):
                renderer.render(output)


if __name__ == '__main__':
    unittest.main()
