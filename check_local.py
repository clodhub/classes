#!/usr/bin/env python3
"""Run shared checks against source checkouts for authoring feedback."""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / 'aepm'))
from aepm.foundations import module_sources
from aepm.model import canonical, digest


def main():
    failed = []
    for package in sorted((ROOT.parent / 'components').iterdir()):
        path = package / 'component.json'
        if not path.is_file():
            continue
        slug = 'theme' if package.name == 'theme-high-contrast' else package.name
        directory = ROOT / (slug + '-class')
        manifest = json.loads(path.read_text())
        descriptor = json.loads((directory / 'class.json').read_text())
        env = {**os.environ, 'AEPM_CANDIDATE_ROOT': str(package), 'AEPM_CANDIDATE_MANIFEST': str(path),
               'AEPM_CANDIDATE_DIGEST': digest(canonical(manifest)), 'AEPM_CLASS_DIGEST': digest(canonical(descriptor)),
               'AEPM_MODULE_MAP': json.dumps(module_sources(manifest, package))}
        for suite in descriptor['verification']:
            command = [suite['argv'][0], str(directory / Path(suite['argv'][1]).name), *suite['argv'][2:]]
            result = subprocess.run(command, env=env, capture_output=True, text=True)
            print(package.name, suite['id'], 'PASS' if result.returncode == 0 else 'FAIL')
            if result.returncode:
                print(result.stdout + result.stderr)
                failed.append(package.name + ':' + suite['id'])
    return bool(failed)


if __name__ == '__main__':
    sys.exit(main())
