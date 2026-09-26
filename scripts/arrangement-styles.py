"""Auditable, authored MIDI arrangements; sample rendering is a separate step.

These are authored arrangement patterns, not a free-form composition model.
All use the supplied harmonic progression and tempo. Vocals are never re-timed.
"""
import struct

STYLES = {
    'folk': {'name':'校园民谣', 'feeling':'亲近、朴素，像把往事讲给一个人听',
             'detail':'钢弦吉他分解与轻扫弦，木贝斯和稀疏打击乐'},
    'retro': {'name':'复古流行', 'feeling':'轻快里带一点怀念，脚步继续向前',
              'detail':'电钢琴切分、流动贝斯、清音吉他和完整鼓组'},
    'ballad': {'name':'温暖抒情', 'feeling':'前半克制，后半展开为温暖的祝愿',
               'detail':'钢琴留白，弦乐逐步进入，低音与鼓在后半支撑'},
    'rock': {'name':'轻快流行摇滚', 'feeling':'明亮、有冲劲',
             'detail':'电吉他切分与强拍扫弦，电贝斯八分律动和有力鼓组'},
}
CHORDS = {'C':[48,55,60,64], 'Am7':[45,52,55,60], 'F':[41,53,57,60],
          'G':[43,55,59,62], 'C/E':[40,55,60,64], 'Fmaj7':[41,53,57,60,64],
          'G7':[43,53,59,62], 'G/B':[47,55,59,62], 'Em7':[40,55,59,62],
          'Dm7':[38,53,57,60], 'Am':[45,52,57,60], 'Dm':[38,50,53,57], 'Em':[40,52,55,59]}


def arrange(chords, style):
    if style not in STYLES or any(chord not in CHORDS for chord in chords):
        raise ValueError('Unsupported arrangement style or chord')
    tracks = {}
    def track(name, program, pan=64, volume=100, channel=None):
        tracks[name]={'program':program,'pan':pan,'volume':volume,
                      'channel':len(tracks) if channel is None else channel,'notes':[]}
    def note(name, at, duration, midi, velocity):
        tracks[name]['notes'].append({'beat':round(at,5),'beats':round(duration,5),'midi':midi,'velocity':velocity})
    def chord(name, at, duration, pitches, velocity, strum=0):
        for i,pitch in enumerate(pitches):note(name,at+i*strum,duration,pitch,velocity+(i%3)-1)
    if style=='folk':
        track('steel-guitar',25,35,94);track('acoustic-bass',32,64,104);track('percussion',0,64,78,9)
    elif style=='retro':
        track('electric-piano',4,45,104);track('finger-bass',33,64,113);track('clean-guitar',27,88,76)
        track('warm-pad',89,67,56);track('drums',0,64,92,9)
    elif style=='rock':
        track('rhythm-guitar',29,36,84);track('answer-guitar',27,92,65);track('electric-bass',34,64,98);track('rock-drums',0,64,91,9)
    else:
        track('grand-piano',0,48,104);track('strings',48,74,65);track('finger-bass',33,64,86);track('drums',0,64,66,9)
    for bar, name in enumerate(chords):
        c=CHORDS[name];root=c[0] if c[0]<48 else c[0]-12;base=bar*4
        upper=c[1:];develop=bar>=len(chords)//2
        if style=='folk':
            pitches=[root+12,*[n if n>=55 else n+12 for n in upper]]
            for step,index in enumerate([0,2,1,3,0,2,3,1]):
                note('steel-guitar',base+step*.5,.88,pitches[index],67 if step%4==0 else 51+(step%3)*4)
            if develop:chord('steel-guitar',base+3,.38,pitches[1:],45,.025)
            for at,p in [(0,root),(2,root+7)]:note('acoustic-bass',base+at,1.65,p,63)
            for at in [1,3]:note('percussion',base+at,.12,37,44)
            for step in range(8):note('percussion',base+step*.5,.08,42,26 if step%2 else 34)
        elif style=='retro':
            for at,dur,vel in [(0,.55,67),(.75,.38,53),(1.5,.55,62),(2.75,.45,55),(3.5,.36,64)]:
                chord('electric-piano',base+at,dur,[n+12 for n in upper],vel)
            for at,p,dur,vel in [(0,root,.7,82),(.75,root+12,.25,65),(1.5,root+7,.35,72),(2,root,.4,78),(2.75,root+7,.32,67),(3.5,root+12,.28,73)]:
                note('finger-bass',base+at,dur,p,vel)
            for at in [.5,1.5,2.5,3.5]:chord('clean-guitar',base+at,.18,[n+12 for n in upper[-3:]],44,.012)
            if develop:chord('warm-pad',base,3.75,[n+12 for n in upper],49)
            for at in [0,1.75,2.5]:note('drums',base+at,.15,36,87)
            for at in [1,3]:note('drums',base+at,.14,38,68)
            for step in range(8):note('drums',base+step*.5,.09,42,42 if step%2 else 56)
            if bar%4==3:
                for at,p in [(3.5,45),(3.75,47)]:note('drums',base+at,.18,p,57)
        elif style=='rock':
            power=[root+12,root+19,root+24]
            for step in range(8):
                at=base+step*.5
                chord('rhythm-guitar',at,.32 if step%2 else .42,power,58 if step%2 else 75,.012)
                note('electric-bass',at,.42,root if step<6 else root+7,68 if step%2 else 79)
                note('rock-drums',at,.10,42,46 if step%2 else 61)
            for at in [0,1.5,2,2.75]:note('rock-drums',base+at,.18,36,90)
            for at in [1,3]:note('rock-drums',base+at,.18,38,84)
            if bar%4==0:note('rock-drums',base,.65,49,61)
            if bar%2==1:
                note('answer-guitar',base+3,.35,upper[-1]+12,58)
                note('answer-guitar',base+3.5,.35,upper[-2]+12,52)
            if bar%4==3:
                for at,p in [(3.25,45),(3.5,47),(3.75,50)]:note('rock-drums',base+at,.15,p,65)
        else:
            note('grand-piano',base,2.9,root+12,65)
            chord('grand-piano',base+.03,2.5,[n+12 for n in upper],57,.012)
            for step,p in enumerate(upper):note('grand-piano',base+2+step*.35,.95,p+12,48+step*3)
            if develop:
                chord('strings',base,3.92,[n+12 for n in upper],53+(bar%4)*3)
                note('finger-bass',base,3.3,root,67)
                note('drums',base,.16,36,64);note('drums',base+2,.14,38,44)
                for at in [0,1,2,3]:note('drums',base+at,.08,42,30)
            elif bar==len(chords)//2-1:
                chord('strings',base+2,1.95,[n+12 for n in upper],39)
    # Phrase-end instrumental answers leave the next vocal onset clear.
    if style=='retro':
        for bar in range(1,len(chords),2):note('electric-piano',bar*4+3.65,.25,CHORDS[chords[bar]][-1]+12,49)
    return tracks


