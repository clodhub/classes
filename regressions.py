#!/usr/bin/env python3
"""Run component, recipe, evaluator and condition checks with retained output."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--ourapps', type=Path, required=True)
parser.add_argument('--background', action='store_true')
parser.add_argument('--work', type=Path)
args = parser.parse_args()
work = args.work or Path(tempfile.mkdtemp(prefix='foundation-regression-', dir='/var/folders/yk/8tzc9b_1713dlhdp5vzkgg100000gn/T/opencode')).resolve()
if args.background:
    with (work / 'execution.log').open('w') as output:
        process = subprocess.Popen([sys.executable, '-B', __file__, '--ourapps', str(args.ourapps), '--work', str(work)],
                                   stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    print(f'process {process.pid}; work {work}')
    sys.exit(0)
sys.path.insert(0, str(ROOT / 'aepm'))
from aepm import ledger
ledger.register(work, 'proof', purpose='component and recipe regressions', keep=True)
recipe = ROOT / 'recipes/ourpoker'
env = {**os.environ, 'PYTHONPATH': str(ROOT / 'aepm'), 'OURAPPS': str(args.ourapps), 'PYTHONDONTWRITEBYTECODE': '1'}
commands = [
    ('components', ROOT, [sys.executable, '-B', 'tools/check_component.py', '--all', '--allow-network']),
    ('node', recipe, ['node', '--test', 'tests/recipe.test.ts', 'tests/portable.test.ts']),
    ('evaluator', recipe, [sys.executable, '-B', 'tests/evaluate_recipe_test.py']),
    ('conditional', recipe, [sys.executable, '-B', 'tests/conditional_artefacts_test.py']),
    ('artefacts', recipe, [sys.executable, '-B', 'authoring/check_conditional_artefacts.py', '-v']),
    ('catalogue', recipe, ['node', 'authoring/validate_recipe.mjs']),
]
results = []
for name, cwd, command in commands:
    with (work / (name + '.log')).open('w') as output:
        result = subprocess.run(command, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT)
    results.append({'name': name, 'command': command, 'cwd': str(cwd), 'exitCode': result.returncode})
    (work / 'report.json').write_text(json.dumps(results, indent=2) + '\n')
    print(name, result.returncode, flush=True)
sys.exit(any(item['exitCode'] for item in results))
