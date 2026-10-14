"""Trusted unittest runner. Runs selected project code only after Orbit's human gate."""
import importlib.util
import io
import json
import os
import sys
import unittest

# Capture runner-controlled output separately from untrusted tests' print statements.
report_stream = sys.stdout
sys.stdout = sys.stderr
sys.path.insert(0, os.getcwd())
files = []
for index, name in enumerate(sys.argv[1:]):
    filename = os.path.realpath(name)
    suite = unittest.TestSuite()
    loaded = True
    try:
        spec = importlib.util.spec_from_file_location("orbit_selected_" + str(index), filename)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        suite = unittest.defaultTestLoader.loadTestsFromModule(module)
    except BaseException:
        loaded = False
    result = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)
    counts = {"tests": result.testsRun, "passed": result.testsRun - len(result.failures) - len(result.errors) - len(result.skipped) - len(result.expectedFailures) - len(result.unexpectedSuccesses),
              "failed": len(result.failures) + len(result.errors) + len(result.unexpectedSuccesses), "cancelled": 0,
              "skipped": len(result.skipped), "todo": len(result.expectedFailures)}
    success = loaded and result.wasSuccessful() and counts["tests"] > 0 and not any(counts[k] for k in ("failed", "skipped", "todo"))
    files.append({"file": filename, "success": success, "counts": counts})
success = bool(files) and all(f["success"] for f in files)
json.dump({"orbitQa": 1, "overall": {"success": success}, "files": files}, report_stream)
report_stream.flush()
sys.exit(0 if success else 1)
