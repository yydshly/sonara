"""Render an auditable listening fixture, not an automatically approved song.

No recordings are downloaded: the diagnostic is a fresh rendering of the
opening public-domain Beethoven theme. The separate original was authored by
the assistant, with explicit syllables, melody, harmony and delivery choices.
"""
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys
import time

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist/sound-baseline-v1'
CACHE = ROOT / '.local/sound-baseline-v1'
FFMPEG = Path(r'D:\26project\26audio_and_video_project\ffmpeg-n6.1.3-win64-gpl-shared-6.1\bin\ffmpeg.exe')
SOURCE = 'https://www.beethoven.de/en/work/view/5556714292117504/?fromArchive=6192829114089472'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf8')


def syllables(text, pinyin, rows):
    assert len(text) == len(pinyin.split()) == len(rows)
    return [{'lyric': char, 'pinyin': py, 'beat': row[0], 'notes': row[1],
             'breathinessDb': row[2] if len(row) > 2 else 0,
             'velocity': row[3] if len(row) > 3 else 1}
            for char, py, row in zip(text, pinyin.split(), rows)]


def original():
    phrases = [
        {'startBeat': 3, 'endBeat': 12, 'display': '你又坐在靠窗那边',
         'intent': '轻轻认出熟悉的习惯；靠窗连贯，边字顺着旋律落下。',
         'syllables': syllables('你又坐在靠窗那边', 'ni you zuo zai kao chuang na bian', [
             (3.5, [(65,.5)], .5), (4, [(69,.5)]), (4.5, [(67,.5)]), (5, [(65,.5)]),
             (5.5, [(69,.5)]), (6, [(72,1.5)], -.5, 1.05), (7.5, [(70,.5)]),
             (8, [(69,1),(67,.5),(65,1)], .5, .95)])},
        {'startBeat': 12, 'endBeat': 20, 'display': '笑着问我这些年',
         'intent': '像面对面问候；这些年连成一句，年字留下回想的空间。',
         'syllables': syllables('笑着问我这些年', 'xiao zhe wen wo zhe xie nian', [
             (12.5, [(69,.5)]), (13, [(67,.5)]), (13.5, [(65,1)]), (14.5, [(67,.5)]),
             (15, [(69,.5)]), (15.5, [(72,.5)]), (16, [(70,.75),(69,1.25)], .5, .95)])},
        {'startBeat': 20, 'endBeat': 28, 'display': '我说日子忙了点',
         'intent': '回答时稍收回去；忙字停留，了字经过，点字不夸张。',
         'syllables': syllables('我说日子忙了点', 'wo shuo ri zi mang le dian', [
             (20.5, [(65,.5)], .5), (21, [(67,.5)]), (21.5, [(69,.5)]), (22, [(67,.5)]),
             (22.5, [(65,1.5)], -.5), (24, [(62,.5)]), (24.5, [(65,1),(67,1)], .5, .95)])},
        {'startBeat': 28, 'endBeat': 39, 'display': '你笑起来，还像从前',
         'intent': '笑起来展开到全段最高点；停半拍，再把从前轻轻落稳。',
         'syllables': syllables('你笑起来还像从前', 'ni xiao qi lai hai xiang cong qian', [
             (28.5, [(69,.5)]), (29, [(72,1.5)], -.5, 1.05), (30.5, [(74,.5)], -.5, 1.05),
             (31, [(72,1)]), (32.5, [(70,.5)]), (33, [(69,1)]), (34, [(67,.5)]),
             (34.5, [(67,.75),(65,2.25)], .5, .95)])},
    ]
    return {'id': 'window-reunion-v1', 'title': '靠窗那边', 'bpm': 108,
            'key': 'F 大调', 'sampleRate': 44100, 'duration': 40*60/108+1.2,
            'voice': 'qixuan', 'phrases': phrases,
            'brief': '多年后的重逢，从靠窗的习惯认出老朋友；轻快、亲近，结尾温暖，不强加悲伤。',
            'authorship': '本轮由对话模型编写词曲、演唱指令与编配；未经过独立音乐人审阅。',
            'assessment': 'awaiting-user-listening'}


