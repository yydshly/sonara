"""Render one immutable local edit job. Paths are supplied only by the server."""
import importlib.util
import json
import sys
import time
import hashlib
from pathlib import Path
import numpy as np
import soundfile as sf

root=Path(__file__).resolve().parents[1]
job_dir=Path(sys.argv[1]).resolve()
request=json.loads((job_dir/'request.json').read_text(encoding='utf-8'))
started=time.time()
def progress(message):
    print('SONARA_PROGRESS '+json.dumps({'message':message},ensure_ascii=False),flush=True)
try:
    progress('正在准备歌声与原版音频')
    spec=importlib.util.spec_from_file_location('sonara_score_engine',root/'scripts/render-score-trial.py')
    engine=importlib.util.module_from_spec(spec);spec.loader.exec_module(engine)
    preview_spec=importlib.util.spec_from_file_location('sonara_lyrics',root/'scripts/score-lyrics.py')
    preview=importlib.util.module_from_spec(preview_spec);preview_spec.loader.exec_module(preview)
    prepared=preview.prepare(request['lyrics'],request['pinyin'])
    index=request['lineIndex']; score=engine.score
    phrase=json.loads(json.dumps(score['phrases'][index]))
    phrase['lyrics']=prepared['lyrics']
    for note,char,py in zip(phrase['notes'],prepared['characters'],prepared['pinyin']):
        note['lyric']=char;note['pinyin']=py
    pitch=json.loads((engine.work/'rendered-phrases'/f'A-{index+1}.ds').read_text(encoding='utf-8'))[0]
    progress(f'正在重唱第 {index+1} 句，其余内容保持原样')
    raw,ds=engine.render_phrase(phrase,'A',preserved_pitch=pitch,cache_dir=job_dir/'phrase',cache_key='edit')
    assert ds['f0_seq']==pitch['f0_seq'] and ds['note_seq']==pitch['note_seq'] and ds['note_dur']==pitch['note_dur']
    progress('正在合成试听并检查保留范围')
    song,sr=sf.read(request['baseSong'],dtype='float64',always_2d=True)
    vocal,vocal_sr=sf.read(request['baseVocal'],dtype='float64')
    backing,backing_sr=sf.read(root/'dist/score-trial/accompaniment.wav',dtype='float64',always_2d=True)
    assert sr==vocal_sr==backing_sr==score['sampleRate'] and len(song)==len(vocal)==len(backing)==round(sr*score['duration'])
    start=round(phrase['start']*sr);end=round(phrase['end']*sr)
    assert len(raw)==end-start and vocal.ndim==1
    old_song=song.copy();old_vocal=vocal.copy()
    reference_rms=max(float(np.sqrt(np.mean(vocal[start:end]**2))),.035)
    gain=min(reference_rms/max(float(np.sqrt(np.mean(raw**2))),1e-6),.66/max(float(np.max(np.abs(raw))),1e-6))
    vocal[start:end]=raw.astype(np.float64)*gain
    song[start:end]=backing[start:end]+vocal[start:end,None]
    assert np.isfinite(song).all() and np.max(np.abs(song))<.99
    for name,data in [('song.wav',song),('vocal.wav',vocal)]:
        sf.write(job_dir/name,data,sr,subtype='PCM_24')
    # Verify the exported files, including quantization, rather than just memory buffers.
    exported,_=sf.read(job_dir/'song.wav',dtype='float64',always_2d=True)
    exported_vocal,_=sf.read(job_dir/'vocal.wav',dtype='float64')
    for old,new in [(old_song,exported),(old_vocal,exported_vocal)]:
        assert np.array_equal(old[:start],new[:start]) and np.array_equal(old[end:],new[end:])
    assert np.any(old_song[start:end]!=exported[start:end])
    result={'duration':score['duration'],'sampleRate':sr,'bitDepth':24,'peak':float(np.max(np.abs(exported))),
        'renderSeconds':round(time.time()-started,2),'unchangedOutsideRegion':True,'identicalPitchControl':True,
        'changedRegion':{'start':phrase['start'],'end':phrase['end']},'voice':'Ria / 狸安',
        'files':{name:hashlib.sha256((job_dir/name).read_bytes()).hexdigest() for name in ['song.wav','vocal.wav']}}
    (job_dir/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    progress('新版本已完成，原版本已保留')
except Exception:
    import traceback
    traceback.print_exc()
    sys.exit(1)
