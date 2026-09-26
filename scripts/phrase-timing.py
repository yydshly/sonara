"""Build real sung/rest groups from validated note positions, without model loading."""
def make_groups(phrase, version, entries, symbol_types, align):
    notes=phrase['notes']; syllables=[['AP']]; durations=[notes[0]['start']-phrase['start']]; pitches=['rest']
    if durations[0]<=0: raise ValueError('Missing leading breath')
    for i,note in enumerate(notes):
        syllables.append(entries[note['pinyin' if version=='A' else 'revisedPinyin']]);durations.append(note['duration']);pitches.append(note['pitch'])
        end=note['start']+note['duration']; next_start=notes[i+1]['start'] if i+1<len(notes) else phrase['end'];gap=next_start-end
        if gap < -1e-7: raise ValueError('Overlapping notes')
        if gap > 1e-7:
            syllables.append(['SP']);durations.append(gap);pitches.append('rest')
    if syllables[-1]!=['SP']: raise ValueError('Missing trailing breath')
    # Align each connected group separately; consonants can prepare a note during
    # its preceding rest, but may never cross an intervening spoken-word group.
    groups=[]; segment=[['AP']]
    for phones in syllables[1:]:
        segment.append(phones)
        if phones==['SP']:
            connected=align(segment,symbol_types)
            if not groups: groups.extend(connected)
            else:
                groups[-1].extend(connected[0][1:])
                groups.extend(connected[1:])
            segment=[['AP']]
    if len(groups)!=len(durations) or len(groups)!=len(pitches): raise ValueError('Mismatched note/rest groups')
    if abs(sum(durations)-(phrase['end']-phrase['start']))>1e-6: raise ValueError('Phrase timing drift')
    return groups,durations,pitches
