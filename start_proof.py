#!/usr/bin/env python3
"""Start a local OurPoker installation proof with the installed Android and Java tools."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('answers', nargs='*', default=['default'])
parser.add_argument('--substitute', action='store_true')
parser.add_argument('--android', action='store_true')
parser.add_argument('--work', type=Path)
parser.add_argument('--keep-builds', action='store_true', help='passed to try_install.py')
args = parser.parse_args()
work = (args.work or Path(tempfile.mkdtemp(prefix='foundation-substitute-' if args.substitute else 'foundation-default-',
                                         dir='/var/folders/yk/8tzc9b_1713dlhdp5vzkgg100000gn/T/opencode'))).resolve()
command = [sys.executable, '-B', str(ROOT / 'recipes/ourpoker/authoring/try_install.py'), *args.answers, '--work', str(work)]
if args.substitute:
    version = json.loads((ROOT / 'components/theme-high-contrast/component.json').read_text())['identity']['version']
    command += ['--substitute', f'theme=clodhub/theme-high-contrast@{version}']
if args.android:
    command += ['--android']
if args.keep_builds:
    command += ['--keep-builds']
java = '/Library/Java/JavaVirtualMachines/temurin-26.jdk/Contents/Home'
env = {**os.environ, 'PYTHONPATH': os.environ.get('AEPM_CHECKOUT', str(ROOT / 'aepm')), 'PYTHONDONTWRITEBYTECODE': '1',
       'JAVA_HOME': java, 'ANDROID_HOME': '/opt/homebrew/share/android-commandlinetools',
       'PATH': java + '/bin:' + os.environ['PATH']}
with (work / 'execution.log').open('a') as output:
    process = subprocess.Popen(command, cwd=ROOT / 'recipes/ourpoker', env=env, stdout=output, stderr=subprocess.STDOUT,
                               start_new_session=True)
print(f'process {process.pid}; work {work}')
