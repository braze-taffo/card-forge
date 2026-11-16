#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
while IFS= read -r -d '' source; do
  node --check "$source"
done < <(find server lab -type f -name '*.mjs' -print0)
python3 - <<'PY'
import ast
import json
from pathlib import Path
for folder in ('server', 'lab', 'scripts', 'deploy'):
    for source in Path(folder).rglob('*.py'):
        ast.parse(source.read_text(), filename=str(source))
for folder in ('server', 'lab', 'docs'):
    for source in Path(folder).glob('*.json'):
        json.loads(source.read_text())
for source in (Path('package.json'), Path('lab/manager-config.json.example'), Path('server/config.json.example')):
    json.loads(source.read_text())
print('JavaScript / Python syntax and JSON checks passed.')
PY
