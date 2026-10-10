"""Offline tests for the build artifact verifier; no Docker or installs."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('artifacts', ROOT / 'containers/native-runtime/install-artifacts.py')
artifacts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifacts)


class ArtifactTests(unittest.TestCase):
    def archive(self, root, name='binary'):
        target = root / 'fixture.tar.gz'
        with tarfile.open(target, 'w:gz') as archive:
            member = tarfile.TarInfo(name)
            member.size = 7
            archive.addfile(member, io.BytesIO(b'fixture'))
        return target, hashlib.sha256(target.read_bytes()).hexdigest()

    def test_verified_archive_extracts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            file, digest = self.archive(root)
            artifacts.unpack(file, root / 'out', digest)
            self.assertEqual((root / 'out/binary').read_bytes(), b'fixture')

    def test_changed_download_never_extracts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            file, digest = self.archive(root)
            file.write_bytes(file.read_bytes() + b'changed')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                artifacts.unpack(file, root / 'out', digest)
            self.assertFalse((root / 'out').exists())

    def test_traversal_rejected_even_with_valid_digest(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            file, digest = self.archive(root, '../escape')
            with self.assertRaises(tarfile.FilterError):
                artifacts.unpack(file, root / 'out', digest)
            self.assertFalse((root / 'escape').exists())

    def test_recipe_pins_match_reviewed_lock(self):
        lock = json.loads((ROOT / 'containers/native-runtime/runtime-lock.json').read_text())
        dockerfile = (ROOT / 'containers/native-runtime/Dockerfile').read_text()
        self.assertIn('FROM ' + lock['base']['name'], dockerfile)
        self.assertIn(lock['hermes']['commit'], dockerfile)
        self.assertIn('--base-version ' + lock['hermes']['version'], dockerfile)
        self.assertIn('--frozen', dockerfile)
        self.assertIn('RUN --network=none', dockerfile)
        for value in lock['artifacts'].values():
            self.assertRegex(value['sha256'], r'^[a-f0-9]{64}$')
            self.assertTrue(value['url'].startswith('https://github.com/'))


if __name__ == '__main__':
    unittest.main()
