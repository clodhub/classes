"""Collect package metadata from exact dependency locks and supplied licence documents."""
from concurrent.futures import ThreadPoolExecutor
import base64
from copy import deepcopy
import io
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import threading
import zipfile
from urllib.parse import quote
from urllib.request import urlopen

from aepm.model import digest

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / 'upstream'
# npm packages whose registry entry names no repository; each address holds the entry's gitHead commit.
NPM_REPOSITORIES = {'@isaacs/nonrecursive-glob-match': 'https://github.com/isaacs/nonrecursive-glob-match'}


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name('.' + path.name + f'.{os.getpid()}.{threading.get_ident()}.tmp')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
    temporary.replace(path)


def fetch(url):
    with urlopen(url, timeout=90) as response:
        return response.read()


def npm_source(pin):
    name, version = pin
    directory = CACHE / (quote(name, safe='') + '@' + version)
    metadata = directory / 'source.json'
    if metadata.exists():
        return read(metadata)
    source = json.loads(fetch('https://registry.npmjs.org/' + quote(name, safe='@') + '/' + quote(version, safe='')))
    licence = source.get('license')
    if isinstance(licence, dict):
        licence = licence['type']
    if not licence:
        raise ValueError(f'{name}@{version}: registry supplies no licence expression')
    repository_info = source.get('repository', {})
    repository = repository_info.get('url', '') if isinstance(repository_info, dict) else repository_info
    repository = repository.removeprefix('git+').replace('git://', 'https://').replace('ssh://git@github.com/', 'https://github.com/')
    if re.fullmatch(r'[\w.-]+/[\w.-]+', repository):
        repository = 'https://github.com/' + repository
    if not repository.startswith('https://'):
        repository = source.get('homepage') or NPM_REPOSITORIES.get(name, '')
    if not repository.startswith('https://'):
        raise ValueError(f'{name}@{version}: no source repository address')
    raw = fetch(source['dist']['tarball'])
    integrity = 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode('ascii')
    if integrity != source['dist']['integrity']:
        raise ValueError(f'{name}@{version}: registry source integrity mismatch')
    notices, readmes, declarations = [], [], []
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        for member in archive.getmembers():
            if member.isfile() and re.match(r'(?i)^(licen[cs]e|copying|notice|copyright)([.\-_]|$)', Path(member.name).name):
                content = archive.extractfile(member).read()
                if content.strip():
                    notices.append((member.name.removeprefix('package/'), content))
            elif member.isfile() and Path(member.name).name.lower().startswith('readme'):
                content = archive.extractfile(member).read()
                if re.search(rb'(?i)licen[cs]e|copyright', content):
                    readmes.append((member.name.removeprefix('package/'), content))
            elif member.isfile() and member.name == 'package/package.json':
                content = archive.extractfile(member).read()
                if json.loads(content).get('license'):
                    declarations.append(('package.json', content))
    if not notices and readmes:
        notices = readmes
    if not notices and repository.startswith('https://github.com/'):
        project = repository.removeprefix('https://github.com/').removesuffix('.git').split('/tree/')[0]
        revisions = ([source['gitHead']] if source.get('gitHead') else ['v' + version, name.split('/')[-1] + '@' + version, version]) + ['main', 'master']
        subdir = repository_info.get('directory', '') if isinstance(repository_info, dict) else ''
        for revision in revisions:
            for filename in ('LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT', 'LICENSE-APACHE', 'LICENCE', 'COPYING', subdir + '/LICENSE'):
                try:
                    content = fetch(f'https://raw.githubusercontent.com/{project}/{revision}/{filename}')
                except Exception:
                    continue
                if content.strip():
                    notices.append((filename, content))
                    break
            if notices:
                break
    if not notices:
        notices = declarations
    if not notices:
        raise ValueError(f'{name}@{version}: no supplied licence or notice document found')
    directory.mkdir(parents=True, exist_ok=True)
    paths = []
    for index, (path, content) in enumerate(notices):
        destination = f'{index}-{Path(path).name}'
        (directory / destination).write_bytes(content)
        paths.append(destination)
    result = {'name': name, 'version': version, 'revision': source.get('gitHead') or 'sha512:' + hashlib.sha512(raw).hexdigest(),
              'repository': repository, 'purl': 'pkg:npm/' + name + '@' + version,
              'licence': licence, 'notices': paths, 'integrity': source['dist']['integrity']}
    write(metadata, result)
    return result


