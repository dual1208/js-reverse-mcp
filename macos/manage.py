#!/usr/bin/env python3
"""macOS adapter: launchd, Swift menu compilation, signing and app placement."""
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import subprocess
import time

from browser_services.deployment import run

JOBS = ['manager', 'chrome-cesar', 'chrome-tyson', 'menu']


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


def install(deployment, args):
    repo = deployment.repository
    config_file = deployment.config_file
    if platform.system() != 'Darwin':
        raise SystemExit('This launchd/menu installer requires macOS.')
    prepared = deployment.prepare(args.cesar, args.tyson, args.with_opencli)
    profiles = prepared.config['profiles']
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
    release = prepared.release
    stamp = release.name
    state_dir = Path(prepared.config['stateDir'])
    app = release / 'JS-Reverse.app'
    binary = app / 'Contents/MacOS/JSReverseMenu'
    binary.parent.mkdir(parents=True)
    shutil.copy2(repo / 'macos/JSReverseMenu/Info.plist', app / 'Contents/Info.plist')
    run(['xcrun', 'swiftc', '-swift-version', '6', '-parse-as-library', '-O',
         '-target', f'{platform.machine()}-apple-macos14.0',
         *sorted((repo / 'macos/JSReverseMenu').glob('*.swift')), '-o', binary])
    run(['codesign', '--force', '--sign', '-', app], capture_output=True, text=True)
    run(['codesign', '--verify', '--strict', app], capture_output=True, text=True)
    backup = state_dir / 'backups' / stamp
    backup.mkdir(parents=True)
    if config_file.exists():
        shutil.copy2(config_file, backup / 'config.json')
    agents = Path.home() / 'Library/LaunchAgents'
    agents.mkdir(parents=True, exist_ok=True)
    for job in JOBS:
        destination = agents / (label(job) + '.plist')
        if destination.exists():
            shutil.copy2(destination, backup / destination.name)
    # All binaries and definitions are ready before the running jobs change.
    for job in reversed(JOBS):
        stop(job)
    prepared.activate()
    logs = state_dir / 'logs'
    logs.mkdir(exist_ok=True, mode=0o700)
    commands = deployment.jobs()
    for job in JOBS:
        arguments = [str(binary)] if job == 'menu' else commands[job]
        log = logs / (job + '.log')
        log.touch(mode=0o600, exist_ok=True)
        definition = {'Label': label(job), 'ProgramArguments': arguments,
                      'EnvironmentVariables': {'JS_REVERSE_MANAGER_CONFIG': str(config_file)},
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
            state = deployment.request()
            if all(profile['running'] for profile in state['profiles']):
                print(json.dumps({'installed': True, 'config': str(config_file), 'release': str(release),
                                  'app': str(destination_app), 'backup': str(backup),
                                  'profiles': profiles}, indent=2))
                return
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise SystemExit(f'Jobs installed, but browsers are not both ready. Inspect {logs}.')



def operate(deployment, args):
    if platform.system() != 'Darwin':
        raise ValueError('launchd and the native menu require macOS. Use prepare and serve on Windows or Linux.')
    with deployment.operation():
        if args.action == 'install':
            install(deployment, args)
        elif args.action == 'stop':
            for job in reversed(JOBS):
                stop(job)
        elif args.action == 'start':
            for job in JOBS:
                if subprocess.run(['launchctl', 'print', f'{domain()}/{label(job)}'],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
                    run(['launchctl', 'bootstrap', domain(),
                         Path.home() / 'Library/LaunchAgents' / (label(job) + '.plist')])
        elif args.action == 'menu':
            run(['open', Path.home() / 'Applications/JS-Reverse.app'])
