"""Group phones on musical vowel onsets, as the DiffSinger models expect.

The phone order never changes. A syllable's leading consonants belong to the
preceding timing group so they prepare the vowel before the note's beat.
See OpenUtau.Core/DiffSinger/DiffSingerBasePhonemizer.cs, ProcessWord.
"""

ALIGNMENT_POLICY = 'vowel-onset-v1'


def align_groups(syllables, symbol_types):
    if not syllables or syllables[0] != ['AP'] or syllables[-1] != ['SP']:
        raise ValueError('Alignment requires leading AP and trailing SP padding')
    groups = [['AP']]
    for phones in syllables[1:-1]:
        if not phones or any(p not in symbol_types for p in phones):
            raise ValueError('Unknown phone type; cannot align singing safely')
        vowel = next((i for i, p in enumerate(phones) if symbol_types[p] == 'vowel'), None)
        if vowel is None:
            raise ValueError('A sung syllable must have a vowel')
        # Preserve a consonant + glide + vowel cluster, following the phonemizer.
        anchor = vowel
        if vowel >= 2 and symbol_types[phones[vowel-1]] in {'glide', 'semivowel'}:
            anchor -= 1
        groups[-1].extend(phones[:anchor])
        groups.append(list(phones[anchor:]))
    groups.append(['SP'])
    assert [p for group in groups for p in group] == [p for word in syllables for p in word]
    return groups
