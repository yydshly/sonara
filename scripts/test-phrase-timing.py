import importlib.util
from pathlib import Path
import copy
root=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,root/(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
timing=load('phrase-timing');alignment=load('phoneme-alignment')
entries={'wo':['w','o'],'ni':['n','i'],'hao':['h','ao'],'lai':['l','ai']}
types={p:('vowel' if p in ['o','i','ao','ai'] else 'consonant') for phones in entries.values() for p in phones}
phrase={'start':0,'end':4,'notes':[{'start':.25,'duration':.5,'pitch':'C4','pinyin':'wo'},{'start':.75,'duration':.75,'pitch':'D4','pinyin':'ni'},{'start':1.5,'duration':1,'pitch':'E4','pinyin':'hao'},{'start':2.5,'duration':1,'pitch':'C4','pinyin':'lai'}]}
groups,durations,pitches=timing.make_groups(phrase,'A',entries,types,alignment.align_groups)
legacy=alignment.align_groups([['AP']]+list(entries.values())+[['SP']],types)
assert groups==legacy and durations==[.25,.5,.75,1,1,.5] and pitches==['rest','C4','D4','E4','C4','rest']
rested=copy.deepcopy(phrase);rested['notes'][1]['duration']=.25
groups,durations,pitches=timing.make_groups(rested,'A',entries,types,alignment.align_groups)
assert pitches==['rest','C4','D4','rest','E4','C4','rest'] and durations==[.25,.5,.25,.5,1,1,.5]
assert groups[3]==['SP','h'] and groups[4]==['ao','l']
assert [p for group in groups for p in group]==['AP','w','o','n','i','SP','h','ao','l','ai','SP']
rested['notes'][1]['duration']=3
try:timing.make_groups(rested,'A',entries,types,alignment.align_groups)
except ValueError:pass
else:raise AssertionError('overlap accepted')
print('Continuous legacy groups unchanged; internal rests and consonant alignment checked; overlap rejected.')
