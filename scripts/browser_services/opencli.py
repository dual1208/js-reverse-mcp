"""Provision a verified Browser Bridge without changing an existing identity."""
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import urllib.request


def prepare_bridge(repository, state_dir, existing=(), fetch=None):
    lock = json.loads((repository / 'integrations/opencli/bridge-lock.json').read_text())

    def verified(directory):
        try:
            return all(hashlib.sha256((directory / name).read_bytes()).hexdigest() == digest
                       for name, digest in lock['files'].items())
        except OSError:
            return False

    # Unpacked extension identity depends on its absolute path. Reuse the current
    # verified path so Chrome storage and the OpenCLI context ID survive upgrades.
    for candidate in map(Path, existing):
        if verified(candidate):
            return candidate
        try:
            manifest = json.loads((candidate / 'manifest.json').read_text())
        except (OSError, ValueError):
            continue
        if manifest.get('name') == 'OpenCLI':
            raise ValueError(f'Existing OpenCLI bridge differs from the lock: {candidate}. '
                             'Review an explicit bridge upgrade before replacing its identity.')
    destination = state_dir / 'extensions' / ('opencli-' + lock['revision'][:12])
    if destination.exists():
        if not verified(destination):
            raise ValueError(f'Bridge checksum mismatch: {destination}')
        return destination

    def download(url):
        with urllib.request.urlopen(url, timeout=30) as response:
            return response.read()

    fetch = fetch or download
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    staging = Path(tempfile.mkdtemp(prefix='.bridge-', dir=destination.parent))
    try:
        for name, digest in lock['files'].items():
            # The lock is repository-owned, but reject paths escaping its root.
            relative = Path(name)
            if relative.is_absolute() or '..' in relative.parts or '\\' in name:
                raise ValueError(f'Invalid bridge asset path: {name}')
            url = f"https://raw.githubusercontent.com/{lock['repository']}/{lock['revision']}/extension/{name}"
            content = fetch(url)
            if hashlib.sha256(content).hexdigest() != digest:
                raise ValueError(f'Bridge checksum mismatch: {name}')
            target = staging / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        staging.rename(destination)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return destination
