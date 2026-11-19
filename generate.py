#!/usr/bin/env python3
"""Bundle independent class contracts into components and the OurPoker recipe."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import shutil
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent
sys.path.insert(0, str(WORKSPACE / 'aepm'))
from aepm.model import canonical, digest
from aepm.foundations import validate_class_descriptor
from provenance import foundations, provenance_document


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.name == 'component.json':
        raw = canonical(value)
        if len(raw) > 1024 * 1024:
            raise ValueError(f'{path}: canonical manifest is {len(raw)} bytes')
        path.write_bytes(raw)
        return
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def class_bundle(directory):
    shutil.copyfile(ROOT / 'runtime.mjs', directory / 'runtime.mjs')
    descriptor = read(directory / 'class.json')
    prefix = 'classes/' + directory.name + '/'
    inventory = []
    for path in sorted(directory.iterdir()):
        if path.name in ('class.json', 'README.md') or not path.is_file():
            continue
        inventory.append({'path': prefix + path.name, 'digest': digest(path.read_bytes())})
    descriptor['inventory'] = inventory
    validate_class_descriptor(descriptor)
    write(directory / 'class.json', descriptor)
    reference = {key: descriptor[key] for key in ('name', 'version')}
    reference['digest'] = digest(canonical(descriptor))
    return {'reference': reference, 'descriptor': descriptor}


def bundle_into(package, bundles):
    for bundle in bundles:
        slug = bundle['descriptor']['name'].split('/')[1]
        directory = package / 'classes' / slug
        directory.mkdir(parents=True, exist_ok=True)
        for entry in bundle['descriptor']['inventory']:
            shutil.copyfile(ROOT / slug / Path(entry['path']).name, package / entry['path'])


def metadata(package, manifest, bundles, implements):
    bundle_into(package, bundles)
    manifest['classes'] = deepcopy(bundles)
    manifest['implements'] = deepcopy(implements)
    indexed = {item['path']: item for item in manifest['files']}
    if manifest['kind'] == 'component':
        sources = {item['source'] for item in manifest['artefacts']}
        for path in sorted((package / 'implementation').rglob('*')):
            if not path.is_file() or any(part in ('node_modules', '__pycache__', '.gradle', 'build') for part in path.relative_to(package).parts):
                continue
            relative = path.relative_to(package).as_posix()
            executable = bool(path.stat().st_mode & 0o111)
            indexed[relative] = {'path': relative, 'executable': executable}
            if relative not in sources:
                manifest['artefacts'].append({'source': relative, 'destination': 'components/' + package.name + '/' + relative.removeprefix('implementation/'),
                                              'template': False, 'executable': executable})
        manifest['files'] = [indexed[key] for key in sorted(indexed)]
        manifest['artefacts'].sort(key=lambda item: item['source'])
        manifest['capabilities']['writes'] = sorted({item['destination'] for item in manifest['artefacts']})
    manifest.update(foundations(package, manifest))
    provenance_document(package, manifest)
    indexed['PROVENANCE.md'] = {'path': 'PROVENANCE.md', 'executable': False}
    for bundle in bundles:
        for entry in bundle['descriptor']['inventory']:
            indexed[entry['path']] = {'path': entry['path'], 'executable': False}
    for entry in sorted((package / 'notices').rglob('*')) if (package / 'notices').exists() else []:
        if entry.is_file():
            indexed[entry.relative_to(package).as_posix()] = {'path': entry.relative_to(package).as_posix(), 'executable': False}
    manifest['files'] = [indexed[key] for key in sorted(indexed)]
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--classes-only', action='store_true')
    args = parser.parse_args()
    bundles = {p.name.removesuffix('-class'): class_bundle(p) for p in sorted(ROOT.glob('*-class'))}
    if args.classes_only:
        return
    for package in sorted((WORKSPACE / 'components').iterdir()):
        if not (package / 'component.json').is_file():
            continue
        slug = 'theme' if package.name == 'theme-high-contrast' else package.name
        bundle = bundles[slug]
        manifest = metadata(package, read(package / 'component.json'), [bundle], [bundle['reference']])
        write(package / 'component.json', manifest)
        spec_path = package / 'authoring/spec.json'
        if spec_path.is_file():
            spec = read(spec_path)
            spec.update({key: manifest[key] for key in ('toolchains', 'classes', 'implements', 'upstream', 'compatibility', 'maintenance')})
            spec.update(supportedPlatforms=manifest['platforms'], licence=manifest['identity']['licence'], licenceFile='LICENCE', noticeFile='NOTICE')
            spec['templates'] = sorted(item['source'] for item in manifest['artefacts'] if item['template'])
            spec['platforms'] = sorted({item['source'].split('/')[1] for item in manifest['artefacts'] if item['source'].startswith('implementation/')})
            if manifest['provides']:
                spec['modules'] = read(package / manifest['provides'][0]['path'])['x-ourapps-modules']
            write(spec_path, spec)
        elif (package / 'scripts/package-metadata.py').is_file():
            write(package / 'authoring/foundations.json', {key: manifest[key] for key in ('platforms', 'toolchains', 'classes', 'implements', 'upstream', 'compatibility', 'maintenance')})
    recipe = WORKSPACE / 'recipes/ourpoker'
    manifest = metadata(recipe, read(recipe / 'component.json'), list(bundles.values()), [])
    write(recipe / 'component.json', manifest)
    write(recipe / 'authoring/foundations.json', {key: manifest[key] for key in ('platforms', 'toolchains', 'classes', 'implements', 'upstream', 'compatibility', 'maintenance')})
    document = read(recipe / 'recipe.json')
    for slot in document['components']:
        slot['class'] = bundles[slot['id']]['reference']
    write(recipe / 'recipe.json', document)
    print(f'{len(bundles)} independent classes bundled into 40 components and the recipe')


if __name__ == '__main__':
    main()
