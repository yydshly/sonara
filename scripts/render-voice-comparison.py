"""Two local voicebanks sing the same short, transposed score.

No original audio is overwritten. Predictions and model hashes accompany the
audio; successful synthesis is not a listening-quality assessment.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import time
import numpy as np
import soundfile as sf
import yaml

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'dist/youth-song'
WORK=ROOT/'.local/voice-comparison'
OUT=SOURCE/'voice-comparison-v1'
SECTIONS={'verse':('主歌 · 轻声讲述',[0,1]),'chorus':('副歌 · 长音与展开',[6,7])}
NAMES={'ria':'A · 狸安 Ria','qixuan':'B · 绮萱 Qixuan'}
SHIFT=-2

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def write_json(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')

def excerpt(score,indices):
    original=[score['phrases'][i] for i in indices]
    origin=original[0]['start'];phrases=copy.deepcopy(original)
    for p in phrases:
        p['start']-=origin;p['end']-=origin
        for n in p['notes']:
            n['start']-=origin;n['beat']-=origin*score['bpm']/60;n['midi']+=SHIFT
            n['pitch']=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n['midi']%12]+str(n['midi']//12-1)
    return {'title':score['title'],'bpm':score['bpm'],'meter':score['meter'],'key':'Bb major',
        'transposeSemitones':SHIFT,'originalStart':origin,'originalEnd':original[-1]['end'],
        'phrases':phrases,'duration':phrases[-1]['end']+1,'sampleRate':score['sampleRate']}

def set_qixuan(singer):
    bank=next(p.parent for p in (WORK/'qixuan').rglob('dsconfig.yaml') if (p.parent/'dsdur').exists())
    vocoder=bank/'dsvocoder'
    if not vocoder.exists():shutil.copytree(WORK/'vocoder',vocoder)
    dictionary_path=bank/'dsdur/dsdict-zh.yaml'
    if not dictionary_path.exists():dictionary_path=bank/'dsdict-zh.yaml'
    dictionary=yaml.load(dictionary_path.read_text(encoding='utf-8'),Loader=getattr(yaml,'CSafeLoader',yaml.SafeLoader))
    singer.bank=bank
    singer.entries={e['grapheme']:e['phonemes'] for e in dictionary['entries']}
    singer.symbol_types={s['symbol']:s['type'] for s in dictionary['symbols']}
    singer.predictor=singer.PredAll(bank)
    singer.speaker=singer.predictor.available_speakers[0] if singer.predictor.available_speakers else None
    singer.sample_rate=singer.predictor.dsvocoder.sample_rate
    # Global pauses carry language ID zero, per the multilingual model contract.
    original_predict=singer.OnnxReader.predict
    pause_ids={singer.predictor.dsacoustic.phonemes.content[p] for p in ['AP','SP']}
    def predict(self,inputs):
        if 'languages' in inputs and 'tokens' in inputs:
            inputs={**inputs,'languages':np.where(np.isin(inputs['tokens'],list(pause_ids)),0,inputs['languages']).astype(np.int64)}
        return original_predict(self,inputs)
    singer.OnnxReader.predict=predict
    return bank

def render_voice(voice):
    began=time.time();score=json.loads((SOURCE/'score.json').read_text(encoding='utf-8'))
    singer=module('comparison_singer','render-score-trial.py')
    bank=set_qixuan(singer) if voice=='qixuan' else singer.bank
    model_hashes={str(p.relative_to(bank)).replace('\\','/'):digest(p) for p in bank.rglob('*') if p.is_file() and p.suffix in {'.onnx','.emb','.yaml','.json','.txt'}}
    identity=hashlib.sha256(json.dumps(model_hashes,sort_keys=True).encode()).hexdigest()
    for section,(_,indices) in SECTIONS.items():
        clip=excerpt(score,indices);sr=clip['sampleRate'];audio=np.zeros(round(clip['duration']*sr),np.float32);evidence=[]
        for phrase in clip['phrases']:
            local=copy.deepcopy(phrase)
            for n in local['notes']:n['start']-=phrase['start']
            local['end']-=phrase['start'];local['start']=0
            raw,ds=singer.render_phrase(local,'A',cache_dir=WORK/'renders'/voice/identity[:16],cache_key=str(phrase['index']))
            expected=' '.join(['rest']+[n['pitch'] for n in phrase['notes']]+['rest'])
            assert ds['note_seq']==expected
            counts=np.fromstring(ds['ph_num'],sep=' ',dtype=int);durations=np.fromstring(ds['ph_dur'],sep=' ')
            onsets=np.cumsum(np.r_[0,durations])[np.cumsum(counts)[:-1]]
            assert np.allclose(onsets[:-1],[n['start'] for n in local['notes']],atol=1e-6,rtol=0)
            assert abs(durations.sum()-local['end'])<1e-6
            a=round(phrase['start']*sr);audio[a:a+len(raw)]=raw
            evidence.append({'phraseIndex':phrase['index'],'lyrics':phrase['lyrics'],'notes':ds['note_seq'],
                'vowelOnsetsAligned':True,'f0Hash':hashlib.sha256(ds['f0_seq'].encode()).hexdigest()})
        folder=WORK/'raw'/voice;folder.mkdir(parents=True,exist_ok=True)
        sf.write(folder/(section+'.wav'),audio,sr,subtype='FLOAT')
        write_json(folder/(section+'.json'),{'score':clip,'scoreHash':hashlib.sha256(json.dumps(clip,sort_keys=True).encode()).hexdigest(),
            'modelIdentity':identity,'modelHashes':model_hashes,'voice':voice,'evidence':evidence,'renderSeconds':round(time.time()-began,2)})
    print('VOICE_READY '+voice,flush=True)

def publish():
    score=json.loads((SOURCE/'score.json').read_text(encoding='utf-8'))
    protected={name:digest(SOURCE/name) for name in ['score.json','song.wav','vocal.wav','accompaniment.wav','vocal-alignment-v1/song.wav']}
    styles=module('comparison_styles','arrangement-styles.py')
    render=module('comparison_render','render-arrangement-study.py')
    OUT.mkdir(parents=True,exist_ok=True);sections=[]
    for section,(label,indices) in SECTIONS.items():
        clip=excerpt(score,indices);sr=clip['sampleRate'];length=round(clip['duration']*sr)
        vocals={};records={}
        for voice in NAMES:
            vocals[voice],rate=sf.read(WORK/'raw'/voice/(section+'.wav'),dtype='float64')
            records[voice]=json.loads((WORK/'raw'/voice/(section+'.json')).read_text(encoding='utf-8'))
            assert rate==sr and len(vocals[voice])==length and records[voice]['score']==clip
        assert records['ria']['scoreHash']==records['qixuan']['scoreHash']
        assert records['ria']['modelIdentity']!=records['qixuan']['modelIdentity']
        folder=OUT/section;folder.mkdir(exist_ok=True)
        start_bar=round(clip['originalStart']*score['bpm']/240)
        chords=[h['symbol'] for h in score['harmony'] if start_bar<=h['bar']<start_bar+4]
        assert len(chords)==4
        piano={'program':0,'channel':0,'pan':64,'volume':85,'notes':[]}
        for bar,chord in enumerate(chords):
            pitches=styles.CHORDS[chord]
            for i,pitch in enumerate(pitches):
                piano['notes'].append({'beat':bar*4+i*.02,'beats':3.3,'midi':pitch+SHIFT+12,'velocity':49-i*2})
        (folder/'piano.mid').write_bytes(styles.midi({'piano':piano},score['bpm'],4))
        exe=next((ROOT/'.local/arrangement-tools').glob('fluidsynth-2.6.1/**/fluidsynth.exe'))
        render.execute([exe,'-ni','-r',sr,'-g','.6','-R','0','-C','0','-T','wav','-O','float','-F',folder/'piano.wav',ROOT/'.local/arrangement-tools/GeneralUser-GS.sf2',folder/'piano.mid'])
        backing,rate=sf.read(folder/'piano.wav',dtype='float64',always_2d=True);assert rate==sr
        backing=backing[:length];assert len(backing)==length
        backing*=.04/max(np.sqrt(np.mean(backing**2)),1e-8)
        sf.write(folder/'piano.wav',backing,sr,subtype='PCM_24')
        # Match dry-voice integrated loudness via linear gain; keep one gain per clip.
        measures={}
        for voice,wav in vocals.items():
            proc=render.execute([render.FFMPEG,'-hide_banner','-i',WORK/'raw'/voice/(section+'.wav'),'-af','loudnorm=I=-23:TP=-1:LRA=11:print_format=json','-f','null','-'])
            import re
            measures[voice]=json.loads(re.findall(r'\{[^{}]*"input_i"[^{}]*\}',proc.stderr.decode(),re.S)[-1])
        target=min(-23,*[float(measures[v]['input_i'])+20*np.log10(.5/max(np.max(np.abs(w)),1e-8)) for v,w in vocals.items()])
        versions=[]
        for voice,wav in vocals.items():
            gain=10**((target-float(measures[voice]['input_i']))/20);dry=wav*gain
            mixed=backing+dry[:,None]
            assert np.isfinite(mixed).all() and np.max(np.abs(mixed))<.99
            sf.write(folder/(voice+'-vocal.wav'),dry,sr,subtype='PCM_24')
            sf.write(folder/(voice+'-song.wav'),mixed,sr,subtype='PCM_24')
            actual,_=sf.read(folder/(voice+'-song.wav'),always_2d=True)
            assert np.max(np.abs((actual-backing)-dry[:,None]))<2/2**23
            versions.append({'id':voice,'label':NAMES[voice],'gainDb':20*np.log10(gain),
                'modelIdentity':records[voice]['modelIdentity'],'evidence':records[voice]['evidence']})
        write_json(folder/'score.json',clip)
        sections.append({'id':section,'label':label,'lyrics':[p['lyrics'] for p in clip['phrases']],
            'duration':length/sr,'originalStart':clip['originalStart'],'originalEnd':clip['originalEnd'],
            'scoreHash':records['ria']['scoreHash'],'vocalTargetLufs':target,'versions':versions})
    assert protected=={name:digest(SOURCE/name) for name in protected}
    result={'id':'voice-comparison-v1','status':'rendered','assessment':'unreviewed','sampleRate':44100,
        'bpm':score['bpm'],'key':'Bb major','transposeSemitones':SHIFT,'sections':sections,
        'sameScoreAndLyrics':True,'sameBackingPerSection':True,'originalFilesUnchanged':True,
        'sourceHashes':protected,'files':{str(p.relative_to(OUT)).replace('\\','/'):digest(p) for p in OUT.rglob('*') if p.is_file() and p.suffix in {'.wav','.mid','.json'} and p.name!='result.json'},
        'scope':'Two independent DiffSinger voicebank, singing-model and vocoder chains; not different engine families.',
        'credits':{'ria':'Ria / 狸安 — RibosomeK; DiffSinger AI singing','qixuan':'绮萱 Qixuan v2.7.0 — 颜绮萱、YQ之神及制作组; DiffSinger AI singing','vocoder':'OpenVPI Community PC-NSF-HiFiGAN 2025.02; CC BY-NC-SA 4.0; local evaluation only'},
        'limitations':['No human quality verdict yet','Only two Mandarin excerpts; English and full-song quality not tested','Pitch and expression are predicted independently by each voicebank; not a timbre-only swap']}
    write_json(OUT/'result.json',result);print('STUDY_PUBLISHED',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--voice',choices=list(NAMES));parser.add_argument('--publish',action='store_true');args=parser.parse_args()
    if args.voice:render_voice(args.voice)
    if args.publish:publish()