def reference(transpose=0):
    pitches = [64,64,65,67,67,65,64,62,60,60,62,64,64,62,62]
    durations = [1]*12 + [1.5,.5,2]
    beat = .5
    items = []
    for pitch, duration in zip(pitches, durations):
        items.append({'lyric': '啦', 'pinyin': 'la', 'beat': beat, 'notes': [(pitch+transpose,duration)]})
        beat += duration
    return {'id': 'ode-reference-'+str(transpose), 'title': '《欢乐颂》主题开头 · 啦音检查',
            'bpm': 108, 'duration': 17*60/108, 'sampleRate': 44100,
            'phrases': [{'startBeat': 0, 'endBeat': 17, 'display': '啦音旋律检查', 'syllables': items}],
            'source': SOURCE, 'transposeSemitones': transpose,
            'purpose': '仅检查熟悉旋律的演唱与声区差异，不作为原创，不推断中文咬字或产品质量已通过。'}


def render_instruments(score, name, tracks):
    styles = load('arrangements', 'arrangement-styles.py')
    tools = ROOT / '.local/arrangement-tools'
    bank = tools / 'GeneralUser-GS.sf2'
    assert hashlib.sha256(bank.read_bytes()).hexdigest() == '9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe'
    exe = next(tools.glob('fluidsynth-2.6.1/**/fluidsynth.exe'))
    midi = OUT / (name+'.mid')
    midi.write_bytes(styles.midi(tracks, score['bpm'], math.ceil(score['duration']*score['bpm']/240)))
    target = CACHE / (name+'-raw.wav')
    proc = subprocess.run([str(exe), '-ni', '-r', '44100', '-g', '.6', '-R', '0', '-C', '0', '-T', 'wav', '-O', 'float', '-F', str(target), str(bank), str(midi)], capture_output=True, check=True, timeout=90, creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
    (CACHE/(name+'.log')).write_bytes(proc.stdout+proc.stderr)
    raw, rate = sf.read(target, always_2d=True)
    assert rate == 44100 and np.isfinite(raw).all()
    size = round(score['duration'] * rate)
    data = np.zeros((size,2)); data[:min(size,len(raw))] = raw[:size]
    data[-22050:] *= np.linspace(1,0,22050)[:,None]
    return data


def guide(score):
    notes = []
    for phrase in score['phrases']:
        for syl in phrase['syllables']:
            cursor = syl['beat']
            for pitch,duration in syl['notes']:
                notes.append({'beat': cursor, 'beats': duration*.92, 'midi': pitch, 'velocity': 73})
                cursor += duration
    return {'piano-melody': {'program': 0, 'channel': 0, 'pan': 64, 'volume': 100, 'notes': notes}}


def backing(score):
    tracks = {
        'piano': {'program': 0, 'channel': 0, 'pan': 46, 'volume': 92, 'notes': []},
        'acoustic-bass': {'program': 32, 'channel': 1, 'pan': 64, 'volume': 99, 'notes': []},
        'nylon-guitar': {'program': 24, 'channel': 2, 'pan': 84, 'volume': 77, 'notes': []},
        'soft-drums': {'program': 0, 'channel': 9, 'pan': 64, 'volume': 68, 'notes': []}}
    def note(track, beat, duration, midi, velocity):
        tracks[track]['notes'].append({'beat': beat, 'beats': duration, 'midi': midi, 'velocity': velocity})
    harmonies = [(0,4,'Fmaj7',[41,57,60,64]), (4,4,'F/A',[45,57,60,65]),
                 (8,4,'Bbmaj7',[46,57,62,65]), (12,4,'F/A',[45,57,60,65]),
                 (16,4,'Dm7',[38,57,60,65]), (20,4,'Bbmaj7',[46,57,62,65]),
                 (24,4,'Gm7',[43,58,62,65]), (28,4,'Dm7',[38,57,60,65]),
                 (32,2,'Gm7',[43,58,62,65]), (34,1.25,'C7',[36,58,62,64]),
                 (35.25,4.75,'F',[41,57,60,65])]
    for at,duration,label,voicing in harmonies:
        note('acoustic-bass',at,min(duration-.1,1.65),voicing[0],64 if at<28 else 70)
        for index,pitch in enumerate(voicing[1:]):
            note('piano',at+.015*index,min(duration-.06,1.65),pitch,51+index*2)
        if duration>=4:
            note('acoustic-bass',at+2,1.35,voicing[0]+7,54)
            # Short piano responses occur only in the singer's phrase-end gaps.
            for step,pitch in enumerate(voicing[1:]):
                note('nylon-guitar',at+1.5+step*.5,.48,pitch+12,42+(step%2)*5)
    for at,pitches in [(10.6,[65,69]), (18.1,[69,67]), (26.7,[67,69])]:
        for j,pitch in enumerate(pitches): note('piano',at+j*.4,.32,pitch,51)
    # A pulse under the whole excerpt; stronger backbeat only as the smile opens.
    for bar in range(1,9):
        base=bar*4
        for at in [0,2]: note('soft-drums',base+at,.12,36,48 if bar<7 else 63)
        for at in [1,3]: note('soft-drums',base+at,.12,37,43 if bar<7 else 53)
        for step in range(8): note('soft-drums',base+step*.5,.07,42,25 if step%2 else 35)
    dump(OUT/'arrangement.json', {'harmonies': harmonies, 'tracks': tracks,
         'intent': '钢琴、尼龙吉他、木贝斯与轻鼓；句尾回应避开下一句，末句展开后收束。',
         'source': '本轮针对上述主唱谱面编写，不代表平台已具备任意风格自动编配。'})
    return tracks


def loudness(data, target=-21):
    raw = CACHE / 'meter-input.wav'
    sf.write(raw,data,44100,subtype='FLOAT')
    p = subprocess.run([str(FFMPEG),'-hide_banner','-i',str(raw),'-af',f'loudnorm=I={target}:TP=-1.5:LRA=11:print_format=json','-f','null','-'], capture_output=True, check=True, creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
    log=p.stderr.decode(errors='replace'); value=json.loads(log[log.rfind('{'):log.rfind('}')+1])
    gain=min(10**((target-float(value['input_i']))/20),.88/max(float(np.max(np.abs(data))),1e-6))
    return data*gain, {'inputLufs':float(value['input_i']), 'linearGain':gain, 'targetLufs':target, 'peakLimited': gain < 10**((target-float(value['input_i']))/20)-1e-8}


def main():
    started=time.time()
    OUT.mkdir(exist_ok=True); CACHE.mkdir(parents=True,exist_ok=True)
    if (OUT/'manifest.json').exists():
        raise RuntimeError('Published baseline exists; create another version instead of overwriting.')
    profiles=load('profiles','local-singer-profile.py')
    spec=importlib.util.spec_from_file_location('engine',ROOT/'scripts/render-score-trial.py')
    engine=importlib.util.module_from_spec(spec);engine.bank_override=profiles.profile('qixuan')['bank'];spec.loader.exec_module(engine)
    profiles.configure(engine,'qixuan')
    compiler=load('compiler','performance-score.py')
    evidence={'engine':'DiffSinger / Qixuan v2.7.0', 'voiceIdentity':engine.voice_identity,
              'qualityAssessment':'awaiting-user-listening', 'reviewer':'结构检查由本轮模型及程序完成，未经过独立音乐人审阅。', 'rendered':[]}
    score=original();dump(OUT/'score.json',score)
    studies=[('reference-low',reference()),('reference-high',reference(5)),('original',score)]
    meters={}
    for name,piece in studies:
        vocal=np.zeros(round(piece['duration']*44100))
        controls_used=[]; slurs=0
        for index,p in enumerate(piece['phrases']):
            ds,notes=compiler.compile_phrase(p,piece['bpm'],engine.entries,engine.symbol_types,engine.alignment.align_groups)
            phrase={'index':index,'start':p['startBeat']*60/piece['bpm'],'end':p['endBeat']*60/piece['bpm'], 'lyrics':''.join(s['lyric'] for s in p['syllables']),'notes':notes}
            controls=None
            if name=='original':
                controls={key:[p['syllables'][n['syllable']][key] for n in notes] for key in ['breathinessDb','velocity']}
            raw,rendered=engine.render_phrase(phrase,'A',cache_dir=CACHE/name,cache_key=str(index+1),prepared_ds=ds,controls=controls)
            start=round(phrase['start']*44100);vocal[start:start+len(raw)]+=raw
            expected=compiler.word_durations(rendered)
            assert abs(sum(map(float,rendered['ph_dur'].split()))-sum(expected))<1e-5
            slurs+=sum(map(int,rendered['note_slur'].split()))
            if controls:controls_used.append(json.loads((CACHE/name/f'{index+1}.expression.json').read_text(encoding='utf8')))
        vocal,meters[name]=loudness(vocal,-21)
        sf.write(OUT/(name+'-vocal.wav'),vocal,44100,subtype='PCM_24')
        piano=render_instruments(piece,name+'-melody',guide(piece));piano,meter=loudness(piano,-21)
        sf.write(OUT/(name+'-melody.wav'),piano,44100,subtype='PCM_24')
        record={'name':name,'seconds':len(vocal)/44100,'continuationNotes':slurs,'controls':controls_used,'meter':meters[name]}
        if name=='original':
            accompaniment=render_instruments(piece,'original-accompaniment',backing(piece));accompaniment,back_meter=loudness(accompaniment,-28)
            song=accompaniment+vocal[:,None]
            common=min(1,.95/max(np.max(np.abs(song)),1e-8))
            song*=common;vocal*=common;accompaniment*=common
            for kind,audio in [('mix',song),('vocal',vocal),('accompaniment',accompaniment)]:
                sf.write(OUT/('original-'+kind+'.wav'),audio,44100,subtype='PCM_24')
            record['mixPeak']=float(np.max(np.abs(song)));record['mixCommonGain']=common
            record['backingMeter']=back_meter
            record['mixedVocalIdenticalToDry']=bool(np.allclose(song-accompaniment,vocal[:,None],atol=1e-12))
        else:dump(OUT/(name+'-score.json'),piece)
        evidence['rendered'].append(record)
        print('READY '+name,flush=True)
    evidence['renderSeconds']=round(time.time()-started,2)
    files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.iterdir() if p.suffix in ['.wav','.json','.mid']}
    evidence['files']=files
    manifest={'id':'sound-baseline-v1','title':score['title'],'bpm':score['bpm'],'key':score['key'],
              'duration':score['duration'],'brief':score['brief'],'lyrics':[p['display'] for p in score['phrases']],
              'phrases':[{'start':p['syllables'][0]['beat']*60/score['bpm'],'end':p['endBeat']*60/score['bpm'],'text':p['display'],'intent':p['intent']} for p in score['phrases']],
              'assessment':'awaiting-user-listening','authorship':score['authorship'],'referenceSource':SOURCE,
              'files':files,'evidence':evidence}
    dump(ROOT/'validation/sound-baseline-audio.json',evidence)
    dump(OUT/'manifest.json',manifest)
    print(json.dumps({'status':'rendered','duration':score['duration'],'secondsSpent':evidence['renderSeconds'],'assessment':manifest['assessment']},ensure_ascii=False),flush=True)


if __name__=='__main__':main()
