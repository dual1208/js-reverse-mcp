"""Prepare immutable releases and activate validated persistent browser identities.

Preparation has no effect on running services. Activation refuses live owners and
concurrent configuration edits. Desktop adapters only supply stop/start mechanics.
"""
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
import uuid

PROFILES = ('cesar', 'tyson')
JOBS = ('manager', 'chrome-cesar', 'chrome-tyson')


def run(argv, **kwargs):
    return subprocess.run([str(a) for a in argv], check=True, **kwargs)


def private_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = file.with_name(file.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf-8') as output:
            temporary.chmod(0o600)
            json.dump(value, output, indent=2)
            output.write('\n')
        temporary.replace(file)
    finally:
        temporary.unlink(missing_ok=True)


@dataclass(frozen=True)
class PreparedRelease:
    deployment: 'Deployment'
    release: Path
    config: dict
    previous_bytes: bytes | None

    def activate(self):
        owner = self.deployment
        owner.assert_stopped()
        current = owner.config_file.read_bytes() if owner.config_file.exists() else None
        if current != self.previous_bytes:
            raise ValueError('Configuration changed during preparation; refusing to overwrite it.')
        backup = Path(self.config['stateDir']) / 'backups' / self.release.name
        backup.mkdir(parents=True, exist_ok=True, mode=0o700)
        if current is not None:
            shutil.copy2(owner.config_file, backup / 'config.json')
        for directory in self.config['allowedRoots']:
            Path(directory).mkdir(parents=True, exist_ok=True, mode=0o700)
        private_json(owner.config_file, self.config)
        return backup


class Deployment:
    def __init__(self, repository, config_file=None):
        self.repository = Path(repository).resolve()
        self.config_file = Path(config_file or os.environ.get('JS_REVERSE_MANAGER_CONFIG') or
                                Path.home() / '.config/js-reverse-manager/config.json').expanduser().resolve()
        self.node = shutil.which('node')
        if not self.node:
            raise ValueError('Node.js is required on PATH.')

    def config(self):
        value = json.loads(self.config_file.read_text(encoding='utf-8'))
        if value.get('version') != 1:
            raise ValueError('Unsupported manager configuration version.')
        paths = [value.get('stateDir'), value.get('workerEntry')]
        roots = value.get('allowedRoots')
        profiles = value.get('profiles')
        if not isinstance(roots, list) or not roots or not isinstance(profiles, dict):
            raise ValueError('Configuration requires allowedRoots and both profile paths.')
        paths.extend([*roots, *(profiles.get(name) for name in PROFILES)])
        if any(not isinstance(item, str) or not Path(item).is_absolute() for item in paths):
            raise ValueError('Configuration paths must be absolute on this operating system.')
        return value

    def alive(self, pid):
        # os.kill(pid, 0) is NOT a harmless probe in Python on Windows.
        if not isinstance(pid, int) or pid <= 0:
            return False
        return subprocess.run([self.node, '-e',
            'try { process.kill(Number(process.argv[1]), 0); } catch(e) { process.exit(e.code === "ESRCH" ? 1 : 0); }',
            str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0

    def assert_stopped(self):
        if not self.config_file.exists():
            return
        state = Path(self.config()['stateDir'])
        for name in ('manager', *PROFILES):
            file = state / (name + '.json')
            try:
                runtime = json.loads(file.read_text(encoding='utf-8'))
            except FileNotFoundError:
                continue
            if self.alive(runtime.get('pid')):
                raise ValueError(f'{name} is still running; stop its current supervisor first.')

    @contextmanager
    def operation(self):
        lock = self.config_file.with_name(self.config_file.name + '.operation')
        lock.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            lock.mkdir(mode=0o700)
        except FileExistsError:
            # No automatic stale-lock deletion: two repairers must not both win.
            raise ValueError(f'Another deployment/supervisor owns {lock}. If it crashed, '
                             'verify its owner.json PID has exited before removing that directory.') from None
        try:
            private_json(lock / 'owner.json', {'pid': os.getpid()})
            yield
        finally:
            shutil.rmtree(lock)

    def request(self, route='state', method='GET'):
        config = self.config()
        runtime = json.loads((Path(config['stateDir']) / 'manager.json').read_text(encoding='utf-8'))
        url = urllib.parse.urlsplit(runtime['url'])
        if url.scheme != 'http' or url.hostname != '127.0.0.1' or url.username or url.password:
            raise ValueError('Manager control URL must use loopback HTTP.')
        if not self.alive(runtime.get('pid')):
            raise ValueError('Manager runtime is stale; start the browser services.')
        request = urllib.request.Request(runtime['url'] + '/' + route.lstrip('/'), method=method,
                                          headers={'Authorization': 'Bearer ' + runtime['token']})
        # Control capabilities stay on loopback even if the shell defines an HTTP proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(request, timeout=15) as response:
            return json.load(response)

    def jobs(self):
        entry = Path(self.config()['workerEntry']).parent / 'managed'
        return {name: [self.node, str(entry / ('managerMain.js' if name == 'manager' else 'profileHost.js')),
                       *([] if name == 'manager' else [name.removeprefix('chrome-')])]
                for name in JOBS}

    def prepare(self, cesar=None, tyson=None, with_opencli=False):
        from .opencli import prepare_bridge

        before = self.config_file.read_bytes() if self.config_file.exists() else None
        previous = self.config() if before else {}
        profiles = {}
        for name, given in zip(PROFILES, (cesar, tyson)):
            value = given or previous.get('profiles', {}).get(name)
            if not value:
                raise ValueError(f'Pass --{name} with an existing Chrome user data directory.')
            root = Path(value).expanduser().resolve(strict=True)
            if not (root / 'Default/Preferences').is_file():
                raise ValueError(f'{name}: expected Default/Preferences under {root}. No profile is created or copied.')
            profiles[name] = str(root)
        roots = [Path(value) for value in profiles.values()]
        if roots[0] == roots[1] or roots[0] in roots[1].parents or roots[1] in roots[0].parents:
            raise ValueError('Cesar and Tyson need separate, non-nested user data directories.')
        source = self.repository
        if not (source / 'build/src/managed/routerMain.js').is_file():
            raise ValueError('Run npm ci and npm run build in this repository first.')
        state = Path(previous.get('stateDir', Path.home() / '.local/share/js-reverse-manager')).resolve()
        extensions = {name: list(previous.get('profileExtensions', {}).get(name, [])) for name in PROFILES}
        if with_opencli:
            bridge = str(prepare_bridge(source, state, extensions['cesar']))
            if bridge not in extensions['cesar']:
                extensions['cesar'].append(bridge)
        for paths in extensions.values():
            for extension in paths:
                if not Path(extension).is_absolute() or not (Path(extension) / 'manifest.json').is_file():
                    raise ValueError(f'Invalid configured extension directory: {extension}')
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        release = state / 'releases' / stamp
        release.mkdir(parents=True, mode=0o700)
        try:
            shutil.copytree(source / 'build/src', release / 'build/src')
            for name in ('package.json', 'package-lock.json'):
                shutil.copy2(source / name, release / name)
            # Fresh, lockfile-pinned production dependencies; no checkout symlinks,
            # global OpenCLI dependency, or package lifecycle scripts.
            npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
            if not npm:
                raise ValueError('npm is required on PATH.')
            # npm.cmd is a batch script: use npm's JS entry through Node on Windows.
            npm_cli = Path(npm).resolve().parent / 'node_modules/npm/bin/npm-cli.js'
            command = [self.node, str(npm_cli)] if os.name == 'nt' else [npm]
            run([*command, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
                cwd=release, stdout=sys.stderr)
        except BaseException:
            shutil.rmtree(release)
            raise
        config = {**previous, 'version': 1, 'stateDir': str(state),
                  'workerEntry': str(release / 'build/src/index.js'), 'profiles': profiles,
                  'allowedRoots': previous.get('allowedRoots', [str(state / 'observations')]),
                  'profileExtensions': extensions}
        return PreparedRelease(self, release, config, before)
