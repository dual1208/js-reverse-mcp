"""Opt-in real Chrome acceptance for the portable desktop supervisor."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from browser_services.deployment import Deployment, private_json


@unittest.skipUnless(os.environ.get('JS_REVERSE_INTEGRATION') == '1', 'Requires installed Google Chrome')
class ForegroundTests(unittest.TestCase):
    def test_service_failure_stops_both_browsers(self):
        self.exercise_failure('manager')

    def test_parent_crash_closes_lifetime_pipes_and_both_browsers(self):
        self.exercise_failure('supervisor')

    def exercise_failure(self, failed):
        repo = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(prefix='js reverse portable ') as temporary:
            folder = Path(temporary).resolve()
            profiles = {name: str(folder / name) for name in ('cesar', 'tyson')}
            for root in profiles.values():
                private_json(Path(root) / 'Default/Preferences', {})
            config_file = folder / 'config.json'
            private_json(config_file, {'version': 1, 'stateDir': str(folder / 'state'),
                                       'workerEntry': str(repo / 'build/src/index.js'),
                                       'profiles': profiles, 'allowedRoots': [str(folder)]})
            deployment = Deployment(repo, config_file)
            options = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {}
            with (folder / 'supervisor.log').open('w+') as output:
                command = [sys.executable, str(repo / 'scripts/managed.py'), 'serve', '--config', str(config_file)]
                owner = subprocess.Popen(command, stdout=output, stderr=output,
                                         env={**os.environ, 'JS_REVERSE_TEST_HEADLESS': '1'}, **options)
                try:
                    deadline = time.monotonic() + 45
                    while True:
                        self.assertIsNone(owner.poll(), 'Supervisor must stay alive through startup')
                        try:
                            state = deployment.request()
                            if all(profile['running'] for profile in state['profiles']):
                                break
                        except (OSError, ValueError):
                            pass
                        self.assertLess(time.monotonic(), deadline)
                        time.sleep(0.1)
                    refused = subprocess.run(command, capture_output=True, text=True, timeout=10)
                    self.assertNotEqual(refused.returncode, 0)
                    self.assertIn('Another deployment/supervisor', refused.stderr)
                    runtimes = [json.loads((folder / 'state' / (name + '.json')).read_text())
                                for name in ('manager', 'cesar', 'tyson')]
                    # Simulate a failed manager. Node's kill works on Windows
                    # without a console; the parent must close BOTH browser hosts.
                    if failed == 'manager':
                        subprocess.run([deployment.node, '-e', 'process.kill(Number(process.argv[1]))',
                                        str(runtimes[0]['pid'])], check=True)
                    else:
                        owner.kill()  # Deliberately crash only our disposable parent.
                    self.assertNotEqual(owner.wait(timeout=35), 0)
                    deadline = time.monotonic() + 15
                    while any(deployment.alive(runtime['pid']) for runtime in runtimes):
                        self.assertLess(time.monotonic(), deadline, 'Orphaned browser service after parent exit')
                        time.sleep(0.1)
                    for runtime in runtimes[1:]:
                        endpoint = runtime['endpoint'].replace('ws:', 'http:').split('/devtools/')[0]
                        with self.assertRaises(OSError):
                            urllib.request.urlopen(endpoint + '/json/version', timeout=2)
                    if failed == 'manager':
                        self.assertFalse(config_file.with_name('config.json.operation').exists())
                    self.assertTrue(all((Path(root) / 'Default/Preferences').exists() for root in profiles.values()))
                finally:
                    if owner.poll() is None:
                        owner.terminate()
                        owner.wait(timeout=35)
                    if failed == 'manager' and owner.returncode not in (0, 1):
                        output.seek(0)
                        print(output.read())


if __name__ == '__main__':
    unittest.main()
