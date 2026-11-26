#!/usr/bin/env python3
"""Run shared checks against the library's source checkouts (tools/library.json) for authoring feedback."""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, os.environ.get('CLOD_CHECKOUT', str(ROOT.parent / 'clod')))
sys.path.insert(0, str(ROOT.parent / 'tools'))
from clod.foundations import module_sources
from clod.model import canonical, digest, short_name
import library


def main():
    failed = []
    classes = {directory.name: directory for directory in library.classes()}
    for package in library.components():
        path = package / 'component.json'
        manifest = json.loads(path.read_text())
        for reference in manifest['implements']:
            directory = classes[short_name(reference['name'])]
            descriptor = json.loads((directory / 'class.json').read_text())
            env = {**os.environ, 'CLOD_CANDIDATE_ROOT': str(package), 'CLOD_CANDIDATE_MANIFEST': str(path),
                   'CLOD_CANDIDATE_DIGEST': digest(canonical(manifest)), 'CLOD_CLASS_DIGEST': digest(canonical(descriptor)),
                   'CLOD_MODULE_MAP': json.dumps(module_sources(manifest, package))}
            failed += run_suites(package, directory, descriptor, env)
    return bool(failed)


def run_suites(package, directory, descriptor, env):
    failed = []
    for suite in descriptor['verification']:
        command = [suite['argv'][0], str(directory / Path(suite['argv'][1]).name), *suite['argv'][2:]]
        result = subprocess.run(command, env=env, capture_output=True, text=True)
        print(package.name, suite['id'], 'PASS' if result.returncode == 0 else 'FAIL')
        if result.returncode:
            print(result.stdout + result.stderr)
            failed.append(package.name + ':' + suite['id'])
    return failed


if __name__ == '__main__':
    sys.exit(main())
