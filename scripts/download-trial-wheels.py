"""Fetch locked public wheels with curl when uv's network transport times out."""
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from packaging.tags import sys_tags
from packaging.utils import parse_wheel_filename

root = Path(__file__).resolve().parents[1] / '.local' / 'score-trial'
dest = root / 'wheels'
dest.mkdir(exist_ok=True)
tags = list(sys_tags())
rank = {tag: i for i, tag in enumerate(tags)}
pins = [line for line in (root / 'requirements.lock').read_text().splitlines() if '==' in line and not line.startswith('#')]

def download(pin):
    name, version = pin.split('==')
    raw = subprocess.check_output(['curl.exe', '-fLsS', '--max-time', '30', f'https://pypi.org/pypi/{name}/{version}/json'])
    entries = []
    for item in json.loads(raw)['urls']:
        if not item['filename'].endswith('.whl'):
            continue
        wheel_tags = parse_wheel_filename(item['filename'])[3]
        priority = min((rank[tag] for tag in wheel_tags if tag in rank), default=None)
        if priority is not None:
            entries.append((priority, item))
    if not entries:
        raise RuntimeError(f'No matching wheel for {pin}')
    item = min(entries, key=lambda pair: pair[0])[1]
    path = dest / item['filename']
    if not path.exists() or path.stat().st_size != item['size']:
        if item['size'] > 8*1024*1024:
            chunk_size=4*1024*1024
            parts=root/(name+'-wheel-parts'); parts.mkdir(exist_ok=True)
            def chunk(index):
                start=index*chunk_size; end=min(item['size'],start+chunk_size)-1
                part=parts/f'{index:04d}.part'; header=parts/f'{index:04d}.headers'
                if part.exists() and part.stat().st_size==end-start+1:
                    return
                subprocess.run(['curl.exe','-fLsS','--max-time','90','--retry','2','--retry-all-errors','--range',f'{start}-{end}',item['url'],'-D',str(header),'-o',str(part)],check=True)
                assert part.stat().st_size==end-start+1 and f'content-range: bytes {start}-{end}/{item["size"]}' in header.read_text().lower()
            with ThreadPoolExecutor(max_workers=6) as chunks:
                list(chunks.map(chunk,range((item['size']+chunk_size-1)//chunk_size)))
            with path.open('wb') as output:
                for index in range((item['size']+chunk_size-1)//chunk_size):
                    output.write((parts/f'{index:04d}.part').read_bytes())
        else:
            subprocess.run(['curl.exe', '-fLsS', '--max-time', '90', '--retry', '2', '--retry-all-errors', item['url'], '-o', str(path)], check=True)
    import hashlib
    if hashlib.sha256(path.read_bytes()).hexdigest() != item['digests']['sha256']:
        raise RuntimeError(f'Checksum mismatch: {path.name}')
    print(f'Verified {path.name}', flush=True)

with ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(download, pins))
