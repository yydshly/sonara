"""Resumable, bounded downloads of the author's three release assets."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import re
import subprocess
import hashlib
import json
import sys

root = Path(__file__).resolve().parents[1] / '.local' / 'score-trial'
assets = [
    ('Ria', 'https://github.com/RibosomeK/RiaDiffSinger/releases/download/v0.4-lynxnet/Ria-v0.4-lynxnet.zip', 374655982),
    ('dsvocoder', 'https://github.com/RibosomeK/RiaDiffSinger/releases/download/v0.4-dlc/dsvocoder.zip', 52910809),
    ('dspitch', 'https://github.com/RibosomeK/RiaDiffSinger/releases/download/v0.4-dlc/dspitch.zip', 103776272),
]
step = 4 * 1024 * 1024
for name, url, size in assets:
    if len(sys.argv)>1 and name not in sys.argv[1:]:
        continue
    parts = root / f'{name}-parts'
    parts.mkdir(exist_ok=True)
    def get_chunk(index):
        start = index * step
        end = min(size, start + step) - 1
        path = parts / f'{index:04d}.part'
        if path.exists() and path.stat().st_size == end-start+1:
            return
        header = parts / f'{index:04d}.headers'
        for attempt in range(6):
            received=path.stat().st_size if path.exists() else 0
            if received==end-start+1:
                break
            pending=parts/f'{index:04d}.pending'
            actual_start=start+received
            response=subprocess.run(['curl.exe','-fLsS','--max-time','45','--range',f'{actual_start}-{end}',url,'-D',str(header),'-o',str(pending)])
            valid=header.exists() and f'content-range: bytes {actual_start}-{end}/{size}' in header.read_text().lower()
            if valid and pending.exists() and pending.stat().st_size<=end-actual_start+1:
                with path.open('ab') as output:
                    output.write(pending.read_bytes())
            if path.exists() and path.stat().st_size==end-start+1:
                break
        if not path.exists() or path.stat().st_size != end-start+1:
            raise RuntimeError(f'Incomplete range response for {name} part {index}')
        print(f'{name}: {index+1}/{(size+step-1)//step}',flush=True)
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(get_chunk,range((size+step-1)//step)))
    target = root / f'{name}.zip'
    with target.open('wb') as output:
        for index in range((size+step-1)//step):
            output.write((parts/f'{index:04d}.part').read_bytes())
    print(f'Complete {name}: {target.stat().st_size}',flush=True)
    (root/f'{name}-download.json').write_text(json.dumps({'url':url,'bytes':size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()},indent=2))
