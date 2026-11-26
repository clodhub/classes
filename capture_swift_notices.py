#!/usr/bin/env python3
"""Retain supplied Swift source and binary notices from a completed native build."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
CACHE = Path(os.environ.get('CLOD_UPSTREAM_CACHE') or ROOT / 'upstream').resolve()
sys.path.insert(0, str(ROOT.parent / 'tools'))
import library  # noqa: E402
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--app', type=Path, required=True)
parser.add_argument('--packages', type=Path, help='the cloned Swift packages: default APP/ios/build/DerivedData/SourcePackages '
                    '(INSTRUCTIONS.md build); WORK/swift-packages for a try_install.py run with --keep-builds')
args = parser.parse_args()
packages = args.packages or args.app / 'ios/build/DerivedData/SourcePackages'
if not (packages / 'checkouts').is_dir():
    raise SystemExit(f'no Swift package checkouts at {packages}: build the application first, or run try_install.py with --keep-builds and pass --packages WORK/swift-packages')
resolved = next((args.app / 'ios').glob('*.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'))
records = []
for pin in json.loads(resolved.read_text())['pins']:
    identity, version = pin['identity'], pin['state']['version']
    checkout = packages / 'checkouts' / identity
    revision = subprocess.check_output(['git', '-C', str(checkout), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != pin['state']['revision']:
        raise SystemExit(f'{identity}: checkout does not match the resolved revision')
    target = CACHE / 'swift' / identity / version / 'provided'
    notices = []
    for kind, directory in [('source', checkout), ('artifacts', packages / 'artifacts' / identity)]:
        for file in sorted(directory.rglob('*')) if directory.exists() else []:
            if file.is_file() and re.match(r'(?i)^(licen[cs]e|notice|copying|copyright|third[-_]party)', file.name):
                relative = Path(kind) / file.relative_to(directory)
                output = target / relative
                output.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(file, output)
                notices.append({'path': relative.as_posix(), 'digest': hashlib.sha256(file.read_bytes()).hexdigest()})
    records.append({'identity': identity, 'version': version, 'revision': revision, 'notices': notices})
proof = library.PROOF / 'swift-notices.json'
proof.parent.mkdir(parents=True, exist_ok=True)
proof.write_text(json.dumps(records, indent=2) + '\n')
print(f'{len(records)} resolved Swift sources; {sum(len(item["notices"]) for item in records)} supplied notice files retained')
