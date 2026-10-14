"""Orbit-owned fixed offline QA adapters; project code still runs as the OS user."""
import collections
import contextlib
import io
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

runner, *selected = sys.argv[1:]
root = pathlib.Path.cwd()
report = sys.stdout
sys.stdout = sys.stderr
counts = dict(tests=0, passed=0, failed=0, cancelled=0, skipped=0, todo=0)
per_file = {}
code = 1

def command(args, extra=None):
    env = dict(os.environ)
    env.update(extra or {})
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
    output = bytearray()
    while True:
        chunk = process.stdout.read(8192)
        if not chunk:
            break
        sys.stderr.buffer.write(chunk)
        sys.stderr.buffer.flush()
        output.extend(chunk)
        if len(output) > 1024 * 1024:
            process.kill()
            process.wait()
            raise ValueError('QA output bound')
    return process.wait(), output.decode('utf-8', 'replace')

try:
    if runner == 'pytest':
        import pytest
        os.environ['PYTEST_DISABLE_PLUGIN_AUTOLOAD'] = '1'
        class Results:
            def pytest_configure(self, config):
                self.root = pathlib.Path(config.rootpath)
            def pytest_runtest_logreport(self, item):
                filename = str((self.root / item.nodeid.split('::')[0]).resolve())
                c = per_file.setdefault(filename, dict(counts))
                if item.when == 'call':
                    c['tests'] += 1
                    c['passed' if item.passed and not getattr(item, 'wasxfail', False) else 'skipped' if item.skipped else 'failed'] += 1
                elif item.failed or item.skipped:
                    c['failed' if item.failed else 'skipped'] += 1
        # No project pytest.ini/addopts/plugin autoload; conftest is project code under the human gate.
        code = int(pytest.main(['-q', '-p', 'no:cacheprovider', '-c', os.devnull, *selected], plugins=[Results()]))
    elif runner == 'go':
        code, output = command(['go', 'test', '-json', '-count=1', *selected], {'GOPROXY': 'off', 'GOSUMDB': 'off', 'GOTOOLCHAIN': 'local', 'GOFLAGS': ''})
        events = [json.loads(line) for line in output.splitlines() if line.strip()]
        seen = set()
        for event in events:
            action, name = event.get('Action'), event.get('Test')
            if name and action in ('pass', 'fail', 'skip'):
                key = (event.get('Package'), name)
                if key in seen:
                    raise ValueError('Duplicate terminal test event')
                seen.add(key)
                counts['tests'] += 1
                counts[{'pass': 'passed', 'fail': 'failed', 'skip': 'skipped'}[action]] += 1
            if not name and action == 'fail':
                counts['failed'] += 1
    elif runner == 'cargo':
        code, output = command(['cargo', 'test', '--offline', '--locked', '--color', 'never', '--manifest-path', selected[0], '--', '--format', 'terse'])
        summaries = re.findall(r'^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out;', output, re.M)
        for status, passed, failed, ignored, measured, filtered in summaries:
            passed, failed, ignored, measured, filtered = map(int, (passed, failed, ignored, measured, filtered))
            counts['tests'] += passed + failed + ignored
            counts['passed'] += passed
            counts['failed'] += failed
            counts['skipped'] += ignored + measured + filtered
    elif runner == 'maven':
        with tempfile.TemporaryDirectory(prefix='orbit-java-qa-') as directory:
            settings = pathlib.Path(directory) / 'settings.xml'
            settings.write_text('<settings/>')
            reports = pathlib.Path(directory) / 'reports'
            code, output = command(['mvn', '--offline', '--batch-mode', '--no-transfer-progress', '-s', str(settings), '-gs', str(settings), '-f', selected[0], '-Dsurefire.reportsDirectory=' + str(reports), 'test'])
            for file in reports.glob('TEST-*.xml'):
                if file.is_symlink() or file.stat().st_size > 1024 * 1024:
                    raise ValueError('Unsafe fresh test report')
                raw = file.read_bytes()
                if b'<!DOCTYPE' in raw or b'<!ENTITY' in raw:
                    raise ValueError('Unsupported XML declarations')
                suite = ET.fromstring(raw)
                if suite.tag != 'testsuite':
                    raise ValueError('Invalid test suite')
                tests, failures, errors, skipped = [int(suite.get(k, '0')) for k in ('tests', 'failures', 'errors', 'skipped')]
                if min(tests, failures, errors, skipped) < 0 or failures + errors + skipped > tests:
                    raise ValueError('Invalid test counts')
                counts['tests'] += tests
                counts['failed'] += failures + errors
                counts['skipped'] += skipped
                counts['passed'] += tests - failures - errors - skipped
    else:
        raise ValueError('Unsupported QA runner')
except BaseException:
    code = 1

if not per_file:
    per_file = {str((root / name).resolve()): dict(counts) for name in selected}
success = code == 0 and bool(per_file) and all(c['tests'] > 0 and c['passed'] > 0 and not any(c[k] for k in ('failed', 'cancelled', 'skipped', 'todo')) for c in per_file.values())
json.dump({'orbitQa': 1, 'overall': {'success': success}, 'files': [{'file': name, 'success': success and c['tests'] > 0, 'counts': c} for name, c in per_file.items()]}, report)
report.flush()
sys.exit(0 if success else 1)
