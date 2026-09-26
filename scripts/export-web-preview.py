"""Export an explicit set of demo works, never the .local directory or user records."""
import concurrent.futures
import hashlib
import json
import os
import shutil
import subprocess
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'published'
COMPOSITIONS=['940817ab-94bc-477b-87c3-ec3a09845892','566a9bad-5785-459a-8f6d-78c271e970be']
FFMPEG=os.environ.get('FFMPEG_BIN',r'D:\26project\26audio_and_video_project\ffmpeg-n6.1.3-win64-gpl-shared-6.1\bin\ffmpeg.exe')
ORIGIN=os.environ.get('SONARA_EXPORT_ORIGIN','http://127.0.0.1:4173')
assets={}
tasks=[]

def get(path):
    with urllib.request.urlopen(ORIGIN+path,timeout=20) as response:return json.load(response)

def write_json(file,value):
    file.parent.mkdir(parents=True,exist_ok=True)
    file.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')

def expose(source,target,route):
    target.parent.mkdir(parents=True,exist_ok=True)
    if source.suffix=='.wav':tasks.append((source,target))
    else:shutil.copyfile(source,target)
    assets[route]='/'+target.relative_to(ROOT).as_posix()

def compress(task):
    source,target=task
    subprocess.run([FFMPEG,'-nostdin','-hide_banner','-loglevel','error','-y','-i',str(source),'-map_metadata','-1','-codec:a','libmp3lame','-b:a','160k',str(target)],check=True,capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)

def main():
    # Only pre-existing public demonstration audio; raw masters are never edited.
    for file in sorted((ROOT/'dist').rglob('*.wav')):
        rel=file.relative_to(ROOT/'dist')
        target=OUT/'media'/rel.with_suffix('.mp3')
        expose(file,target,'/'+rel.as_posix())
        assets['/'+rel.with_suffix('.mp3').as_posix()]='/'+target.relative_to(ROOT).as_posix()
    for file in sorted((ROOT/'dist').rglob('*.mp3')):
        if not file.with_suffix('.wav').exists():expose(file,OUT/'media'/file.relative_to(ROOT/'dist'),'/'+file.relative_to(ROOT/'dist').as_posix())
    state=get('/api/compositions');jobs=[]
    for id in COMPOSITIONS:
        job=next(j for j in state['jobs'] if j['id']==id)
        if job['state']!='succeeded':raise ValueError('Only finished selected examples can be published')
        keys=['id','projectId','version','baseVersion','idea','brief','creationMode','state','stage','createdAt','message','prepared','score','scoreHash','difference','revision','result','finishedAt']
        jobs.append({k:job[k] for k in keys if k in job})
        for kind,name in {'song':'song.wav','vocal':'vocal.wav','guide':'guide.wav','backing':'accompaniment.wav','lyrics':'lyrics.txt','score':'score.json','midi':'melody.mid','arrangement':'arrangement.mid','instruments':'arrangement.json'}.items():
            source=ROOT/'.local/compositions'/id/name
            target=OUT/'compositions'/id/(kind+('.mp3' if source.suffix=='.wav' else source.suffix))
            expose(source,target,f'/api/compositions/{id}/assets/{kind}')
    state.update({'connection':{'ready':False,'message':'远端展示版 · 可试听已有作品，新创作需要本机服务'},'singerReady':False,'jobs':list(reversed(jobs))})
    for voice in state['musicCapabilities']['voices']:voice['ready']=False
    snapshots={'/api/compositions':state,'/api/music/status':{'configured':False,'message':'远端展示版未启用音乐生成；音轨编辑在浏览器内完成'},'/api/generations':[],'/api/song-phrasing':{'connection':{'ready':False},'ready':False,'jobs':[]}}
    score=get('/api/score');score.update({'ready':False,'jobs':[],'versions':[v for v in score['versions'] if v['id'] in ['A','B']],'message':'已发布的两版试唱；重新演唱需要本机环境'})
    snapshots['/api/score']=score
    for v in score['versions']:
        for kind in ['song','vocal','midi','lyrics']:
            route=f"/api/score/versions/{v['id']}/{kind}"
            if kind in ['song','vocal']:expose(ROOT/'dist/score-trial'/f"{kind}-{v['id']}.wav",OUT/'score'/f"{v['id']}-{kind}.mp3",route)
            else:
                file=OUT/'score'/f"{v['id']}-{kind}.{'mid' if kind=='midi' else 'txt'}";file.parent.mkdir(parents=True,exist_ok=True)
                with urllib.request.urlopen(ORIGIN+route,timeout=20) as response:file.write_bytes(response.read())
                assets[route]='/'+file.relative_to(ROOT).as_posix()
    project=get('/api/song-project')
    project['draft']={k:project['draft'][k] for k in ['brief','revision']};project.update({'available':False,'versions':[],'observations':[]})
    snapshots['/api/song-project']=project
    listening=get('/api/listening-trial');listening['current']=None;listening['references']=[]
    snapshots['/api/listening-trial']=listening
    for id in ['A','B']:
        route='/api/listening-trial/audio/'+id
        raw=ROOT/'.local/web-export'/f'listening-{id}.wav';raw.parent.mkdir(parents=True,exist_ok=True)
        with urllib.request.urlopen(ORIGIN+route,timeout=20) as response:raw.write_bytes(response.read())
        expose(raw,OUT/'listening'/f'{id}.mp3',route)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(compress,tasks))
    write_json(OUT/'runtime-data.json',{'mode':'preview','snapshots':snapshots,'assets':assets,'defaultComposition':COMPOSITIONS[-1]})
    inventory=[]
    for file in sorted(OUT.rglob('*')):
        if file.is_file() and file.name!='inventory.json':inventory.append({'file':file.relative_to(OUT).as_posix(),'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
    write_json(OUT/'inventory.json',{'note':'Reviewed demonstration material. MP3 preview copies, not source WAV masters. No user listening records or credentials included.','compositions':COMPOSITIONS,'files':inventory})
    print(json.dumps({'audioFiles':len(tasks),'files':len(inventory),'megabytes':round(sum(f['bytes'] for f in inventory)/1e6,1)},ensure_ascii=False))

if __name__=='__main__':main()
