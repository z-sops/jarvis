"""Build-only artifact staging. Importing this module performs no I/O."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import urllib.request

MAX_BYTES = 512 * 1024 * 1024


def verify(file, expected):
    digest = hashlib.sha256()
    with open(file, 'rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    if digest.hexdigest() != expected:
        raise ValueError('Artifact checksum mismatch; refusing extraction')


def unpack(file, destination, expected):
    verify(file, expected)
    with tarfile.open(file, 'r:gz') as archive:
        archive.extractall(destination, filter='data')


def download(spec, target):
    request = urllib.request.Request(spec['url'], headers={'User-Agent': 'Orbit-runtime-build/1'})
    with urllib.request.urlopen(request, timeout=120) as response, open(target, 'xb') as out:
        size = 0
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                raise ValueError('Artifact exceeds build download limit')
            out.write(chunk)
    verify(target, spec['sha256'])


def main():
    if os.environ.get('ORBIT_IMAGE_BUILD') != '1':
        raise SystemExit('Use only through the reviewed Docker build recipe')
    lock = json.loads(Path('/opt/orbit-image-build/runtime-lock.json').read_text())
    if os.uname().machine != 'x86_64':
        raise SystemExit('This recipe supports Linux amd64 only')
    with tempfile.TemporaryDirectory(prefix='orbit-image-') as temp:
        root = Path(temp)
        for name, spec in lock['artifacts'].items():
            archive = root / (name + '.tar.gz')
            destination = root / name
            destination.mkdir()
            download(spec, archive)
            unpack(archive, destination, spec['sha256'])
            if name == 'python':
                shutil.move(str(destination / 'python'), '/opt/orbit-python')
            else:
                matches = [p for p in destination.rglob(name) if p.is_file() and not p.is_symlink()]
                if len(matches) != 1:
                    raise ValueError('Expected one regular executable in verified archive')
                target = '/opt/orbit-image-build/uv' if name == 'uv' else '/usr/local/bin/opencode'
                shutil.copyfile(matches[0], target)
                os.chmod(target, 0o755)


if __name__ == '__main__':
    main()