def npm_locks(package, manifest):
    return [package / item['path'] for item in manifest['files'] if item['path'].endswith('package-lock.json')]


def prepare_sources(packages):
    pins = set()
    for package, manifest in packages:
        for path in npm_locks(package, manifest):
            lock = read(path)
            for key, item in lock.get('packages', {}).items():
                if key and item.get('integrity') and item.get('version'):
                    pins.add((key.rsplit('node_modules/', 1)[1], item['version']))
    failures = []
    def capture(pin):
        try:
            return npm_source(pin)
        except Exception as error:
            failures.append(str(error))
            return None
    with ThreadPoolExecutor(max_workers=12) as pool:
        for source in pool.map(capture, sorted(pins)):
            if source:
                print('source', source['name'], source['version'], flush=True)
    if failures:
        raise ValueError('\n'.join(failures))


def upstream(package, manifest):
    result = {}
    dependencies = {}
    for path in npm_locks(package, manifest):
        lock = read(path)
        if lock.get('lockfileVersion') != 3:
            raise ValueError(f'{path}: npm lock version 3 required')
        for key, item in lock['packages'].items():
            if not key or not item.get('integrity') or not item.get('version'):
                continue
            name, version = key.rsplit('node_modules/', 1)[1], item['version']
            source = npm_source((name, version))
            identity = source['purl']
            if identity in result:
                continue
            directory = CACHE / (quote(name, safe='') + '@' + version)
            slug = quote(name, safe='') + '@' + version
            notice_paths = []
            for notice in source['notices']:
                relative = 'notices/npm/' + slug + '/' + notice
                destination = package / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes((directory / notice).read_bytes())
                notice_paths.append(relative)
            delivery = {'kind': 'build-time', 'manager': 'npm', 'lock': path.relative_to(package).as_posix(),
                        'digest': digest(path.read_bytes()), 'packagePath': key, 'integrity': item['integrity']}
            result[identity] = {field: source[field] for field in ('name', 'version', 'revision', 'repository', 'purl', 'licence')}
            result[identity].update(notices=notice_paths, delivery=delivery)
            # Each build project and verification fixture has its own dependency installation.
            dependencies.setdefault('pkg:npm/' + name, {'name': 'pkg:npm/' + name, 'version': version, 'isolation': 'isolated'})
    return list(result.values()), list(dependencies.values())


def wrappers(package, manifest):
    entries = []
    for item in manifest['files']:
        if not item['path'].endswith('gradle-wrapper.jar'):
            continue
        jar = package / item['path']
        if package.name == 'android-host' and digest(jar.read_bytes()) == '497c8c2a7e5031f6aa847f88104aa80a93532ec32ee17bdb8d1d2f67a194a9c7':
            preserved = ROOT / 'proof/inputs' / ('gradle-wrapper-' + digest(jar.read_bytes()) + '.jar')
            preserved.parent.mkdir(parents=True, exist_ok=True)
            preserved.write_bytes(jar.read_bytes())
            verified = fetch('https://raw.githubusercontent.com/gradle/gradle/v9.4.0/gradle/wrapper/gradle-wrapper.jar')
            if digest(verified) != '55243ef57851f12b070ad14f7f5bb8302daceeebc5bce5ece5fa6edb23e1145c':
                raise ValueError('Gradle 9.4.0 wrapper does not match its published checksum')
            jar.write_bytes(verified)
        properties = (package / 'implementation/android/templates/gradle/wrapper/gradle-wrapper.properties.template'
                      if package.name == 'android-host' else jar.with_suffix('.properties'))
        values = dict(line.split('=', 1) for line in properties.read_text().splitlines() if '=' in line and not line.startswith('#'))
        url = values['distributionUrl'].replace('\\:', ':')
        version = re.search(r'gradle-(.+)-(?:bin|all)\.zip$', url)[1]
        notice = package / 'notices/gradle-wrapper/LICENSE'
        notice.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(jar) as archive:
            notice.write_bytes(archive.read('META-INF/LICENSE'))
        folder = jar.parent.parent.parent
        bundled = [jar, properties] + [folder / name for name in ('gradlew', 'gradlew.bat') if (folder / name).is_file()]
        inventory = [{'path': path.relative_to(package).as_posix(), 'digest': digest(path.read_bytes())} for path in bundled]
        entries.append({'name': 'gradle-wrapper', 'version': version, 'revision': None,
                        'repository': 'https://github.com/gradle/gradle', 'purl': 'pkg:generic/gradle-wrapper@' + version,
                        'licence': 'Apache-2.0', 'notices': [notice.relative_to(package).as_posix()],
                        'delivery': {'kind': 'bundled', 'files': inventory, 'gradleWrapper': {
                            'jar': jar.relative_to(package).as_posix(), 'properties': properties.relative_to(package).as_posix(),
                            'distribution': {'url': url, 'digest': values['distributionSha256Sum']}}}})
    return entries