def vlq(value):
    out=[value&127]
    while value>>7:
        value>>=7;out.insert(0,(value&127)|128)
    return bytes(out)


def midi(tracks,bpm,bars):
    tempo=round(60_000_000/bpm)
    chunks=[]
    def chunk(events):
        previous=0;data=bytearray()
        for tick,_,event in sorted(events,key=lambda e:(e[0],e[1])):
            data+=vlq(tick-previous)+event;previous=tick
        data+=b'\0\xff\x2f\0'
        return b'MTrk'+struct.pack('>I',len(data))+data
    chunks.append(chunk([(0,0,b'\xff\x51\x03'+tempo.to_bytes(3,'big')),(0,1,b'\xff\x58\x04\x04\x02\x18\x08')]))
    for name,track in tracks.items():
        channel=track['channel'];title=name.encode('ascii')
        events=[(0,-4,b'\xff\x03'+vlq(len(title))+title),(0,-3,bytes([0xc0|channel,track['program']])),
                (0,-2,bytes([0xb0|channel,10,track['pan']])),(0,-1,bytes([0xb0|channel,7,track['volume']]))]
        for n in track['notes']:
            start=round(n['beat']*960);end=round((n['beat']+n['beats'])*960)
            if not (0<=n['midi']<=127 and 0<n['velocity']<=127 and 0<=start<end<=round((bars*4+1)*960)):
                raise ValueError('Invalid MIDI note')
            events.extend([(start,1,bytes([0x90|channel,n['midi'],n['velocity']])),(end,0,bytes([0x80|channel,n['midi'],0]))])
        # A silent tail allows the last chord to release in the offline renderer.
        events.append((round((bars*4+2)*960),2,bytes([0xb0|channel,123,0])))
        chunks.append(chunk(events))
    return b'MThd'+struct.pack('>IHHH',6,1,len(chunks),960)+b''.join(chunks)
