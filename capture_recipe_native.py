#!/usr/bin/env python3
"""Build native dependency profiles from an assembled OurPoker application."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--app', type=Path, required=True)
parser.add_argument('--background', action='store_true')
parser.add_argument('--work', type=Path)
parser.add_argument('--verify', action='store_true')
parser.add_argument('--keep-builds', action='store_true', help='keep each profile\'s copied project and Gradle build folders')
args = parser.parse_args()
work = args.work or Path(tempfile.mkdtemp(prefix='foundation-native-profiles-', dir='/var/folders/yk/8tzc9b_1713dlhdp5vzkgg100000gn/T/opencode')).resolve()
if args.background:
    with (work / 'execution.log').open('w') as output:
        command = [sys.executable, '-B', __file__, '--app', str(args.app), '--work', str(work)] + (['--verify'] if args.verify else []) + (['--keep-builds'] if args.keep_builds else [])
        process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    print(f'process {process.pid}; work {work}')
    sys.exit(0)
sys.path.insert(0, str(ROOT / 'aepm'))
from aepm import ledger, locks, space
ledger.register(work, 'proof', purpose='OurPoker native dependency profiles', keep=True)
recipe = ROOT / 'recipes/ourpoker'
ignore = shutil.ignore_patterns('build', '.gradle', 'node_modules', 'local.properties', '.DS_Store')
java = '/Library/Java/JavaVirtualMachines/temurin-26.jdk/Contents/Home'
env = {**os.environ, 'JAVA_HOME': java, 'ANDROID_HOME': '/opt/homebrew/share/android-commandlinetools', 'PATH': java + '/bin:' + os.environ['PATH']}
paths = ['buildscript-gradle.lockfile', 'app/buildscript-gradle.lockfile', 'app/gradle.lockfile', 'gradle/verification-metadata.xml']
results = []
for profile in ('video', 'no-video'):
    # one profile's copied project and its Android build (under 0.4 GiB in the 19 November cloud-2-proof design), rounded up
    admission = space.reserve(work, 2 * space.GIB, purpose=f'OurPoker native profile {profile}')
    admission.__enter__()
    stage = work / profile
    android = stage / 'android'
    shutil.copytree(args.app / 'android', android, ignore=ignore)
    shutil.copytree(args.app / 'components', stage / 'components', ignore=ignore)
    shutil.copytree(args.app / 'server/fixtures', stage / 'server/fixtures')
    host = stage / 'components/android-host/android'
    source = ROOT / 'components/android-host/implementation/android'
    for name in ('render.ts',):
        shutil.copyfile(source / name, host / name)
    for name in ('templates', 'wrapper', 'dependencies', 'vendor'):
        shutil.copytree(source / name, host / name, dirs_exist_ok=True)
    if profile == 'no-video':
        shutil.rmtree(stage / 'components/video-calls')
        manifest = json.loads((recipe / 'component.json').read_text())
        for item in manifest['artefacts']:
            if item.get('withoutComponent') == 'video-calls' and item['source'].startswith('implementation/stand-ins/android/'):
                target = stage / item['destination']
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(recipe / item['source'], target)
    if args.verify:
        sys.path.insert(0, str(ROOT / 'aepm'))
        from aepm.application import configuration, substitute
        manifest = json.loads((recipe / 'component.json').read_text())
        definition = json.loads((args.app / '.aepm/definition.json').read_text())
        values = configuration(manifest['collect'], definition['configuration'])
        script = recipe / 'implementation/android/generate-project.ts'
        (android / 'generate-project.ts').write_text(substitute(script.read_text(), manifest['collect'], values))
        shutil.copytree(recipe / 'implementation/android/dependency-locks', android / 'dependency-locks', dirs_exist_ok=True)
    with (work / (profile + '-generate.log')).open('w') as output:
        subprocess.run(['node', 'generate-project.ts'], cwd=android, env=env, stdout=output, stderr=subprocess.STDOUT, check=True)
    command = ['./gradlew', '--no-daemon', ':app:assembleDebug', ':app:testDebugUnitTest', ':app:dependencies'] + (['--dependency-verification=strict'] if args.verify else ['--write-locks', '--write-verification-metadata', 'sha256'])
    with (work / (profile + '-gradle.log')).open('w') as output, locks.heavy('gradle', purpose=f'OurPoker native profile {profile}'):
        result = subprocess.run(command, cwd=android, env=env, stdout=output, stderr=subprocess.STDOUT)
    if result.returncode:
        raise SystemExit(f'{profile}: Gradle failed ({result.returncode}); {work / (profile + "-gradle.log")}')
    target = recipe / 'implementation/android/dependency-locks' / profile
    inventory = []
    for relative in paths:
        raw = (android / relative).read_bytes()
        destination = target / relative
        if args.verify:
            if raw != destination.read_bytes():
                raise SystemExit(f'{profile}: the build changed pinned input {relative}')
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(raw)
        inventory.append({'path': relative, 'digest': hashlib.sha256(raw).hexdigest()})
    if not args.verify:
        (target / 'inventory.json').write_text(json.dumps(inventory, indent=2) + '\n')
    results.append({'profile': profile, 'command': command, 'exitCode': result.returncode, 'inventory': inventory})
    if not args.keep_builds:
        shutil.rmtree(stage)  # the copied project and its build; the logs, pinned inputs and inventory are kept
    admission.__exit__(None, None, None)
    print(profile, 'built and unit-tested', flush=True)
target = recipe / 'implementation/apple/dependency-locks/Package.resolved'
if not args.verify:
    resolved = next((args.app / 'ios').glob('*.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'))
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(resolved, target)
    (target.parent / 'inventory.json').write_text(json.dumps([{'path': 'Package.resolved', 'digest': hashlib.sha256(target.read_bytes()).hexdigest()}], indent=2) + '\n')
proof = ROOT / ('classes/proof/native-profiles-verified.json' if args.verify else 'classes/proof/native-profiles.json')
proof.parent.mkdir(parents=True, exist_ok=True)
proof.write_text(json.dumps({'work': str(work), 'profiles': results, 'swiftResolved': str(target),
                             'generatorDigest': hashlib.sha256((recipe / 'implementation/android/generate-project.ts').read_bytes()).hexdigest(),
                             'hostRendererDigest': hashlib.sha256((ROOT / 'components/android-host/implementation/android/render.ts').read_bytes()).hexdigest()}, indent=2) + '\n')
