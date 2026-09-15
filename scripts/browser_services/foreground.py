"""Own three browser services in the current desktop session on any supported OS.

Failure is visible and stops the whole group. Restarts belong to the caller's
supervisor, rather than an unbounded second restart loop inside each service.
"""
from contextlib import ExitStack
import json
import os
from pathlib import Path
import signal
import subprocess
import time


class ForegroundServices:
    def __init__(self, deployment):
        self.deployment = deployment
        self.children = []
        self.stopping = False

    def stop(self, *_):
        self.stopping = True

    def run(self):
        deployment = self.deployment
        with deployment.operation(), ExitStack() as resources:
            deployment.assert_stopped()
            previous = {}
            signals = (signal.SIGINT, signal.SIGTERM, signal.SIGBREAK) if os.name == 'nt' else (signal.SIGINT, signal.SIGTERM)
            for sig in signals:
                previous[sig] = signal.signal(sig, self.stop)
            try:
                config = deployment.config()
                logs = Path(config['stateDir']) / 'logs'
                logs.mkdir(parents=True, exist_ok=True, mode=0o700)
                environment = {**os.environ, 'JS_REVERSE_MANAGER_CONFIG': str(deployment.config_file),
                               'JS_REVERSE_SUPERVISED_STDIN': '1'}
                for name, argv in deployment.jobs().items():
                    output = resources.enter_context((logs / (name + '.log')).open('ab'))
                    os.chmod(output.name, 0o600)
                    options = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {}
                    child = subprocess.Popen(argv, env=environment, stdin=subprocess.PIPE,
                                             stdout=output, stderr=output, **options)
                    self.children.append((name, child))
                deadline = time.monotonic() + 45
                ready = False
                while not self.stopping:
                    for name, child in self.children:
                        if child.poll() is not None:
                            raise RuntimeError(f'{name} exited ({child.returncode}); inspect {logs / (name + ".log")}')
                    if not ready:
                        if time.monotonic() > deadline:
                            raise RuntimeError(f'Browsers did not become ready; inspect {logs}')
                        try:
                            state = deployment.request()
                            ready = all(profile['running'] for profile in state['profiles'])
                        except (OSError, ValueError):
                            pass
                        if ready:
                            print(json.dumps({'ready': True, 'config': str(deployment.config_file)}), flush=True)
                    time.sleep(0.2)
            finally:
                failures = []
                # Stop hosts before their manager. The private pipe works even
                # without a Windows console; EOF also handles parent crashes.
                for name, child in reversed(self.children):
                    if child.poll() is None:
                        try:
                            child.stdin.write(b'shutdown\n')
                            child.stdin.close()
                        except (BrokenPipeError, OSError):
                            pass
                        try:
                            child.wait(timeout=15)
                        except subprocess.TimeoutExpired:
                            failures.append(name)
                    elif child.stdin:
                        child.stdin.close()
                for sig, handler in previous.items():
                    signal.signal(sig, handler)
                if failures:
                    raise RuntimeError('Graceful stop timed out for ' + ', '.join(failures) +
                                       '; no force kill was issued. Inspect the service logs.')
