#!/usr/bin/env python3
"""Check the authoring tool against every component spec without modifying source checkouts."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(WORKSPACE / 'aepm'))
from aepm.model import canonical

loader = importlib.util.spec_from_file_location('component_scaffolder', WORKSPACE / 'tools/scaffold_component.py')
scaffolder = importlib.util.module_from_spec(loader)
loader.loader.exec_module(scaffolder)
required = {'supportedPlatforms', 'toolchains', 'templates', 'classes', 'implements', 'upstream', 'compatibility', 'maintenance'}
assert required <= scaffolder.SPEC_KEYS, sorted(required - scaffolder.SPEC_KEYS)
results = []
with tempfile.TemporaryDirectory() as directory:
    for spec_path in sorted((WORKSPACE / 'components').glob('*/authoring/spec.json')):
        source = spec_path.parent.parent
        expected = json.loads((source / 'component.json').read_text())
        target = Path(directory).resolve() / source.name
        target.mkdir()
        for entry in expected['files']:
            output = target / entry['path']
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / entry['path'], output)
            output.chmod(0o755 if entry['executable'] else 0o644)
        (target / 'authoring').mkdir()
        shutil.copyfile(spec_path, target / 'authoring/spec.json')
        documents = {name: (target / name).read_bytes() for name in ('LICENCE', 'NOTICE')}
        _, _, manifest = scaffolder.scaffold(target, target / 'authoring/spec.json', False, False)
        for name in ('platforms', 'toolchains', 'classes', 'implements', 'upstream', 'compatibility', 'maintenance'):
            assert canonical(manifest[name]) == canonical(expected[name]), (source.name, name)
        templates = lambda value: sorted(item['source'] for item in value['artefacts'] if item['template'])
        assert templates(manifest) == templates(expected), (source.name, 'templates')
        for name, raw in documents.items():
            assert (target / name).read_bytes() == raw, (source.name, name)
        assert len((target / 'component.json').read_bytes()) <= 1024 * 1024
        results.append({'component': source.name, 'foundationFields': 'matched', 'templates': 'matched', 'licences': 'unchanged'})
proof = ROOT / 'proof/scaffolder.json'
proof.parent.mkdir(parents=True, exist_ok=True)
proof.write_text(json.dumps(results, indent=2) + '\n')
print(f'{len(results)} authoring specs reproduced foundation metadata, class bundles, templates and supplied licences')
