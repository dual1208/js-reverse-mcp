#!/usr/bin/env python3
"""Install and operate this user's two supervised profile browsers and menu extra."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import subprocess
import time
import urllib.request

REPO = Path(__file__).resolve().parents[1]
CONFIG = Path.home() / '.config/js-reverse-manager/config.json'
STATE = Path.home() / '.local/share/js-reverse-manager'
JOBS = ['manager', 'chrome-cesar', 'chrome-tyson', 'menu']


def run(argv, **kwargs):
    return subprocess.run([str(a) for a in argv], check=True, **kwargs)


def private_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = file.with_suffix('.tmp')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    temp.chmod(0o600)
    temp.replace(file)


def label(job):
    return f'local.js-reverse.{job}'


def domain():
    return f'gui/{os.getuid()}'


def stop(job):
    service = f'{domain()}/{label(job)}'
    status = subprocess.run(['launchctl', 'print', service], capture_output=True, text=True)
    if status.returncode:
        return
    match = re.search(r'^\s*pid = (\d+)', status.stdout, re.MULTILINE)
    pid = int(match.group(1)) if match else None
    run(['launchctl', 'bootout', service], capture_output=True, text=True)
    # bootout is asynchronous: the label can still be unloading when it returns.
    # Wait for both the job and its old process before reusing the launchd label.
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        loaded = subprocess.run(['launchctl', 'print', service],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        alive = False
        if pid:
            try:
                os.kill(pid, 0)
                alive = True
            except ProcessLookupError:
                pass
        if not loaded and not alive:
            return
        time.sleep(0.1)
    raise SystemExit(f'{service} has not stopped. Its definition and replacement were not applied.')


def request(route='state', method='GET'):
    config = json.loads(CONFIG.read_text())
    runtime = json.loads((Path(config['stateDir']) / 'manager.json').read_text())
    req = urllib.request.Request(runtime['url'] + '/' + route, method=method,
                                 headers={'Authorization': 'Bearer ' + runtime['token']})
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)


def install(args):
    if platform.system() != 'Darwin':
        raise SystemExit('This launchd/menu installer requires macOS.')
    os.umask(0o077)
    previous = json.loads(CONFIG.read_text()) if CONFIG.exists() else {}
    profiles = {name: str(Path(getattr(args, name) or previous.get('profiles', {}).get(name, '')).expanduser().resolve())
                for name in ['cesar', 'tyson']}
    for name, root in profiles.items():
        if not (Path(root) / 'Default/Preferences').is_file():
            raise SystemExit(f'Pass --{name} pointing to its existing user data directory. No profile is created or copied.')
    if profiles['cesar'] == profiles['tyson']:
        raise SystemExit('Cesar and Tyson need distinct user data directories.')
    node = shutil.which('node')
    if not node or not (REPO / 'build/src/managed/routerMain.js').is_file():
        raise SystemExit('Node and a current npm run build are required.')
    # Fail before changing anything if a legacy owner is using either root.
    # Existing launchd hosts are handled by the explicit upgrade sequence below.
    supervised = all(subprocess.run(['launchctl', 'print', f'{domain()}/{label(job)}'],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0 for job in JOBS[:3])
    if not supervised:
        for line in subprocess.check_output(['ps', '-axo', 'pid=,command='], text=True).splitlines():
            if '/Google Chrome.app/Contents/MacOS/Google Chrome ' not in line:
                continue
            if any(f'--user-data-dir={root}' in line for root in profiles.values()):
                raise SystemExit('A legacy Chrome owner is using a registered profile. Close that dedicated browser before installation.')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    release = STATE / 'releases' / stamp
    release.mkdir(parents=True, mode=0o700)
    shutil.copytree(REPO / 'build/src', release / 'build/src')
    shutil.copy2(REPO / 'package.json', release / 'package.json')
    (release / 'node_modules').symlink_to(REPO / 'node_modules', target_is_directory=True)
    app = release / 'JS-Reverse.app'
    binary = app / 'Contents/MacOS/JSReverseMenu'
    binary.parent.mkdir(parents=True)
    shutil.copy2(REPO / 'macos/JSReverseMenu/Info.plist', app / 'Contents/Info.plist')
    run(['xcrun', 'swiftc', '-swift-version', '6', '-parse-as-library', '-O',
         '-target', f'{platform.machine()}-apple-macos14.0',
         *sorted((REPO / 'macos/JSReverseMenu').glob('*.swift')), '-o', binary])
    run(['codesign', '--force', '--sign', '-', app], capture_output=True, text=True)
    run(['codesign', '--verify', '--strict', app], capture_output=True, text=True)
    backup = STATE / 'backups' / stamp
    backup.mkdir(parents=True)
    if CONFIG.exists():
        shutil.copy2(CONFIG, backup / 'config.json')
    agents = Path.home() / 'Library/LaunchAgents'
    agents.mkdir(parents=True, exist_ok=True)
    for job in JOBS:
        destination = agents / (label(job) + '.plist')
        if destination.exists():
            shutil.copy2(destination, backup / destination.name)
    # All binaries and definitions are ready before the running jobs change.
    for job in reversed(JOBS):
        stop(job)
    observations = previous.get('allowedRoots', [str(Path.home() / '.local/share/js-reverse-mcp/observations')])
    for root in observations:
        Path(root).mkdir(parents=True, exist_ok=True)
    private_json(CONFIG, {'version': 1, 'stateDir': str(STATE),
                          'workerEntry': str(release / 'build/src/index.js'),
                          'allowedRoots': observations, 'profiles': profiles})
    logs = STATE / 'logs'
    logs.mkdir(exist_ok=True, mode=0o700)
    for job in JOBS:
        arguments = [str(binary)] if job == 'menu' else [node, str(release / 'build/src/managed' /
                     ('managerMain.js' if job == 'manager' else 'profileHost.js'))]
        if job.startswith('chrome-'):
            arguments.append(job.removeprefix('chrome-'))
        log = logs / (job + '.log')
        log.touch(mode=0o600, exist_ok=True)
        definition = {'Label': label(job), 'ProgramArguments': arguments,
                      'EnvironmentVariables': {'JS_REVERSE_MANAGER_CONFIG': str(CONFIG)},
                      'WorkingDirectory': str(release), 'RunAtLoad': True, 'KeepAlive': True,
                      'ThrottleInterval': 10, 'ExitTimeOut': 15, 'LimitLoadToSessionType': 'Aqua',
                      'ProcessType': 'Interactive' if job != 'manager' else 'Background',
                      'StandardOutPath': str(log), 'StandardErrorPath': str(log)}
        file = agents / (label(job) + '.plist')
        with file.open('wb') as output:
            plistlib.dump(definition, output)
        file.chmod(0o600)
    destination_app = Path.home() / 'Applications/JS-Reverse.app'
    destination_app.parent.mkdir(exist_ok=True)
    if destination_app.is_symlink():
        destination_app.unlink()
    elif destination_app.exists():
        shutil.move(destination_app, backup / destination_app.name)
    destination_app.symlink_to(app, target_is_directory=True)
    for job in JOBS:
        run(['launchctl', 'bootstrap', domain(), agents / (label(job) + '.plist')])
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        try:
            state = request()
            if all(profile['running'] for profile in state['profiles']):
                print(json.dumps({'installed': True, 'config': str(CONFIG), 'release': str(release),
                                  'app': str(destination_app), 'backup': str(backup),
                                  'profiles': profiles}, indent=2))
                return
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise SystemExit(f'Jobs installed, but browsers are not both ready. Inspect {logs}.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install', 'status', 'stop', 'start', 'menu', 'disconnect'])
    parser.add_argument('instance', nargs='?')
    parser.add_argument('--cesar')
    parser.add_argument('--tyson')
    args = parser.parse_args()
    if args.action == 'install':
        install(args)
    elif args.action == 'status':
        print(json.dumps(request(), indent=2))
    elif args.action == 'stop':
        for job in reversed(JOBS):
            stop(job)
    elif args.action == 'start':
        for job in JOBS:
            if subprocess.run(['launchctl', 'print', f'{domain()}/{label(job)}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
                run(['launchctl', 'bootstrap', domain(), Path.home() / 'Library/LaunchAgents' / (label(job) + '.plist')])
    elif args.action == 'menu':
        run(['open', Path.home() / 'Applications/JS-Reverse.app'])
    elif args.action == 'disconnect':
        if not args.instance:
            raise SystemExit('Provide an instance ID from status.')
        print(json.dumps(request(f'instances/{args.instance}/disconnect', 'POST')))


if __name__ == '__main__':
    main()