def bundled_sources(package, manifest):
    if package.name == 'android-host':
        directory = package / 'implementation/android/vendor/xmldom'
        source = npm_source(('@xmldom/xmldom', '0.8.15'))
        value = {key: source[key] for key in ('name', 'version', 'revision', 'repository', 'purl', 'licence')}
        value['notices'] = [(directory / 'LICENSE').relative_to(package).as_posix()]
        value['delivery'] = {'kind': 'bundled', 'files': [
            {'path': path.relative_to(package).as_posix(), 'digest': digest(path.read_bytes())}
            for path in sorted(directory.rglob('*')) if path.is_file()]}
        return [value]
    if package.name != 'controls':
        return []
    paths = ['implementation/web/icons.ts', 'implementation/apple/Sources/IconPaths.swift', 'tests/fixtures/icons.json']
    snapshot = digest((package / 'tests/fixtures/icons.json').read_bytes())
    directory = CACHE / 'material-design-icons'
    if not (directory / 'LICENSE').exists():
        content = fetch('https://raw.githubusercontent.com/google/material-design-icons/master/LICENSE')
        directory.mkdir(parents=True, exist_ok=True)
        (directory / 'LICENSE').write_bytes(content)
    notice = package / 'notices/material-design-icons/LICENSE'
    notice.parent.mkdir(parents=True, exist_ok=True)
    notice.write_bytes((directory / 'LICENSE').read_bytes())
    return [{'name': 'material-design-icons', 'version': 'snapshot-' + snapshot, 'revision': 'sha256:' + snapshot,
             'repository': 'https://github.com/google/material-design-icons',
             'purl': 'pkg:generic/google/material-design-icons@snapshot-' + snapshot,
             'licence': 'Apache-2.0', 'notices': [notice.relative_to(package).as_posix()],
             'delivery': {'kind': 'bundled', 'files': [{'path': path, 'digest': digest((package / path).read_bytes())} for path in paths]}}]


def styles(package, manifest):
    namespaces = set()
    for artefact in manifest['artefacts']:
        if not artefact['source'].endswith('.css'):
            continue
        text = re.sub(r'/\*.*?\*/', '', (package / artefact['source']).read_text(), flags=re.S)
        for name in re.findall(r'@(?:-webkit-)?keyframes\s+([\w-]+)', text):
            namespaces.add('@keyframes ' + name)
        for selector, body in re.findall(r'([^{}]+)\{([^{}]*)\}', text):
            if selector.strip().startswith('@'):
                continue
            properties = re.findall(r'(?:^|;)\s*([-a-zA-Z][\w-]*)\s*:', body)
            for item in selector.strip().split(','):
                item = ' '.join(item.split())
                if not item:
                    continue
                if re.fullmatch(r'(?:[\d.]+%|from|to)', item):
                    continue
                namespaces.update(item + '::' + prop for prop in properties)
    return {'scope': 'global' if namespaces else 'none',
            'namespaces': sorted(namespaces), 'conflicts': []}


NODE = {'name': 'node', 'versionRange': '>=26.5.0 <27.0.0', 'probe': ['node', '--version'],
        'install': {'macos': ['brew', 'install', 'node'], 'windows': ['winget', 'install', '--exact', '--id', 'OpenJS.NodeJS'],
                    'linux': None},
        'manual': 'Without the package manager, install Node 26 from nodejs.org (the installer, or the zip or tar archive with its folder put first on PATH); on Linux also from the NodeSource repository.'}
