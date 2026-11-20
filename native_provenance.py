"""Bind native dependency declarations to packaged resolved locks and checksum inventories."""
from concurrent.futures import ThreadPoolExecutor
import json
import io
import os
from pathlib import Path
import re
import threading
import zipfile
from urllib.parse import quote
from xml.etree import ElementTree as ET

from aepm.model import digest
from provenance import CACHE, fetch, read, write

GRADLE_NS = {'g': 'https://schema.gradle.org/dependency-verification'}


def pom_root(raw):
    root = ET.fromstring(raw)
    for element in root.iter():
        element.tag = element.tag.removeprefix('{http://maven.apache.org/POM/4.0.0}')
    return root


def text_at(root, path):
    element = root.find(path.replace('m:', ''))
    return element.text.strip() if element is not None and element.text else None


def licence_id(name, url):
    value = (str(name) + ' ' + str(url)).lower()
    if 'apache' in value and ('2.0' in value or '2.0' in str(url)):
        return 'Apache-2.0'
    if 'mit' in value:
        return 'MIT'
    if 'bsd' in value and ('3-clause' in value or 'new bsd' in value or 'revised bsd' in value):
        return 'BSD-3-Clause'
    if 'bsd' in value and '2-clause' in value:
        return 'BSD-2-Clause'
    if 'eclipse public' in value or 'epl' in value:
        return 'EPL-2.0' if '2.0' in value else 'EPL-1.0'
    if 'mozilla' in value and '2.0' in value:
        return 'MPL-2.0'
    if 'public domain' in value or 'unlicense' in value:
        return 'Unlicense'
    if name:
        return 'LicenseRef-' + re.sub(r'[^A-Za-z0-9.-]+', '-', name).strip('-')
    raise ValueError(f'upstream licence declaration has no name: {url}')


def pom_bytes(group, name, version):
    relative = '/'.join([group.replace('.', '/'), name, version, name + '-' + version + '.pom'])
    cached = Path.home() / '.gradle/caches/modules-2/files-2.1' / group / name / version
    for file in cached.glob('*/*.pom'):
        return file.read_bytes()
    errors = []
    for base in ('https://dl.google.com/dl/android/maven2/', 'https://repo.maven.apache.org/maven2/', 'https://jitpack.io/'):
        try:
            return fetch(base + relative)
        except Exception as error:
            errors.append(str(error))
    raise ValueError(f'{group}:{name}:{version}: cannot retrieve POM: {errors}')


def source_notice(coordinate):
    group, name, version = coordinate
    relative = '/'.join([group.replace('.', '/'), name, version, name + '-' + version + '-sources.jar'])
    for base in ('https://repo.maven.apache.org/maven2/', 'https://dl.google.com/dl/android/maven2/'):
        try:
            archive = zipfile.ZipFile(io.BytesIO(fetch(base + relative)))
        except Exception:
            continue
        for filename in archive.namelist():
            if not filename.endswith(('.java', '.kt', 'LICENSE', 'LICENSE.txt')):
                continue
            content = archive.read(filename)
            if b'Licensed under the Apache License, Version 2.0' in content:
                return 'Apache-2.0', ('source-' + Path(filename).name, content)
            if b'Permission is hereby granted, free of charge' in content:
                return 'MIT', ('source-' + Path(filename).name, content)
    raise ValueError(f'{group}:{name}:{version}: no supplied licence declaration or source notice')


def maven_source(coordinate):
    group, name, version = coordinate
    directory = CACHE / 'maven' / group / name / version
    if (directory / 'source.json').exists():
        source = read(directory / 'source.json')
        cached_pom = pom_root((directory / 'pom.xml').read_bytes())
        declared = cached_pom.findall('licenses/license')
        if declared:
            source['licence'] = ' AND '.join(dict.fromkeys(licence_id(text_at(item, 'm:name'), text_at(item, 'm:url')) for item in declared))
            write(directory / 'source.json', source)
        elif (parent := cached_pom.find('parent')) is not None:
            source['licence'] = maven_source(tuple(text_at(parent, 'm:' + key) for key in ('groupId', 'artifactId', 'version')))['licence']
            write(directory / 'source.json', source)
        return source
    raw = pom_bytes(*coordinate)
    pom = pom_root(raw)
    licences = pom.findall('licenses/license')
    notice = [('pom.xml', raw)]
    parent = pom.find('parent')
    if not licences and parent is not None:
        parent_pin = tuple(text_at(parent, 'm:' + key) for key in ('groupId', 'artifactId', 'version'))
        parent_source = maven_source(parent_pin)
        expression = parent_source['licence']
        parent_dir = CACHE / 'maven' / parent_pin[0] / parent_pin[1] / parent_pin[2]
        for index, filename in enumerate(parent_source['notices']):
            notice.append((f'parent-{index}-{filename}', (parent_dir / filename).read_bytes()))
    elif licences:
        expression = ' AND '.join(dict.fromkeys(licence_id(text_at(item, 'm:name'), text_at(item, 'm:url')) for item in licences))
    else:
        if name.endswith('.gradle.plugin') and text_at(pom, 'm:packaging') == 'pom':
            expression = 'NOASSERTION'
        else:
            expression, source = source_notice(coordinate)
            notice.append(source)
    repository = text_at(pom, 'm:scm/m:url') or text_at(pom, 'm:url')
    repository = (repository or 'https://repo.maven.apache.org/maven2/' + group.replace('.', '/') + '/' + name).removeprefix('scm:git:').removeprefix('git+').replace('git://', 'https://')
    if not repository.startswith('https://') or '${' in repository:
        repository = 'https://repo.maven.apache.org/maven2/' + group.replace('.', '/') + '/' + name
    directory.mkdir(parents=True, exist_ok=True)
    for filename, content in notice:
        # Atomic, because parallel captures of packages with a shared parent read this file while it is written.
        partial = directory / (filename + '.partial-' + str(threading.get_ident()))
        partial.write_bytes(content)
        os.replace(partial, directory / filename)
    source = {'name': name, 'version': version, 'revision': None, 'repository': repository,
              'purl': 'pkg:maven/' + group + '/' + name + '@' + version, 'licence': expression,
              'notices': [item[0] for item in notice]}
    write(directory / 'source.json', source)
    return source


