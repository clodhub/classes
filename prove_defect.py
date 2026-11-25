#!/usr/bin/env python3
"""Prove the shared theme suite rejects an implementation that discards colour overrides."""
import os
import json
from pathlib import Path
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, os.environ.get('AEPM_CHECKOUT', str(ROOT.parent / 'aepm')))
from aepm.bundle import pack, read_package
from aepm.io import load, write
from aepm.model import AepmError
from aepm.recipe import Package, fit
from aepm.test_identities import generate
from aepm.trust import publish_release, publish_review
from aepm.verification import review_package


def main():
    work = Path(tempfile.mkdtemp(prefix='foundation-defect-', dir='/var/folders/yk/8tzc9b_1713dlhdp5vzkgg100000gn/T/opencode')).resolve()
    source, store = work / 'candidate', work / 'store'
    source.mkdir()
    original = pack(ROOT.parent / 'components/theme-high-contrast', work / 'source-store')
    manifest, payloads = read_package(original, work / 'source-store')
    for item in manifest['files']:
        path = source / item['path']
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payloads[item['path']])
        path.chmod(0o755 if item['executable'] else 0o644)
    tokens = source / 'implementation/web/tokens.ts'
    text = tokens.read_text()
    changed, count = re.subn(r'return "#" \+ m\[1\]\.toLowerCase\(\);', 'return "#000000";', text)
    assert count == 1
    tokens.write_text(changed)
    provider_document = source / manifest['provides'][0]['path']
    document = json.loads(provider_document.read_text())
    document['info']['description'] = 'Provider-specific explanation for the colour-override defect fixture.'
    write(provider_document, document)
    (source / 'candidate-check.mjs').write_text("import assert from 'node:assert/strict';\nimport { resolveTheme } from './implementation/server/index.ts';\nassert.equal(typeof resolveTheme, 'function');\n")
    manifest['identity']['name'] = 'clodhub/defective-theme'
    manifest['identity']['sourceRevision'] = 'colour-override-defect-fixture'
    for item in manifest['artefacts']:
        item['destination'] = item['destination'].replace('components/theme-high-contrast/', 'components/defective-theme/')
    manifest['capabilities']['writes'] = [item['destination'] for item in manifest['artefacts']]
    manifest['files'].append({'path': 'candidate-check.mjs', 'executable': False})
    manifest['verification'] = [{**manifest['verification'][0], 'id': 'candidate-check', 'argv': ['node', 'candidate-check.mjs'],
                                 'fixtures': ['candidate-check.mjs'], 'locks': [], 'prepare': []}]
    write(source / 'component.json', manifest)
    reference = pack(source, store)
    candidate_manifest, candidate_files = read_package(reference, store)
    authority_root = ROOT.parent / 'recipes/ourpoker'
    authority_manifest = load(authority_root / 'component.json')
    reasons = fit(candidate_manifest['implements'][0], Package(candidate_manifest, candidate_files.__getitem__),
                  Package(authority_manifest, lambda path: (authority_root / path).read_bytes()), ['web', 'server'])
    assert reasons == [], reasons
    policy = generate(work / 'identities')
    document = load(policy)
    document['trustedExecution'] = [reference['digest']]
    write(policy, document)
    publish_release(store, reference, work / 'identities/release.pem')
    report = review_package(reference, store, policy, True)
    own = next(item for item in report['suites'] if item['id'] == 'candidate-check')
    shared = next(item for item in report['suites'] if item['id'].startswith('class:') and item['id'].endswith(':shared'))
    assert own['status'] == 'passed', own
    assert shared['status'] == 'failed', shared
    assert report['summary']['required-local'] == 'failed'
    try:
        publish_review(store, reference, report, work / 'identities/guardian.pem', policy=policy)
    except AepmError as error:
        assert error.code == 'report-verdict', error
    else:
        raise AssertionError('a failed class report was signed')
    output = ROOT / 'proof/failing-substitute.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    write(output, {'work': str(work), 'defect': 'parseColourSetting returns black instead of the requested colour',
                   'declaredFit': reasons, 'providerDocumentIndependent': True,
                   'candidateSuite': own['status'], 'classSuite': shared['status'], 'guardianRejected': True,
                   'report': report})
    print(f'candidate check passed; shared theme behaviour failed; guardian refused: {output}')


if __name__ == '__main__':
    main()
