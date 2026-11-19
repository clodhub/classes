#!/usr/bin/env python3
"""Check byte-identical regeneration of manifests, class bundles and recipe references."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent
paths = sorted((WORKSPACE / 'components').glob('*/component.json')) + [WORKSPACE / 'recipes/ourpoker/component.json', WORKSPACE / 'recipes/ourpoker/recipe.json']
paths += sorted(ROOT.glob('*-class/class.json'))
paths += sorted((WORKSPACE / 'components').glob('*/authoring/spec.json'))
paths += sorted((WORKSPACE / 'components').glob('*/authoring/foundations.json'))
paths += sorted((WORKSPACE / 'components').glob('*/authoring/package.json'))
paths.append(WORKSPACE / 'recipes/ourpoker/authoring/foundations.json')
for path in list(paths):
    if path.name == 'component.json':
        manifest = json.loads(path.read_text())
        paths.extend(path.parent / entry['path'] for item in manifest['classes'] for entry in item['descriptor']['inventory'])
paths = sorted(set(paths))
before = {str(path.relative_to(WORKSPACE)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
subprocess.run([sys.executable, '-B', str(ROOT / 'generate.py')], cwd=WORKSPACE, check=True)
after = {str(path.relative_to(WORKSPACE)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
changed = [path for path in before if before[path] != after[path]]
assert changed == [], changed
proof = ROOT / 'proof/reproduction.json'
proof.parent.mkdir(parents=True, exist_ok=True)
proof.write_text(json.dumps({'filesChecked': len(paths), 'changed': changed, 'digests': after}, indent=2) + '\n')
print(f'{len(paths)} files reproduced byte-identically')