def swift_namespace(repository):
    """`github.com/<owner>/<repo>` for a Swift package repository address, as the Swift purl type requires."""
    match = re.fullmatch(r'https://(github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?', repository)
    if match is None:
        raise ValueError(f'{repository}: a Swift package must come from a github.com repository')
    return match.group(1)


def swift_sources(package, files):
    result = []
    for path in files:
        if not path.endswith('Package.resolved'):
            continue
        lock = package / path
        for pin in read(lock)['pins']:
            identity, revision, version, repository = pin['identity'], pin['state']['revision'], pin['state']['version'], pin['location']
            directory = CACHE / 'swift' / identity / version
            if not (directory / 'LICENSE').exists():
                project = repository.removeprefix('https://github.com/').removesuffix('.git')
                content = fetch(f'https://raw.githubusercontent.com/{project}/{revision}/LICENSE')
                directory.mkdir(parents=True, exist_ok=True)
                (directory / 'LICENSE').write_bytes(content)
            content = (directory / 'LICENSE').read_bytes()
            expression = 'Apache-2.0' if b'Apache License' in content else 'MIT' if b'MIT License' in content else 'BSD-3-Clause' if b'Neither the name' in content else None
            if expression is None:
                raise ValueError(f'{identity}: classify the supplied licence explicitly')
            notice = package / 'notices/swift' / identity / version / 'LICENSE'
            notice.parent.mkdir(parents=True, exist_ok=True)
            notice.write_bytes(content)
            notice_paths = [notice.relative_to(package).as_posix()]
            expressions = {expression}
            for supplied in sorted((directory / 'provided').rglob('*')) if (directory / 'provided').exists() else []:
                if not supplied.is_file():
                    continue
                target = notice.parent / supplied.relative_to(directory)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(supplied.read_bytes())
                notice_paths.append(target.relative_to(package).as_posix())
                raw = supplied.read_bytes()
                if b'Neither the name' in raw and b'Redistribution' in raw:
                    expressions.add('BSD-3-Clause')
                if b'MIT License' in raw:
                    expressions.add('MIT')
                if b'Apache License' in raw:
                    expressions.add('Apache-2.0')
            result.append({'name': identity, 'version': version, 'revision': revision, 'repository': repository,
                           'purl': 'pkg:swift/' + swift_namespace(repository) + '@' + version, 'licence': ' AND '.join(sorted(expressions)),
                           'notices': notice_paths, 'delivery': {
                               'kind': 'build-time', 'manager': 'swift', 'lock': path, 'digest': digest(lock.read_bytes())}})
    return result


def gradle_sources(package, files):
    result = []
    for path in files:
        if not path.endswith('gradle.lockfile'):
            continue
        lock = package / path
        verification = next((parent / 'gradle/verification-metadata.xml' for parent in lock.parents if parent.is_relative_to(package) and (parent / 'gradle/verification-metadata.xml').is_file()), None)
        if verification is None:
            raise ValueError(f'{lock}: missing Gradle checksum inventory')
        xml = ET.fromstring(verification.read_bytes())
        checksums = {}
        for item in xml.findall('g:components/g:component', GRADLE_NS):
            coordinate = (item.attrib['group'], item.attrib['name'], item.attrib['version'])
            artifacts = []
            for artifact in item.findall('g:artifact', GRADLE_NS):
                checksum = artifact.find('g:sha256', GRADLE_NS)
                if checksum is None:
                    raise ValueError(f'{coordinate}: no SHA-256 for {artifact.attrib["name"]}')
                artifacts.append({'name': artifact.attrib['name'], 'digest': checksum.attrib['value']})
            checksums[coordinate] = artifacts
        pins = []
        for line in lock.read_text().splitlines():
            if not line or line.startswith('#') or line.startswith('empty='):
                continue
            coordinate, configurations = line.split('=', 1)
            pin = tuple(coordinate.split(':'))
            if pin not in checksums or not checksums[pin]:
                raise ValueError(f'{coordinate}: no matching checksum component')
            pins.append((pin, configurations.split(',')))
        with ThreadPoolExecutor(max_workers=12) as pool:
            sources = list(pool.map(maven_source, [pin for pin, _ in pins]))
        for (pin, configurations), source in zip(pins, sources):
            directory = CACHE / 'maven' / pin[0] / pin[1] / pin[2]
            notice_paths = []
            for filename in source['notices']:
                notice = package / 'notices/maven' / pin[0] / pin[1] / pin[2] / filename
                notice.parent.mkdir(parents=True, exist_ok=True)
                notice.write_bytes((directory / filename).read_bytes())
                notice_paths.append(notice.relative_to(package).as_posix())
            result.append({**source, 'notices': notice_paths, 'delivery': {
                'kind': 'build-time', 'manager': 'gradle', 'lock': path, 'digest': digest(lock.read_bytes()),
                'verification': {'path': verification.relative_to(package).as_posix(), 'digest': digest(verification.read_bytes())},
                'configurations': configurations, 'artifacts': checksums[pin]}})
    return result


def native_sources(package, manifest):
    files = [item['path'] for item in manifest['files']]
    return list({item['purl']: item for item in swift_sources(package, files) + gradle_sources(package, files)}.values())
