"""Validate rendered comparison assets without inventing listening scores."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import numpy as np
import soundfile as sf

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'dist/youth-song';OUT=SOURCE/'voice-comparison-v1'
manifest=json.loads((OUT/'result.json').read_text(encoding='utf-8'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert manifest['assessment']=='unreviewed'
for name,value in manifest['sourceHashes'].items():assert sha(SOURCE/name)==value
for name,value in manifest['files'].items():assert sha(OUT/name)==value
ffmpeg=r'D:\26project\26audio_and_video_project\ffmpeg-n6.1.3-win64-gpl-shared-6.1\bin\ffmpeg.exe'
results=[]
for section in manifest['sections']:
    folder=OUT/section['id'];score=json.loads((folder/'score.json').read_text(encoding='utf-8'))
    assert hashlib.sha256(json.dumps(score,sort_keys=True).encode()).hexdigest()==section['scoreHash']
    original_indices=[e['phraseIndex'] for e in section['versions'][0]['evidence']]
    original=json.loads((SOURCE/'score.json').read_text(encoding='utf-8'))
    for phrase,index in zip(score['phrases'],original_indices):
        before=original['phrases'][index]
        assert phrase['lyrics']==before['lyrics']
        for note,old in zip(phrase['notes'],before['notes']):
            assert note['midi']==old['midi']-2 and note['duration']==old['duration']
            assert abs(note['start']-(old['start']-score['originalStart']))<1e-8
    backing,sr=sf.read(folder/'piano.wav',always_2d=True)
    levels=[]
    for version in section['versions']:
        voice=version['id'];dry,rate=sf.read(folder/(voice+'-vocal.wav'),always_2d=True)
        mix,rate2=sf.read(folder/(voice+'-song.wav'),always_2d=True)
        assert sr==rate==rate2==44100 and len(dry)==len(mix)==len(backing)
        assert np.isfinite(mix).all() and np.max(np.abs(mix))<.99
        assert sf.info(folder/(voice+'-song.wav')).subtype=='PCM_24'
        assert np.max(np.abs(mix-dry-backing))<3/2**23
        proc=subprocess.run([ffmpeg,'-hide_banner','-i',str(folder/(voice+'-vocal.wav')),'-af','loudnorm=I=-23:TP=-1:LRA=11:print_format=json','-f','null','-'],check=True,capture_output=True)
        measurement=json.loads(re.findall(r'\{[^{}]*"input_i"[^{}]*\}',proc.stderr.decode(),re.S)[-1])
        levels.append(float(measurement['input_i']))
    assert max(levels)-min(levels)<.1
    assert sha(folder/'ria-vocal.wav')!=sha(folder/'qixuan-vocal.wav')
    results.append({'section':section['id'],'dryVoiceLufs':levels,'sameScore':True,'sameBacking':True})
print(json.dumps({'passed':True,'originalsPreserved':True,'results':results}))
