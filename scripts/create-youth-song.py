"""Authored original song study: score -> arrangement -> local singing.

This is an explicitly authored full-song sample, not the four-line composer API.
No external audio, borrowed melody, reference singer or online generation call.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import math
import time

import numpy as np
import soundfile as sf
from pypinyin import lazy_pinyin, Style
from scipy.signal import butter, sosfilt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist' / 'youth-song'
CACHE = ROOT / '.local' / 'youth-song' / 'phrases'
SR, BPM = 44100, 82
BEAT = 60 / BPM
CHORDS = {
    'C': [48, 55, 60, 64], 'G/B': [47, 55, 59, 62],
    'Am7': [45, 52, 55, 60], 'Em7': [40, 55, 59, 62],
    'Fmaj7': [41, 53, 57, 60, 64], 'C/E': [40, 55, 60, 64],
    'Dm7': [38, 53, 57, 60], 'G': [43, 55, 59, 62],
    'G7': [43, 53, 59, 62], 'F': [41, 53, 57, 60],
}
DUR = {
    7: [.5, .5, 1, 1, .5, .5, 3],
    8: [.5, .5, 1, .5, .5, 1, 1, 2],
    9: [.5, .5, .5, .5, 1, .5, .5, 1, 2],
    10: [.5, .5, .5, .5, .5, .5, .5, .5, 1, 2],
}
VERSE_MELODY = [
    [60, 62, 64, 64, 62, 60, 59, 62],
    [60, 59, 57, 60, 62, 64, 62, 59],
    [57, 60, 65, 64, 62, 60, 62, 64],
    [62, 64, 65, 64, 62, 60, 59, 62, 62],
]
PRE_MELODY = [[64, 64, 65, 67, 65, 64, 62, 65], [62, 64, 65, 67, 69, 67, 67]]
CHORUS_MELODY = [[64, 67, 69, 67, 64, 62, 64], [65, 65, 64, 62, 64, 67, 67], [64, 67, 69, 69, 67, 64, 65], [64, 62, 60, 62, 64, 62, 59, 60]]
VERSE_CHORDS = ['C', 'G/B', 'Am7', 'Em7', 'Fmaj7', 'C/E', 'Dm7', 'G7']
CHORUS_CHORDS = ['C', 'Am7', 'F', 'G', 'C/E', 'Fmaj7', 'G7', 'C']
CHORUS_LYRICS = ['那条放学后的路', '怎么走也走不够', '把没说完的明天', '留在你回头的路口']


def write_score():
    sections, phrases, harmony = [], [], []
    bar = 0

    def section(key, name, chords, text=None, melody=None, intention=''):
        nonlocal bar
        start_bar = bar
        sections.append({'id': key, 'name': name, 'startBar': bar, 'bars': len(chords), 'start': bar*4*BEAT, 'end': (bar+len(chords))*4*BEAT, 'intention': intention, 'lyrics': text or []})
        for chord in chords:
            harmony.append({'bar': bar, 'symbol': chord, 'section': key})
            bar += 1
        if text:
            assert len(text)*2 == len(chords)
            for i, (lyric, pitches) in enumerate(zip(text, melody)):
                assert len(lyric) == len(pitches), (lyric, len(lyric), pitches)
                durations = DUR[len(lyric)]
                assert sum(durations) == 7
                start_beat = (start_bar+i*2)*4
                position = start_beat+.5
                pronunciation = lazy_pinyin(lyric, style=Style.NORMAL, v_to_u=False)
                notes = []
                for char, py, midi, beats in zip(lyric, pronunciation, pitches, durations):
                    pitch = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][midi % 12] + str(midi//12-1)
                    notes.append({'lyric': char, 'pinyin': py, 'midi': midi, 'pitch': pitch, 'beat': position, 'beats': beats, 'start': position*BEAT, 'duration': beats*BEAT})
                    position += beats
                phrases.append({'index': len(phrases), 'section': key, 'lyrics': lyric, 'start': start_beat*BEAT, 'end': (start_beat+8)*BEAT, 'notes': notes})

    section('intro', '前奏', ['C','G/B','Am7','Fmaj7'], intention='木吉他先给出节奏，钢琴提前带出副歌的旋律动机。')
    section('verse1', '主歌一 · 放学', VERSE_CHORDS, ['风把试卷吹过窗台','粉笔灰落满你刘海','一副耳机分给两人','放学铃响还舍不得摘'], VERSE_MELODY, '低一些的音区、较轻的伴奏，从两个人共享耳机的画面进入。')
    section('pre1', '预副歌 · 那时', ['Dm7','Fmaj7','G','G7'], ['那时以为夏天很长','长到足够慢慢讲'], PRE_MELODY, '旋律逐步抬高，鼓和弦乐进入，把期待引向副歌。')
    section('chorus1', '副歌 · 那条路', CHORUS_CHORDS, CHORUS_LYRICS, CHORUS_MELODY, '重复的短动机配句尾长音，让“那条放学后的路”成为记忆点。')
    section('interlude', '间奏', ['Am7','G'], intention='短暂回落，钢琴接过人声的句尾。')
    section('verse2', '主歌二 · 后来', VERSE_CHORDS, ['旧的号码早已停用','同学录在箱底泛黄','你说加班忘了吃饭','我说这里今晚风很凉'], VERSE_MELODY, '回到主歌旋律，画面转到成年；保留轻鼓推动，不完全退回前奏。')
    section('pre2', '预副歌 · 后来', ['Dm7','Fmaj7','G','G7'], ['后来才懂那段时光','短得来不及散场'], PRE_MELODY, '和第一次相同的旋律承接不同的理解，从“很长”变成“来不及”。')
    section('chorus2', '副歌 · 回望', CHORUS_CHORDS, CHORUS_LYRICS, CHORUS_MELODY, '再次唱起相同主题，让成年后的故事赋予这条路另一层含义。')
    section('bridge', '桥段 · 留言', ['Am7','Em7','Fmaj7','G7'], ['若哪天你经过旧操场','替我听一听放学的铃响'], [[69,67,64,64,62,60,62,64,64],[65,64,62,60,62,64,65,67,65,67]], '鼓暂时退出，用更疏的钢琴给一句迟来的留言留出空间。')
    section('final', '末副歌 · 祝愿', CHORUS_CHORDS, ['那条放学后的路','如今各自往前走','愿你在人海奔忙后','还有想唱就唱的自由'], [CHORUS_MELODY[0],CHORUS_MELODY[1],[64,67,69,69,67,65,64,65],[67,65,64,62,64,62,60,59,60]], '保留副歌主题，结尾换成祝愿；完整乐队回来，最后落在主音。')
    section('outro', '尾奏', ['Fmaj7','G','C','C'], intention='回到木吉他与钢琴，最后一个和弦自然收尾。')
    score = {'title':'那条放学后的路', 'subtitle':'给长大后的我们', 'bpm':BPM, 'key':'C major', 'meter':'4/4', 'sampleRate':SR, 'duration':math.ceil(bar*4*BEAT+3), 'scoreDuration':bar*4*BEAT, 'bars':bar, 'sections':sections, 'phrases':phrases, 'lyrics':[p['lyrics'] for p in phrases], 'harmony':harmony, 'authorship':'本次对话中创作的原创歌词、旋律与编配小样', 'stage':'完整结构演唱小样，等待人工试听打磨'}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT/'score.json').write_text(json.dumps(score, ensure_ascii=False, indent=2), encoding='utf-8')
    lines = [score['title'], '原创作品 · 第一稿', '']
    for s in sections:
        if s['lyrics']:
            lines += ['【'+s['name']+'】', *s['lyrics'], '']
    (OUT/'lyrics.txt').write_text('\n'.join(lines), encoding='utf-8')
    print(f'SCORE_READY {bar} bars / {len(phrases)} phrases / {score["duration"]} seconds', flush=True)
    return score


def room(signal, wet=.16):
    result = signal.copy()
    for channel in range(2):
        for delay, gain in [(0.041,.43),(.077,.33),(.131,.26),(.211,.18),(.313,.13),(.449,.09)]:
            shift = round((delay+channel*.011)*SR)
            result[shift:,channel] += signal[:-shift,1-channel]*wet*gain
    return result


def arrange(score):
    size = round(score['duration']*SR)
    stems = {k:np.zeros((size,2),np.float32) for k in ['piano','guitar','bass','drums','strings','guide']}
    rng = np.random.default_rng(902006)
    cache = {}

    def sound(kind, midi, duration):
        key = kind, midi, round(duration,3)
        if key in cache: return cache[key]
        t = np.arange(round((duration+.3)*SR), dtype=np.float32)/SR
        freq = 440*2**((midi-69)/12)
        wave = np.zeros(len(t), np.float32)
        if kind in ['piano','guitar']:
            for h in range(1,11):
                amplitude = (1/h**1.7) if kind=='piano' else (math.sin(h*.32)**2/h**1.25)
                decay = (1.0+h*.36) if kind=='piano' else (1.25+h*.65)
                # Slight inharmonicity and a very quiet beating second string.
                f = freq*h*math.sqrt(1+.00004*h*h)
                wave += amplitude*np.exp(-t*decay)*(np.sin(2*np.pi*f*t)+.14*np.sin(2*np.pi*f*1.0008*t))
            wave *= np.minimum(1,t/.005)
        elif kind=='strings':
            for h in range(1,7):
                wave += (np.sin(2*np.pi*freq*h*t+.012*np.sin(2*np.pi*4.8*t))+np.sin(2*np.pi*freq*h*1.002*t))*(.18/h**1.4)
            wave *= np.minimum(1,t/.55)
        else:
            wave = (np.sin(2*np.pi*freq*t)+.18*np.sin(2*np.pi*2*freq*t))*np.exp(-t*(1.5 if kind=='bass' else .7))*np.minimum(1,t/.012)
        release = .3 if kind!='strings' else .9
        wave *= np.clip((duration+.3-t)/release,0,1)
        cache[key] = wave
        return wave

    def add(kind, beat, duration, midi, amplitude, pan=0):
        wave = sound(kind,midi,duration*BEAT)
        start = round(beat*BEAT*SR)
        count = min(size-start,len(wave))
        if count<=0:return
        stems[kind][start:start+count,0] += wave[:count]*amplitude*math.sqrt((1-pan)/2)
        stems[kind][start:start+count,1] += wave[:count]*amplitude*math.sqrt((1+pan)/2)

    def drum(beat, kind, amplitude):
        length = .5 if kind!='hat' else .1
        t = np.arange(round(length*SR),dtype=np.float32)/SR
        noise = rng.standard_normal(len(t)).astype(np.float32)
        if kind=='kick': wave = np.sin(2*np.pi*(48*t+2.7*(1-np.exp(-t*30))))*np.exp(-t*12)
        elif kind=='snare': wave = (sosfilt(butter(1,1800,fs=SR,btype='highpass',output='sos'),noise)*.45+np.sin(2*np.pi*180*t)*.18)*np.exp(-t*26)
        else: wave=sosfilt(butter(1,6500,fs=SR,btype='highpass',output='sos'),noise)*np.exp(-t*70)*.35
        start=round(beat*BEAT*SR); count=min(len(t),size-start)
        stems['drums'][start:start+count] += (wave[:count]*amplitude)[:,None]

    for entry in score['harmony']:
        bar, chord, section = entry['bar'], CHORDS[entry['symbol']], entry['section']
        start = bar*4
        big = section.startswith('chorus') or section=='final'
        quiet = section in ['intro','verse1','bridge','outro','interlude']
        intensity = 1.13 if section=='final' else 1.0 if big else .8 if section.startswith('pre') else .65
        # Fingerpicked guitar: bass note followed by the upper chord voices.
        for step, index in enumerate([0,2,1,3,0,2,3,1]):
            add('guitar',start+step*.5,1.8,chord[index]+12,.13*intensity,-.45)
        # Low piano on strong beats, higher answers leave room for the singer.
        for pos in ([0,2] if big else [0]):
            for n in chord: add('piano',start+pos,2.7,n+12,.043*intensity,.27)
        if big or section.startswith('pre'):
            for step, n in enumerate(chord[1:]):add('piano',start+2.5+step*.25,.7,n+24,.025,.36)
        if section not in ['intro','bridge','outro']:
            add('bass',start,1.7,chord[0] if chord[0]<48 else chord[0]-12,.13*intensity)
            add('bass',start+2,1.5,chord[0] if chord[0]<48 else chord[0]-12,.105*intensity)
            if big: add('bass',start+3.5,.45,(chord[0] if chord[0]<48 else chord[0]-12)+7,.065)
        if not quiet:
            for b in [0,2]:drum(start+b,'kick',.10*intensity)
            for b in [1,3]:drum(start+b,'snare',.052*intensity)
            for h in range(8):drum(start+h*.5,'hat',(.048 if h%2==0 else .032)*intensity)
            if section=='final' and bar%4==3:
                for b in [3,3.5,3.75]:drum(start+b,'snare',.025)
        if big or section.startswith('pre'):
            for j,n in enumerate(chord[1:]):add('strings',start,3.8,n+12,.025*intensity,[-.6,0,.6,.2][j])

    # A recognizable motif appears before the words, then returns at the end.
    for start_bar in [0,58]:
        for offset,n,d in [(0,64,1),(1,67,1),(2,69,1),(3,67,1),(4,64,1),(5,62,1),(6,64,2),(8,65,1),(9,64,1),(10,62,2),(12,64,1),(13,62,1),(14,60,2)]:
            add('piano',start_bar*4+offset,d,n,.12,.15)
    for p in score['phrases']:
        for n in p['notes']:add('guide',n['beat'],n['beats']*.96,n['midi'],.15)
    for kind in ['piano','guitar','strings']:stems[kind]=room(stems[kind],.28 if kind=='piano' else .2)
    backing=sum(stems[k] for k in ['piano','guitar','bass','drums','strings'])
    guide=backing+stems['guide']
    fade=np.minimum(1,np.arange(size)/(SR*.05))*np.minimum(1,(size-np.arange(size))/(SR*2))
    for name,signal in [('accompaniment',backing),('guide',guide),*[(k,v) for k,v in stems.items() if k!='guide']]:
        signal*=fade[:,None]
        assert np.max(np.abs(signal))<.85 and np.isfinite(signal).all(), name
        sf.write(OUT/(name+'.wav'),signal,SR,subtype='PCM_24')
    print('ARRANGEMENT_READY',flush=True)


def sing(score):
    began=time.time()
    spec=importlib.util.spec_from_file_location('singer',ROOT/'scripts/render-score-trial.py')
    engine=importlib.util.module_from_spec(spec);spec.loader.exec_module(engine)
    size=round(score['duration']*SR)
    vocal=np.zeros(size,np.float32)
    # Identical rendering inputs may reuse cached raw takes; apply dynamics below.
    for p in score['phrases']:
        local=json.loads(json.dumps(p))
        for n in local['notes']:n['start']-=p['start']
        local['end']-=p['start'];local['start']=0
        fingerprint=hashlib.sha256(json.dumps({'lyrics':local['lyrics'],'notes':[(n['pinyin'],n['pitch'],n['duration']) for n in local['notes']]},ensure_ascii=False).encode()).hexdigest()[:16]
        print(f'SONG_PROGRESS {p["index"]+1}/{len(score["phrases"])} {p["lyrics"]}',flush=True)
        wav,_=engine.render_phrase(local,'A',cache_dir=CACHE,cache_key=fingerprint)
        peak=float(np.max(np.abs(wav)));rms=float(np.sqrt(np.mean(wav**2)))
        level=.11 if p['section'].startswith('verse') else .14 if p['section'].startswith('pre') else .15
        gain=min(level/max(rms,1e-6),.59/max(peak,1e-6))
        start=round(p['start']*SR);end=min(size,start+len(wav))
        vocal[start:end]=wav[:end-start]*gain
    dry=np.column_stack([vocal,vocal])
    voiced=room(dry,.26)
    backing,sr=sf.read(OUT/'accompaniment.wav',dtype='float32',always_2d=True)
    assert sr==SR and len(backing)==size
    mix=backing+voiced
    peak=float(np.max(np.abs(mix)))
    assert np.isfinite(mix).all() and .01<peak<.98, peak
    sf.write(OUT/'vocal.wav',dry,SR,subtype='PCM_24')
    sf.write(OUT/'song.wav',mix,SR,subtype='PCM_24')
    result={'status':'rendered','title':score['title'],'duration':score['duration'],'sampleRate':SR,'bitDepth':24,'peak':peak,'renderSeconds':round(time.time()-began,2),'phrases':len(score['phrases']),'voice':'Ria / 狸安','voiceAuthor':'RibosomeK','qualityAssessment':'需要人工试听，尚未判定为发行成品','arrangement':'程序按原创乐谱制作的合成器编配','files':{name:hashlib.sha256((OUT/name).read_bytes()).hexdigest() for name in ['song.wav','vocal.wav','accompaniment.wav','guide.wav','score.json']}}
    (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('stage',choices=['score','arrange','sing','all']);args=parser.parse_args()
    score=write_score() if args.stage in ['score','all'] else json.loads((OUT/'score.json').read_text(encoding='utf-8'))
    if args.stage in ['arrange','all']:arrange(score)
    if args.stage in ['sing','all']:sing(score)