XCODEBUILD = {'name': 'xcodebuild', 'versionRange': '>=27.0.0 <28.0.0', 'probe': ['xcodebuild', '-version'],
              'install': {'macos': None, 'windows': None, 'linux': None},
              'manual': 'Apple targets build only on macOS. Install Xcode 27 from the Mac App Store, open it once, accept the licence and install the iOS and tvOS simulator platforms it offers.'}
XCODEGEN = {'name': 'xcodegen', 'versionRange': '>=2.46.0 <3.0.0', 'probe': ['xcodegen', '--version'],
            'install': {'macos': ['brew', 'install', 'xcodegen'], 'windows': None, 'linux': None},
            'manual': None}
JAVA = {'name': 'java', 'versionRange': '>=17.0.0 <27.0.0', 'probe': ['java', '-version'],
        'install': {'macos': ['brew', 'install', '--cask', 'temurin'],
                    'windows': ['winget', 'install', '--exact', '--id', 'EclipseAdoptium.Temurin.21.JDK'],
                    'linux': ['sudo', 'apt-get', 'install', '--yes', 'openjdk-21-jdk']},
        'manual': None}
SDKMANAGER = {'name': 'sdkmanager', 'versionRange': '>=22.0.0 <23.0.0', 'probe': ['sdkmanager', '--version'],
              'install': {'macos': ['brew', 'install', '--cask', 'android-commandlinetools'], 'windows': None, 'linux': None},
              'manual': 'Install the Android command-line tools 22.0 (version 23 replaces sdkmanager): on Windows and Linux unpack https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip (linux in place of win) as cmdline-tools/latest in the SDK folder and put its bin folder on PATH. Set ANDROID_HOME to the SDK folder, then run sdkmanager --licenses, accept every licence, and run sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0".'}
TOOLCHAINS = {'server': [NODE], 'web': [NODE], 'windows': [NODE], 'ios': [XCODEBUILD, XCODEGEN], 'macos': [XCODEBUILD, XCODEGEN],
              'tvos': [XCODEBUILD, XCODEGEN], 'android': [JAVA, SDKMANAGER]}


