"""Download two fixed official assets with resumable ranges and published hashes."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]/'.local/voice-comparison'
ASSETS = [
    ('Qixuan-v2.7.0', 'https://github.com/yqzhishen/qixuan-diffsinger/releases/download/v2.7.0/Qixuan_v2.7.0_DiffSinger_OpenUtau.zip', 'fe8ee7c95883d327a2b7facbbe832a7a53e1344918dc791ca83fc23b08034110'),
    ('community-vocoder-2025.02', 'https://github.com/openvpi/vocoders/releases/download/pc-nsf-hifigan-44.1k-hop512-128bin-2025.02/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02.oudep', 'ba7d43142d41f6900c8264b5662ca7125a50feb8760bb8b9615c61a8f5e6902e'),
]
STEP = 4*1024*1024

def download(asset):
    name,url,expected=asset
    ROOT.mkdir(parents=True,exist_ok=True)
    target=ROOT/(name+'.zip')
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()==expected:
        return
    parts=ROOT/(name+'-parts');parts.mkdir(exist_ok=True)
    headers=subprocess.check_output(['curl.exe','-fLsS','--max-time','30','--range','0-0',url,'-D','-','-o',str(parts/'probe')],text=True)
    size=int(re.findall(r'content-range: bytes 0-0/(\d+)',headers.lower())[-1])
    def chunk(i):
        a=i*STEP;b=min(size,a+STEP)-1;path=parts/f'{i:04d}.part'
        for attempt in range(8):
            received=path.stat().st_size if path.exists() else 0
            if received==b-a+1:return
            pending=parts/f'{i:04d}.pending';header=parts/f'{i:04d}.headers';start=a+received
            subprocess.run(['curl.exe','-fLsS','--max-time','45','--range',f'{start}-{b}',url,'-D',str(header),'-o',str(pending)],capture_output=True)
            valid=header.exists() and f'content-range: bytes {start}-{b}/{size}' in header.read_text().lower()
            if valid and pending.exists() and pending.stat().st_size<=b-start+1:
                with path.open('ab') as f:f.write(pending.read_bytes())
            if path.exists() and path.stat().st_size==b-a+1:
                print(f'{name}: chunk {i+1}/{(size+STEP-1)//STEP}',flush=True);return
        raise RuntimeError(f'Incomplete {name} chunk {i}')
    with ThreadPoolExecutor(max_workers=12) as pool:list(pool.map(chunk,range((size+STEP-1)//STEP)))
    with target.open('wb') as f:
        for i in range((size+STEP-1)//STEP):f.write((parts/f'{i:04d}.part').read_bytes())
    actual=hashlib.sha256(target.read_bytes()).hexdigest()
    if actual!=expected:raise RuntimeError(f'Official hash mismatch: {name}')
    (ROOT/(name+'-download.json')).write_text(json.dumps({'url':url,'bytes':size,'sha256':actual,'officialHashVerified':True},indent=2))
    print('Verified '+name,flush=True)

if __name__=='__main__':
    with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(download,ASSETS))
