#!/usr/bin/env python3
"""Check byte-identical regeneration of the library's manifests, class bundles and recipe references (tools/library.json)."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent
sys.path.insert(0, str(WORKSPACE / 'tools'))
import library

components, recipes = library.components(), library.recipes()
paths = [package / 'component.json' for package in components]
paths += [path for recipe in recipes for path in (recipe / 'component.json', recipe / 'recipe.json', recipe / 'authoring/foundations.json')]
paths += [directory / 'class.json' for directory in library.classes()]
paths += [path for package in components for name in ('spec.json', 'foundations.json', 'package.json')
          if (path := package / 'authoring' / name).is_file()]
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