def foundations(package, manifest):
    from native_provenance import native_sources
    remote = subprocess.check_output(['git', '-C', str(package), 'remote', 'get-url', 'origin'], text=True).strip()
    remote = remote.removesuffix('.git')
    if not remote.startswith('https://'):
        raise ValueError(f'{package}: expected an explicit https repository origin')
    platforms = set()
    for artefact in manifest['artefacts']:
        source = artefact['source']
        if source.startswith('implementation/server/'):
            platforms.add('server')
        elif source.startswith('implementation/web/'):
            platforms.add('web')
        elif source.startswith('implementation/apple/'):
            platforms.update(('ios', 'macos', 'tvos'))
        elif source.startswith('implementation/android/'):
            platforms.add('android')
        elif source.startswith('implementation/desktop/'):
            platforms.add('windows')
    imported, dependencies = upstream(package, manifest)
    imported.extend(wrappers(package, manifest))
    imported.extend(bundled_sources(package, manifest))
    imported.extend(native_sources(package, manifest))
    by_name = {item['name']: item for item in dependencies}
    for entry in imported:
        if entry['delivery']['kind'] == 'bundled' and entry['purl'].startswith('pkg:npm/'):
            name = entry['purl'].rsplit('@', 1)[0]
            by_name[name] = {'name': name, 'version': entry['version'], 'isolation': 'isolated'}
        if entry['delivery'].get('manager') not in ('swift', 'gradle'):
            continue
        name = entry['purl'].rsplit('@', 1)[0]
        by_name.setdefault(name, {'name': name, 'version': entry['version'], 'isolation': 'isolated'})
        if package.name == 'video-calls' and (name == 'pkg:maven/io.livekit/livekit-android' or name == 'pkg:swift/github.com/livekit/client-sdk-swift'):
            by_name[name]['isolation'] = 'shared'
    frameworks = {}
    compose = any(item['source'].endswith('.kt') and 'androidx.compose.' in (package / item['source']).read_text()
                  for item in manifest['artefacts'])
    if compose:
        lock = (ROOT.parent / 'components/android-host/implementation/android/dependencies/app/gradle.lockfile').read_text()
        for group, name in [('androidx.compose.ui', 'ui'), ('androidx.compose.material3', 'material3')]:
            version = re.search(r'^' + re.escape(group + ':' + name + ':') + r'([^=]+)=', lock, re.M)[1]
            identifier = 'pkg:maven/' + group + '/' + name
            by_name[identifier] = {'name': identifier, 'version': version, 'isolation': 'shared'}
            if name == 'ui':
                frameworks['android-ui'] = {'name': 'androidx.compose.ui', 'range': '=' + version}
    dependencies = list(by_name.values())
    for bundle in manifest.get('classes', []):
        for port in bundle['descriptor']['provides']:
            if 'windows' in port['modules'] and 'web' in port['modules']:
                platforms.add('windows')
    shared_names = {'pkg:npm/livekit-client', 'pkg:npm/electron'}
    for dependency in dependencies:
        if dependency['name'] in shared_names:
            dependency['isolation'] = 'shared'
    runtimes = {'node': '>=26.5.0 <27.0.0'}
    if any(item['source'].startswith('implementation/apple/') for item in manifest['artefacts']):
        runtimes.update(swift='=6.4.2', ios='>=17.0.0', macos='>=14.0.0', tvos='>=17.0.0')
    if any(item['source'].startswith('implementation/android/') for item in manifest['artefacts']):
        runtimes.update(kotlin='=2.4.21', java='>=17.0.0 <27.0.0', android='>=8.0.0')
    value = {'platforms': sorted(platforms), 'toolchains': {platform: deepcopy(TOOLCHAINS[platform]) for platform in sorted(platforms)},
             'upstream': imported,
             'compatibility': {'runtimes': runtimes, 'frameworks': frameworks,
                               'dependencies': dependencies, 'styles': styles(package, manifest)},
             'maintenance': {'owners': ['Level N Ltd'], 'contact': remote + '/issues', 'repository': remote,
                             'updates': {'source': remote + '/releases', 'strategy': 'manual'}}}
    return value


def provenance_document(package, manifest):
    native = any(entry['delivery'].get('manager') in ('swift', 'gradle') for entry in manifest['upstream'])
    lines = ['# Package provenance', '',
             f"Wrapper licence: `{manifest['identity']['licence']}`. `LICENCE` and `NOTICE` are supplied wrapper documents; `SOURCE.md` identifies the Level N source.", '',
             '`component.json` records each external source version, revision, repository, package URL, supplied notice documents and delivery inventory or dependency lock.', '',
             'npm dependencies use package-lock version 3 with the exact package path, version and integrity. Native dependencies use Swift resolved format 3 or Gradle configuration locks and SHA-256 verification records.', '',
             'Notice documents retain supplied bytes. A package.json or Maven project document with a licence field is a declaration; it does not supply additional licence text. Snapshot versions identify bundled source bytes rather than an upstream release tag.', '',
             'Shared dependency pins describe one application dependency installation; isolated pins belong to separate build or verification projects. Apple system frameworks follow the declared operating-system ranges.', '',
             'Stylesheet namespaces name the actual selector and property separated by `::`, plus global keyframe names. Global theme variables are intentional application-wide declarations.', '',
             'Windows browser modules run inside the Electron host. Apple modules target iOS, television and Mac Catalyst where declared. Runtime execution coverage is recorded in signed review evidence.', '',
             f"Maintainer: {manifest['maintenance']['owners'][0]}. Contact: {manifest['maintenance']['contact']}."]
    if package.name == 'controls':
        lines += ['', 'Material Design icon path data is a digest-identified source snapshot. Its upstream release tag is unspecified; the supplied Apache licence is packaged separately from the wrapper notice.']
    if native:
        lines += ['', 'Native resolved pins and checksums identify declared build inputs. Source revisions absent from Maven metadata are null. Maven licence lists are combined with AND; plugin-marker metadata without a licence declaration uses NOASSERTION and retains its supplied project document.']
    (package / 'PROVENANCE.md').write_text('\n'.join(lines) + '\n')
