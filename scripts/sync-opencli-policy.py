#!/usr/bin/env python3
"""Refresh Cesar's service hosts from a reviewed OpenCLI source checkout."""
import argparse
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

REPO = Path(__file__).resolve().parents[1]
# Human-facing hosts when the adapter registry names only an API endpoint.
ALIASES = {
    '51job': ['51job.com'], 'jike': ['okjike.com'],
    'bluesky': ['bsky.app', 'bsky.social'], 'bbc': ['bbc.co.uk'],
    'juejin': ['juejin.cn'], 'semanticscholar': ['semanticscholar.org'],
    'binance': ['binance.com'], 'spotify': ['spotify.com'],
    'coingecko': ['coingecko.com'], 'npm': ['npmjs.com'],
    'nuget': ['nuget.org'], 'openalex': ['openalex.org'],
    'eastmoney': ['eastmoney.com'], 'tdx': ['tdx.com.cn'],
    'ths': ['10jqka.com.cn'], 'wanfang': ['wanfangdata.com.cn'],
    'cnki': ['cnki.net'], 'deepseek': ['deepseek.com'],
    'minimax': ['minimax.io', 'minimaxi.com'],
    'facebook': ['fb.com', 'messenger.com'],
    'instagram': ['threads.net', 'threads.com'],
}


def host(value):
    value = value.strip().removeprefix('*.').removeprefix('.')
    parsed = urlsplit(value if '://' in value else 'https://' + value)
    name = (parsed.hostname or '').lower().rstrip('.').removeprefix('www.')
    if re.fullmatch(r'[a-z0-9-]+(?:\.[a-z0-9-]+)+', name) and not name[0].isdigit():
        return name
    if re.fullmatch(r'[a-z0-9-]+(?:\.[a-z0-9-]+)+', name) and not re.fullmatch(r'[\d.]+', name):
        return name
    raise ValueError(f'Invalid service host: {value}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkout', type=Path)
    args = parser.parse_args()
    root = args.checkout.resolve()
    index = root / 'docs/adapters/index.md'
    registry = json.loads((root / 'cli-manifest.json').read_text())
    entries = re.findall(r'\*\*\[([^]]+)\]\((\./[^)]+)\)\*\*', index.read_text())
    if len(entries) < 50:
        raise SystemExit('Adapter index format changed; review the source before refreshing.')
    services = {}
    for label, relative in entries:
        name = Path(relative).stem
        values = list(ALIASES.get(name, []))
        for command in registry:
            if command.get('site') == name and command.get('domain'):
                values.extend(command['domain'].split(','))
        document = index.parent / relative
        for line in document.read_text().splitlines():
            if re.search(r'\*\*Domains?\*\*', line):
                values.extend(re.findall(r'`([^`]+)`', line))
        # Desktop adapters and the generic web adapter have no fixed service URL.
        services[name] = sorted({host(value) for value in values if '.' in value and not value.startswith(('127.', 'localhost'))})
    revision = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    data = {'source': 'https://github.com/jackwener/OpenCLI/blob/' + revision + '/docs/adapters/index.md',
            'revision': revision, 'adapters': dict(sorted(services.items()))}
    target = REPO / 'src/managed/opencli-services.json'
    target.write_text(json.dumps(data, indent=2) + '\n')
    print(f'{len(services)} adapters, {len({h for values in services.values() for h in values})} service hosts; source {revision}')


if __name__ == '__main__':
    main()
