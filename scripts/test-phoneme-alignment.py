import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('alignment', Path(__file__).with_name('phoneme-alignment.py'))
alignment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alignment)


class AlignmentTests(unittest.TestCase):
    types = {'n':'nasal', 'l':'liquid', 'th':'stop', 'y':'semivowel',
             'aa':'vowel', 'uw':'vowel', 'eh':'vowel', ':n':'coda'}

    def test_long_final_vowel_owns_its_note_instead_of_initial_consonant(self):
        actual = alignment.align_groups([['AP'], ['n','aa'], ['l','uw'], ['SP']], self.types)
        self.assertEqual(actual, [['AP','n'], ['aa','l'], ['uw'], ['SP']])

    def test_glide_and_coda_stay_ordered_without_changing_word_or_note_count(self):
        phones = [['AP'], ['th','y','eh',':n'], ['aa'], ['SP']]
        actual = alignment.align_groups(phones, self.types)
        self.assertEqual(actual, [['AP','th'], ['y','eh',':n'], ['aa'], ['SP']])
        self.assertEqual(len(actual), len(phones))
        self.assertEqual(sum(actual, []), sum(phones, []))

    def test_vowel_initial_and_single_vowel_keep_their_onsets(self):
        self.assertEqual(alignment.align_groups([['AP'], ['aa',':n'], ['uw'], ['SP']], self.types),
                         [['AP'], ['aa',':n'], ['uw'], ['SP']])

    def test_unknown_or_unvoiced_syllable_fails_instead_of_guessing(self):
        for syllable in [['unknown'], ['l'], []]:
            with self.assertRaises(ValueError):
                alignment.align_groups([['AP'], syllable, ['SP']], self.types)


if __name__ == '__main__':
    unittest.main()
