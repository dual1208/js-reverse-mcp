#!/usr/bin/env python3
"""Select one of the two preserved local browser profiles."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

root = Path.home() / '.local/share/js-reverse-mcp'
profiles = {'cesar': root / 'chrome-profile-cesar', 'tyson': root / 'chrome-test-profile-retired-20260909-075115'}
active = root / 'active-profile'
name = sys.argv[1] if len(sys.argv) > 1 else 'status'
if (Path.home() / '.config/js-reverse-manager/config.json').exists():
    raise SystemExit('Cesar and Tyson now run independently. Use just status or select_browser; no global profile switch is needed.')
if name == 'status':
    selected = active.resolve() if active.exists() else profiles['cesar']
    print(next((k for k, v in profiles.items() if v == selected), str(selected)))
    raise SystemExit()
if name not in profiles:
    raise SystemExit('Choose cesar or tyson')
target = profiles[name]
if not (target / 'Default/Preferences').is_file():
    raise SystemExit(f'Profile is missing: {target}')
# Close only Chrome processes using these dedicated automation profiles.
pids = []
for line in subprocess.check_output(['ps', '-axo', 'pid=,command='], text=True).splitlines():
    pid, command = line.strip().split(None, 1)
    if not command.startswith('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome '):
        continue
    for arg in command.split():
        if arg.startswith('--user-data-dir=') and Path(arg.split('=', 1)[1]).resolve() in profiles.values():
            os.kill(int(pid), signal.SIGTERM)
            pids.append(int(pid))
for _ in range(100):
    remaining = []
    for pid in pids:
        try:
            os.kill(pid, 0)
            remaining.append(pid)
        except ProcessLookupError:
            pass
    pids = remaining
    if not pids:
        break
    time.sleep(0.1)
if pids:
    raise SystemExit('Browser has not exited; profile selection was not changed.')
for link in [active, root / 'chrome-test-profile']:
    if link.exists() and not link.is_symlink():
        raise SystemExit(f'Refusing to replace a real directory: {link}')
    temporary = link.with_name(link.name + '.switching')
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target, target_is_directory=True)
    temporary.replace(link)
print(f'Default profile: {name} ({target})')
