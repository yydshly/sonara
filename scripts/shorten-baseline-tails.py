"""Re-sing shorter phrase endings, preserving the published source and backing."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import time
import numpy as np
import soundfile as sf

ROOT=Path(__file__).resolve().parents[1]
OLD=ROOT/'dist/sound-baseline-v1'
OUT=ROOT/'dist/sound-baseline-v2'
CACHE=ROOT/'.local/sound-baseline-v2'


def load(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def main():
    start=time.time()
    source=json.loads((OLD/'manifest.json').read_text(encoding='utf8'))
    original=json.loads((OLD/'score.json').read_text(encoding='utf8'))
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    for name,value in source['files'].items():assert digest(OLD/name)==value
    OUT.mkdir(exist_ok=True);CACHE.mkdir(parents=True,exist_ok=True)
    if (OUT/'manifest.json').exists():raise RuntimeError('Published version exists; do not overwrite listening evidence')
    builder=load('builder','build-sound-baseline.py');builder.OUT=OUT;builder.CACHE=CACHE
    score=copy.deepcopy(original);score['id']='window-reunion-v2'
    replacements=[[(65,1)],[(69,1)],[(67,.75)],[(67,.25),(65,1)]]
    intents=[
        '靠窗保持原来的节奏；边字用一个音收住，不再连续转三个音。',
        '这些年保持连贯，年字只停留一拍，随后让伴奏接话。',
        '点字缩到四分之三拍，像一句简短的回答。',
        '保留笑起来的展开；前字只作一次短转音，落稳后及时收声。']
    changes=[]
    for index,(p,notes) in enumerate(zip(score['phrases'],replacements)):
        ending=p['syllables'][-1]
        before=sum(n[1] for n in ending['notes']);after=sum(n[1] for n in notes)
        assert after<before
        changes.append({'line':index+1,'lyric':ending['lyric'],'beforeBeats':before,'afterBeats':after,
                        'beforeSeconds':round(before*60/score['bpm'],3),'afterSeconds':round(after*60/score['bpm'],3),
                        'beforeNotes':ending['notes'],'afterNotes':notes})
        ending['notes']=notes
        # Leave expressive controls constant: the change is the note ending.
        p['intent']=intents[index]
    score['revision']={'source':original['id'],'request':'拖音太长了 感觉不舒服','changes':changes,
                       'scope':'缩短四句句尾并减少转音，整句重新合成。歌词、速度、入句时间、声线、伴奏不变。'}
    builder.dump(OUT/'score.json',score)
    profiles=load('profiles','local-singer-profile.py')
    spec=importlib.util.spec_from_file_location('engine',ROOT/'scripts/render-score-trial.py')
    engine=importlib.util.module_from_spec(spec);engine.bank_override=profiles.profile('qixuan')['bank'];spec.loader.exec_module(engine)
    profiles.configure(engine,'qixuan')
    compiler=load('performance','performance-score.py')
    vocal=np.zeros(round(score['duration']*44100));records=[]
    for i,p in enumerate(score['phrases']):
        ds,notes=compiler.compile_phrase(p,score['bpm'],engine.entries,engine.symbol_types,engine.alignment.align_groups)
        phrase={'index':i,'start':p['startBeat']*60/score['bpm'],'end':p['endBeat']*60/score['bpm'],
                'lyrics':''.join(s['lyric'] for s in p['syllables']),'notes':notes}
        controls={key:[p['syllables'][n['syllable']][key] for n in notes] for key in ['breathinessDb','velocity']}
        audio,actual=engine.render_phrase(phrase,'A',cache_dir=CACHE/'phrases',cache_key=str(i+1),prepared_ds=ds,controls=controls)
        at=round(phrase['start']*44100);vocal[at:at+len(audio)]+=audio
        expected=compiler.word_durations(actual)
        assert abs(sum(map(float,actual['ph_dur'].split()))-sum(expected))<1e-5
        last=p['syllables'][-1]
        end=(last['beat']+sum(d for _,d in last['notes']))*60/score['bpm']
        # SP begins exactly at the newly authored vocal release, not at the old one.
        assert actual['note_seq'].split()[-1]=='rest'
        assert abs(float(actual['note_dur'].split()[-1])-(phrase['end']-end))<1e-7
        records.append({'line':i+1,'releaseSeconds':end,'realTrailingRestSeconds':float(actual['note_dur'].split()[-1]),
                        'continuationNotes':sum(map(int,actual['note_slur'].split()))})
    vocal,meter=builder.loudness(vocal,-21)
    backing,rate=sf.read(OLD/'original-accompaniment.wav',always_2d=True)
    assert rate==44100 and len(vocal)==len(backing)
    song=backing+vocal[:,None]
    assert np.isfinite(song).all() and np.max(np.abs(song))<.99
    for name,data in [('original-vocal',vocal),('original-mix',song)]:sf.write(OUT/(name+'.wav'),data,44100,subtype='PCM_24')
    for name in ['original-accompaniment.wav','original-accompaniment.mid','arrangement.json']:shutil.copyfile(OLD/name,OUT/name)
    piano=builder.render_instruments(score,'original-melody',builder.guide(score));piano,_=builder.loudness(piano,-21)
    sf.write(OUT/'original-melody.wav',piano,44100,subtype='PCM_24')
    # Verify decoded files as heard by the browser, allowing PCM24 rounding only.
    mix,_=sf.read(OUT/'original-mix.wav',always_2d=True);dry,_=sf.read(OUT/'original-vocal.wav',always_2d=True)
    error=float(np.max(np.abs(mix-backing-dry)));assert error<=3*2**-23
    assert digest(OLD/'original-accompaniment.wav')==digest(OUT/'original-accompaniment.wav')
    for name,value in source['files'].items():assert digest(OLD/name)==value
    evidence={'sourceId':source['id'],'voiceIdentity':engine.voice_identity,'changes':changes,'phraseInputs':records,
              'sameAccompanimentBytes':True,'sourceFilesUnchanged':True,'sameLyricsTempoEntrancesVoice':True,
              'vocalRerenderScope':'entire four phrases; unchanged vowel waveforms are not guaranteed',
              'mixMinusBackingVsDryMaxError':error,'mixPeak':float(np.max(np.abs(mix))),'vocalMeter':meter,
              'renderSeconds':round(time.time()-start,2),'qualityAssessment':'awaiting-user-listening'}
    files={p.name:digest(p) for p in OUT.iterdir() if p.suffix in ['.wav','.mid','.json']}
    manifest={**{k:source[k] for k in ['title','bpm','key','duration','brief','lyrics','authorship','referenceSource']},
              'id':'sound-baseline-v2','label':'少拖音版','files':files,'assessment':'awaiting-user-listening',
              'changeSummary':'四句句尾缩短到约 0.4–0.7 秒，减少连续转音；速度与伴奏保持相同。',
              'phrases':[{'start':p['syllables'][0]['beat']*60/score['bpm'],'end':p['endBeat']*60/score['bpm'],'text':p['display'],'intent':p['intent']} for p in score['phrases']],
              'previous':{'base':'/sound-baseline-v1/','label':'原版 · 较长收尾','files':source['files'],'phrases':source['phrases']},
              'referenceBase':'/sound-baseline-v1/','referenceFiles':source['files'],'evidence':evidence}
    builder.dump(ROOT/'validation/short-tail-audio.json',evidence)
    builder.dump(ROOT/'validation/sound-baseline-user-assessment.json',{
        'source':'user-conversation','date':'2026-09-27','trialId':source['id'],'mixSha256':source['files']['original-mix.wav'],
        'quote':'拖音太长了 感觉不舒服','assessment':'phrase-end-sustains-uncomfortable','playbackEvidence':None})
    builder.dump(OUT/'manifest.json',manifest)
    print(json.dumps(evidence,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
