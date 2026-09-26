"""Publish verified after/before excerpts; never overwrite an earlier listening round."""
from pathlib import Path
import sys,json,hashlib,subprocess,re
import numpy as np
import soundfile as sf
ROOT=Path(__file__).resolve().parents[1]
base=ROOT/'.local/compositions/e68ea465-be24-48ca-a640-61a37aa64e6b'
target=ROOT/'.local/compositions'/sys.argv[1]
assert target.parent==ROOT/'.local/compositions' and re.fullmatch('[a-f0-9-]{36}',target.name)
source=json.loads((base/'score.json').read_text(encoding='utf8'));score=json.loads((target/'score.json').read_text(encoding='utf8'));job=json.loads((target/'job.json').read_text(encoding='utf8'))
assert job['state']=='succeeded' and source['phrases'][:2]==score['phrases'][:2]
assert score['lyrics'][2:]==['你回头喊我声音还没变','我笑着追过去像放学那天']
assert (base/'accompaniment.wav').read_bytes()==(target/'accompaniment.wav').read_bytes()
sr=score['sampleRate'];start=round(source['phrases'][2]['start']*sr);end=round(source['phrases'][3]['end']*sr)
a,rate=sf.read(base/'song.wav',always_2d=True);b,other_rate=sf.read(target/'song.wav',always_2d=True)
assert sr==rate==other_rate and a.shape==b.shape
assert np.array_equal(a[:start],b[:start]) and np.array_equal(a[end:],b[end:])
assert np.any(a[start:end]!=b[start:end]) and np.isfinite(b).all() and 0<float(np.max(np.abs(b)))<.99
rests=[]
for p in score['phrases'][2:]:
    assert sum(n['beats']+n.get('restAfter',0) for n in p['notes'])==7
    ds=json.loads((target/'phrases'/f"{p['index']+1}.ds").read_text(encoding='utf8'))[0]
    expected=p['notes'][4 if p['index']==2 else 5]
    assert expected['restAfter']==.5
    pitches=ds['note_seq'].split();durations=list(map(float,ds['note_dur'].split()))
    internal=[(i,durations[i]) for i,n in enumerate(pitches[1:-1],1) if n=='rest']
    assert len(internal)==1 and abs(internal[0][1]-.5*60/score['bpm'])<1e-6
    rests.append({'line':p['index']+1,'after':expected['lyric'],'beats':.5,'seconds':internal[0][1],'realRestInSingerInput':True})
out=ROOT/'dist/phrasing-trial';out.mkdir(exist_ok=True)
hashfile=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
if (out/'manifest.json').exists():raise RuntimeError('A published round exists; create a new round instead of overwriting judgments.')
variants=[]
ffmpeg=Path(r'D:\26project\26audio_and_video_project\ffmpeg-n6.1.3-win64-gpl-shared-6.1\bin\ffmpeg.exe')
loudness={}
for key,data,path in [('A',a,base),('B',b,target)]:
    # Same full mix gain; keeping accompaniment samples exactly equal is the priority.
    clip=data[start:];sf.write(out/(key+'.wav'),clip,sr,subtype='PCM_24')
    log=subprocess.run([str(ffmpeg),'-hide_banner','-i',str(out/(key+'.wav')),'-af','ebur128','-f','null','-'],capture_output=True,check=True,creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0).stderr.decode('utf8',errors='replace')
    loudness[key]=float(re.findall(r'I:\s*(-?[0-9.]+) LUFS',log)[-1])
    variants.append({'id':key,'file':key+'.wav','hash':hashfile(out/(key+'.wav')),'compositionId':path.name,'description':'原版：连续重复追上来，十二字一行' if key=='A' else '修改版：十字与十一字两句，按意思停顿并重写旋律','lyrics':source['lyrics'][2:] if key=='A' else ['你回头喊我，声音还没变','我笑着追过去，像放学那天']})
evidence={'baseline':base.name,'revised':target.name,'firstTwoPhrasesUnchanged':True,'unchangedAudioOutsideLastTwoPhrases':True,'sameAccompanimentBytes':True,'sameTempoAndVoice':source['music']==score['music'],'rests':rests,'clipStartSample':start,'clipDuration':len(a[start:])/sr,'integratedLufs':loudness,'fullSongHashes':{'A':hashfile(base/'song.wav'),'B':hashfile(target/'song.wav')},'humanQualityAssessment':'awaiting-user-listening'}
assert evidence['sameTempoAndVoice']
manifest={'id':'reunion-phrasing-v1','title':score['title'],'duration':len(a[start:])/sr,'bpm':score['bpm'],'factor':'lyric-phrasing','factorLabel':'词句与断句','question':'哪一版唱得更自然？','story':'你指出后两句唱得不顺、重复得有些尴尬。这次把重逢写成一个动作：朋友回头喊我，声音没变，仿佛又到了放学那天。','lyrics':score['lyrics'][2:],'preserved':['前两句完整音频','同一份伴奏','116 BPM 与绮萱声线'],'variants':variants,'evidence':evidence,'assessment':'awaiting-user-choice'}
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
(ROOT/'validation/phrasing-comparison-audio.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(evidence,ensure_ascii=False),flush=True)
