#!/usr/bin/env python3
"""Validate final package signatures, class results and complete local installation proofs."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent
sys.path.insert(0, str(WORKSPACE / 'aepm'))
from aepm.bundle import pack, read_package
from aepm.foundations import class_suites
from aepm.trust import REVIEW, verify, verify_package

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--default', type=Path, required=True)
parser.add_argument('--substitute', type=Path, required=True)
parser.add_argument('--regression', type=Path, required=True)
args = parser.parse_args()
read = lambda path: json.loads(path.read_text())
sources = sorted((WORKSPACE / 'components').glob('*/component.json')) + [WORKSPACE / 'recipes/ourpoker/component.json']
proof = ROOT / 'proof'
with tempfile.TemporaryDirectory() as directory:
    store = Path(directory).resolve() / 'store'
    references = {reference['name']: reference for path in sources for reference in [pack(path.parent, store)]}
    assert len(references) == 41
    results = {}
    for label, work in [('default', args.default), ('substitute', args.substitute)]:
        report = read(work / 'report.json')
        design = report['designs']['default']
        assert 'error' not in design, design
        for key in ('install', 'serverTsc', 'webTsc', 'webBuild', 'desktopWebBuild', 'androidUnitTests'):
            assert design[key] == 'passed', (label, key, design.get(key))
        assert all(platform in design['apple'] for platform in ('built', 'iOS', 'macOS', 'tvOS'))
        assert design['android'].startswith('built ')
        assert 'completed through Fold' in design['androidRun']
        assert 'completed through the browser Fold control' in design['browser']
        if label == 'substitute':
            version = read(WORKSPACE / 'components/theme-high-contrast/component.json')['identity']['version']
            assert design['substituted'] == {'theme': f'ourapps-ae/theme-high-contrast@{version}'}
        entries = {item['name']: item for item in read(work / 'store/catalogue.json')['entries']}
        count = 0
        for name, reference in references.items():
            assert entries[name]['digest'] == reference['digest'], (label, 'stale package', name)
            verify_package(reference, work / 'store', work / 'identities/policy.json')
            manifest, _ = read_package(reference, store)
            expected = class_suites(manifest)
            statement, _ = verify((work / 'store/statements' / reference['digest'] / 'guardian.dsse.json').read_bytes(), 'guardian', work / 'identities/policy.json', REVIEW)
            report_digest = statement['predicate']['inputAttestations'][0]['digest']['sha256']
            signed = read(work / 'store/reports' / (report_digest + '.json'))
            assert signed['summary']['required-local'] == 'passed', (label, name)
            suite_results = {item['id']: item['status'] for item in signed['suites']}
            for suite in expected:
                assert suite_results[suite['id']] == 'passed', (label, name, suite['id'])
            count += len(expected)
        assert count == 42, count
        screenshots = proof / 'screenshots'
        screenshots.mkdir(parents=True, exist_ok=True)
        for name in ('browser-table.png', 'browser-settled.png', 'browser-hand.json', 'android-table.png', 'android-table-settled.png', 'android-hand.json'):
            source = work / 'designs/default' / name
            assert source.is_file(), source
            shutil.copyfile(source, screenshots / (label + '-' + name))
        designs = {'default': design}
        if label == 'default':
            local = report['designs']['local-web']
            assert 'error' not in local, local
            for key in ('install', 'serverTsc', 'webTsc', 'webBuild'):
                assert local[key] == 'passed', ('local-web', key, local.get(key))
            assert 'completed through the browser Fold control' in local['browser']
            designs['local-web'] = local
        managed = {}
        for name in designs:
            app = work / 'designs' / name / 'app'
            files = read(app / '.aepm/assembly.json')['files']
            for item in files:
                target = app / item['path']
                assert not target.is_symlink() and target.is_file(), (label, name, item['path'])
                assert hashlib.sha256(target.read_bytes()).hexdigest() == item['digest'], (label, name, item['path'])
                assert bool(target.stat().st_mode & 0o111) == item['executable'], (label, name, item['path'])
            managed[name] = len(files)
        results[label] = {'work': str(work), 'packagesVerified': 41, 'classSuitesPassed': count, 'managedFilesMatched': managed, 'designs': designs}
regression = read(args.regression / 'report.json')
assert len(regression) == 6 and all(item['exitCode'] == 0 for item in regression), regression
assert read(proof / 'reproduction.json')['changed'] == []
assert len(read(proof / 'scaffolder.json')) == 34
defect = read(proof / 'failing-substitute.json')
assert defect['providerDocumentIndependent'] and defect['declaredFit'] == []
assert defect['candidateSuite'] == 'passed' and defect['classSuite'] == 'failed' and defect['guardianRejected']
native = read(proof / 'native-profiles-verified.json')
assert {item['profile'] for item in native['profiles']} == {'video', 'no-video'}
assert all(item['exitCode'] == 0 for item in native['profiles'])
output = {'status': 'partial', 'verificationScope': 'package archives, signatures, package-review class results, local runtime proofs, managed-file bytes and modes, and generated-file exclusion checks; retained whole-tree verification and signed application execution are not established',
          'retainedApplicationTreeVerification': {'status': 'blocked', 'reason': 'dependency-created symbolic links, including web/node_modules/.bin/nanoid'},
          'applicationContext': {'signedApplicationExecutionAttestations': False, 'completedHands': 'uncontested Fold settlements'},
          'classes': 39, 'providers': 40, 'packages': references,
          'installations': results, 'regression': regression, 'nativeProfiles': native,
          'limitations': ['Apple application runtime was not exercised.', 'Live video/provider behaviour was not exercised.',
                          'Windows application runtime was not exercised.', 'Standalone kotlinc component suites require the declared compiler, which is not installed; Android integration uses the locked Gradle compiler.']}
(proof / 'final-evidence.json').write_text(json.dumps(output, indent=2) + '\n')
print('package and local-proof checks passed: 41 current packages signed and verified in both stores; 42 shared package-review suites per store; retained whole-tree/application-execution acceptance remains partial')
