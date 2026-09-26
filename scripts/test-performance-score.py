"""Check syllable/melisma/rest alignment without loading a singing model."""
import copy
import importlib.util
from pathlib import Path
import unittest
import numpy as np
from types import SimpleNamespace

ROOT=Path(__file__).resolve().parent
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
compiler=load('compiler','performance-score.py')
alignment=load('align','phoneme-alignment.py')
entries={'ni':['n','i'],'hao':['h','ao']}
types={'n':'consonant','h':'consonant','i':'vowel','ao':'vowel'}


class PerformanceTests(unittest.TestCase):
    def setUp(self):
        self.phrase={'startBeat':0,'endBeat':5,'syllables':[
            {'lyric':'你','pinyin':'ni','beat':.5,'notes':[(60,.5),(62,1)]},
            {'lyric':'好','pinyin':'hao','beat':3,'notes':[(64,1)]}]}

    def compile(self):return compiler.compile_phrase(self.phrase,120,entries,types,alignment.align_groups)

    def test_melisma_keeps_single_vowel(self):
        ds,notes=self.compile()
        self.assertEqual(ds['ph_seq'],'AP n i SP h ao SP')
        self.assertEqual(ds['note_slur'],'0 0 1 0 0 0')
        self.assertEqual(ds['ph_num'],'2 1 2 1 1')
        self.assertEqual(compiler.word_durations(ds),[.25,.75,.5,.5,.5])
        self.assertEqual([n['continuation'] for n in notes],[False,True,False])

    def test_continuous_syllables_prepare_consonant(self):
        self.phrase['syllables'][1]['beat']=2
        ds,_=self.compile()
        self.assertEqual(ds['ph_seq'],'AP n i h ao SP')
        self.assertEqual(ds['ph_num'],'2 2 1 1')

    def test_overlap_is_rejected(self):
        self.phrase['syllables'][1]['beat']=1
        with self.assertRaises(ValueError):self.compile()

    def test_tail_is_required(self):
        self.phrase['endBeat']=4
        with self.assertRaises(ValueError):self.compile()

    def test_legacy_note_groups_unchanged(self):
        self.assertEqual(compiler.word_durations({'note_dur':'.2 .4 .6','note_slur':'0 0 0','ph_num':'1 2 1'}),[.2,.4,.6])

    def test_invalid_slur_and_duration(self):
        for durations,slurs in [('1 1','1 0'),('1 -1','0 0'),('1 nan','0 0'),('1 1','0 2')]:
            with self.assertRaises(ValueError):compiler.word_durations({'note_dur':durations,'note_slur':slurs,'ph_num':'1 1'})

    def test_repeated_control_edits_do_not_compound_or_change_other_curves(self):
        _, notes = self.compile()
        phrase = {'start':0,'notes':notes}
        original = {'breathiness':' '.join(['-45']*250),'breathiness_timestep':'.01',
                    'velocity':' '.join(['1']*250),'velocity_timestep':'.01',
                    'voicing':' '.join(['-20']*250),'voicing_timestep':'.01',
                    'tension':'unchanged','f0_seq':'unchanged','ph_dur':'unchanged'}
        ds = copy.deepcopy(original)
        acoustic = SimpleNamespace(use_breathiness_embed=True,use_speed_embed=True)
        old = {'breathinessDb':[.3,.5,.7],'velocity':[1.02,1.03,.97]}
        new = {'breathinessDb':[-.2,-.3,-.4],'velocity':[1.01,.99,1.03]}
        compiler.apply_controls(ds,phrase,old,acoustic)
        compiler.remove_controls(ds,phrase,old)
        compiler.apply_controls(ds,phrase,new,acoustic)
        direct = copy.deepcopy(original)
        compiler.apply_controls(direct,phrase,new,acoustic)
        for name in ['breathiness','velocity']:
            self.assertTrue(np.allclose(np.fromstring(ds[name],sep=' '),np.fromstring(direct[name],sep=' '),atol=1e-6,rtol=0))
        for name in ['voicing','tension','f0_seq','ph_dur']:
            self.assertEqual(ds[name],original[name])


if __name__=='__main__':unittest.main()
