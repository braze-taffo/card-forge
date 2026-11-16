"""Record source and output hashes so publication cannot use a stale dist."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]


def hashes(paths):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(paths) if p.is_file()}


sources = [p for directory in ('src', 'public')
           for p in (root / 'web' / directory).rglob('*')]
sources += [root / 'web' / name for name in
            ('index.html', 'package.json', 'package-lock.json', 'vite.config.js')]
outputs = list((root / 'web/dist').rglob('*'))
artifact = root / 'artifacts/build.json'
artifact.parent.mkdir(exist_ok=True)
artifact.write_text(json.dumps({'sources': hashes(sources), 'outputs': hashes(outputs)}, indent=2) + '\n')
print('Build hashes recorded in artifacts/build.json')
