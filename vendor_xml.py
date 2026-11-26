#!/usr/bin/env python3
"""Bundle the exact XML parser source used by Android dependency verification."""
import os
import base64
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, os.environ.get('CLOD_CHECKOUT', str(ROOT.parent / 'clod')))
from provenance import fetch, npm_source

source = npm_source(('@xmldom/xmldom', '0.8.15'))
metadata = json.loads(fetch('https://registry.npmjs.org/@xmldom%2fxmldom/0.8.15'))
raw = fetch(metadata['dist']['tarball'])
integrity = 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode('ascii')
if integrity != source['integrity']:
    raise SystemExit('XML parser source integrity mismatch')
target = ROOT.parent / 'components/android-host/implementation/android/vendor/xmldom'
with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
    for member in archive.getmembers():
        if not member.isfile() or not member.name.startswith('package/'):
            continue
        relative = Path(member.name.removeprefix('package/'))
        if relative.is_absolute() or '..' in relative.parts:
            raise SystemExit('unsafe XML parser source path')
        if relative.parts[0] != 'lib' and relative.as_posix() not in ('package.json', 'index.d.ts', 'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'NOTICE'):
            continue
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(archive.extractfile(member).read())
print(f'XML parser {source["version"]} bundled with its supplied licence')
