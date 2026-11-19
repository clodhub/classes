#!/usr/bin/env python3
"""Build the Android host's standalone consumer and retain resolved dependency declarations."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--background', action='store_true')
parser.add_argument('--work', type=Path)
parser.add_argument('--keep-builds', action='store_true', help='keep the Gradle build folders and the APK')
args = parser.parse_args()
work = args.work or Path(tempfile.mkdtemp(prefix='foundation-android-host-', dir='/var/folders/yk/8tzc9b_1713dlhdp5vzkgg100000gn/T/opencode')).resolve()
if args.background:
    with (work / 'execution.log').open('w') as output:
        process = subprocess.Popen([sys.executable, '-B', __file__, '--work', str(work)] + (['--keep-builds'] if args.keep_builds else []), stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    print(f'process {process.pid}; work {work}')
    sys.exit(0)
sys.path.insert(0, str(ROOT / 'aepm'))
from aepm import ledger, locks, space
ledger.register(work, 'proof', purpose='android-host dependency capture', keep=True)
# the Android build of the standalone consumer; under 0.4 GiB in the 19 November cloud-2-proof design, rounded up
admission = space.reserve(work, 2 * space.GIB, purpose='android-host dependency capture')
admission.__enter__()
package = ROOT / 'components/android-host'
shutil.copytree(package / 'implementation/android/src', work / 'components/android-host/android/src')
entry = (package / 'implementation/server/index.ts').as_uri()
code = f"""import {{renderAndroid,writeAndroid,writeWrapper}} from {json.dumps(entry)};
const directory = {json.dumps(str(work))};
writeAndroid(directory, renderAndroid({{packageId:'app.example.demo',applicationName:'Foundation Demo',minSdk:26}}, {{componentFolders:['components/android-host/android']}}));
writeWrapper(directory);
"""
subprocess.run(['node', '--input-type=module', '-e', code], check=True)
destination = work / 'app/src/main/java/app/example/demo/MainActivity.kt'
destination.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(package / 'examples/MainActivity.kt', destination)
init = work / 'lock-buildscript.gradle'
init.write_text('gradle.beforeProject { project -> project.buildscript.configurations.configureEach { resolutionStrategy.activateDependencyLocking() } }\n')
java = '/Library/Java/JavaVirtualMachines/temurin-26.jdk/Contents/Home'
env = {**os.environ, 'JAVA_HOME': java, 'ANDROID_HOME': '/opt/homebrew/share/android-commandlinetools', 'PATH': java + '/bin:' + os.environ['PATH']}
command = ['./gradlew', '--no-daemon', '--init-script', str(init), ':app:assembleDebug', ':app:dependencies', '--write-locks', '--write-verification-metadata', 'sha256']
with (work / 'gradle.log').open('w') as output, locks.heavy('gradle', purpose='android-host dependency capture'):
    result = subprocess.run(command, cwd=work, env=env, stdout=output, stderr=subprocess.STDOUT)
if result.returncode:
    raise SystemExit(f'Gradle failed ({result.returncode}): {work / "gradle.log"}')
target = package / 'implementation/android/dependencies'
captured = []
for path in sorted(work.rglob('*gradle.lockfile')) + [work / 'gradle/verification-metadata.xml']:
    if path.is_file():
        relative = path.relative_to(work)
        output = target / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, output)
        captured.append(relative.as_posix())
apk = work / 'app/build/outputs/apk/debug/app-debug.apk'
report = {'work': str(work), 'command': command, 'exitCode': result.returncode, 'captured': captured,
          'apk': str(apk) if args.keep_builds else None, 'apkBytes': apk.stat().st_size if apk.is_file() else None}
if not args.keep_builds:
    for relative in ('app/build', 'build', '.gradle', '.kotlin'):
        if (work / relative).is_dir() and not (work / relative).is_symlink():
            shutil.rmtree(work / relative)
proof = ROOT / 'classes/proof/android-host.json'
proof.parent.mkdir(parents=True, exist_ok=True)
proof.write_text(json.dumps(report, indent=2) + '\n')
admission.__exit__(None, None, None)
print(json.dumps(report), flush=True)
