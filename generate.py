#!/usr/bin/env python3
"""Bundle the library's independent class contracts (tools/library.json) into its components and recipes: each component
gets the classes its authoring names in `implements`, each recipe the classes its slots name."""
import os
import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent
sys.path.insert(0, os.environ.get('CLOD_CHECKOUT', str(WORKSPACE / 'clod')))
sys.path.insert(0, str(WORKSPACE / 'tools'))
from clod.model import MANIFEST_FORMAT, canonical, digest, short_name
from clod.foundations import validate_categories, validate_class_descriptor
import library
from provenance import foundations, provenance_document


def read(path):
    return json.loads(path.read_text())


def write_bytes(path, data):
    """Writes the file only when its bytes change, so a run leaves unchanged folders untouched."""
    if path.is_file() and not path.is_symlink() and path.read_bytes() == data:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def write(path, value):
    if path.name == 'component.json':
        raw = canonical(value)
        if len(raw) > 1024 * 1024:
            raise ValueError(f'{path}: canonical manifest is {len(raw)} bytes')
        write_bytes(path, raw)
        return
    write_bytes(path, (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode())


def class_bundle(directory):
    write_bytes(directory / 'runtime.mjs', (ROOT / 'runtime.mjs').read_bytes())
    descriptor = read(directory / 'class.json')
    if short_name(descriptor['name']) != directory.name:
        raise ValueError(f'{directory.name}/class.json: the class is named {descriptor["name"]}; its folder must be its short name')
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
        slug = short_name(bundle['descriptor']['name'])
        for entry in bundle['descriptor']['inventory']:
            write_bytes(package / entry['path'], (ROOT / slug / Path(entry['path']).name).read_bytes())


RELEASE = {'channel': 'features', 'fixes': []}


def metadata(package, manifest, bundles, implements):
    """Classes, implemented interfaces, files, foundations and the release fields of a manifest. Images come from
    classes/render_images.py and vulnerability waivers from the package's authoring; both are kept as they are."""
    bundle_into(package, bundles)
    manifest['format'] = MANIFEST_FORMAT
    manifest['release'] = deepcopy(RELEASE)
    manifest.setdefault('images', [])
    manifest.setdefault('vulnerabilityWaivers', [])
    manifest['upgrade'] = {'migration': manifest['upgrade']['migration']}
    manifest['classes'] = deepcopy(bundles)
    manifest['implements'] = deepcopy(implements)
    indexed = {item['path']: item for item in manifest['files'] if (package / item['path']).is_file()}
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
    prune_notices(package, manifest)
    indexed = {path: item for path, item in indexed.items() if (package / path).is_file()}
    provenance_document(package, manifest)
    indexed['PROVENANCE.md'] = {'path': 'PROVENANCE.md', 'executable': False}
    for bundle in bundles:
        for entry in bundle['descriptor']['inventory']:
            indexed[entry['path']] = {'path': entry['path'], 'executable': False}
    for image in manifest['images']:
        indexed[image['path']] = {'path': image['path'], 'executable': False}
    if (package / 'examples/images.ts').is_file():
        indexed['examples/images.ts'] = {'path': 'examples/images.ts', 'executable': False}
    for entry in sorted((package / 'notices').rglob('*')) if (package / 'notices').exists() else []:
        if entry.is_file():
            indexed[entry.relative_to(package).as_posix()] = {'path': entry.relative_to(package).as_posix(), 'executable': False}
    manifest['files'] = [indexed[key] for key in sorted(indexed)]
    return manifest


def prune_notices(package, manifest):
    """Removes each file under notices/ that no upstream record names, such as a notice its cache entry no longer supplies."""
    folder = package / 'notices'
    if not folder.is_dir():
        return
    named = {path for entry in manifest['upstream'] for path in entry['notices']}
    for path in sorted(folder.rglob('*'), reverse=True):
        if path.is_file() and path.relative_to(package).as_posix() not in named:
            path.unlink()
        elif path.is_dir() and not any(path.iterdir()):
            path.rmdir()


def chosen(bundles, references, where):
    """The bundles of the named classes, in the order named."""
    missing = [reference['name'] for reference in references if reference['name'] not in bundles]
    if missing:
        raise SystemExit(f'{where}: no class in tools/library.json is named {", ".join(missing)}')
    return [bundles[reference['name']] for reference in references]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--classes-only', action='store_true')
    args = parser.parse_args()
    bundles = {}
    for directory in library.classes():
        bundle = class_bundle(directory)
        bundles[bundle['descriptor']['name']] = bundle
    validate_categories(read(ROOT / 'categories.json'), [bundle['descriptor']['category'] for bundle in bundles.values()])
    if args.classes_only:
        return
    components = library.components()
    for package in components:
        manifest = read(package / 'component.json')
        spec_path = package / 'authoring/spec.json'
        # The classes a component implements are named by its authoring (spec.json), else by its manifest.
        declared = read(spec_path)['implements'] if spec_path.is_file() else manifest['implements']
        implemented = chosen(bundles, declared, package.name)
        manifest = metadata(package, manifest, implemented, [bundle['reference'] for bundle in implemented])
        write(package / 'component.json', manifest)
        if spec_path.is_file():
            spec = read(spec_path)
            spec.update({key: manifest[key] for key in ('toolchains', 'classes', 'implements', 'upstream', 'compatibility', 'maintenance',
                                                        'release', 'images', 'vulnerabilityWaivers')})
            spec.update(supportedPlatforms=manifest['platforms'], licence=manifest['identity']['licence'], licenceFile='LICENCE', noticeFile='NOTICE')
            spec['templates'] = sorted(item['source'] for item in manifest['artefacts'] if item['template'])
            spec['platforms'] = sorted({item['source'].split('/')[1] for item in manifest['artefacts'] if item['source'].startswith('implementation/')})
            if manifest['provides']:
                spec['modules'] = read(package / manifest['provides'][0]['path'])['x-clodhub-modules']
            write(spec_path, spec)
        elif (package / 'scripts/package-metadata.py').is_file():
            write(package / 'authoring/foundations.json', {key: manifest[key] for key in ('platforms', 'toolchains', 'classes', 'implements', 'upstream', 'compatibility', 'maintenance',
                                                                       'release', 'images', 'vulnerabilityWaivers')})
    recipes = library.recipes()
    for recipe in recipes:
        document = read(recipe / 'recipe.json')
        # A recipe carries exactly the classes its slots name.
        names = sorted({slot['class']['name'] for slot in document['components']})
        used = chosen(bundles, [{'name': name} for name in names], recipe.name)
        manifest = metadata(recipe, read(recipe / 'component.json'), used, [])
        write(recipe / 'component.json', manifest)
        write(recipe / 'authoring/foundations.json', {key: manifest[key] for key in ('platforms', 'toolchains', 'classes', 'implements', 'upstream', 'compatibility', 'maintenance',
                                                                           'release', 'images', 'vulnerabilityWaivers')})
        for slot in document['components']:
            slot['class'] = bundles[slot['class']['name']]['reference']
        write(recipe / 'recipe.json', document)
    print(f'{len(bundles)} independent classes bundled into {len(components)} components and {len(recipes)} recipes')


if __name__ == '__main__':
    main()
