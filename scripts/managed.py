#!/usr/bin/env python3
"""Prepare and operate persistent JS-Reverse browsers; see docs/deployment.md."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

from browser_services.deployment import Deployment
from browser_services.foreground import ForegroundServices


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'serve', 'status', 'disconnect', 'mcp-config',
                                          'install', 'start', 'stop', 'menu'])
    parser.add_argument('instance', nargs='?')
    parser.add_argument('--config', help='Private manager config; defaults to JS_REVERSE_MANAGER_CONFIG or the home config')
    parser.add_argument('--cesar')
    parser.add_argument('--tyson')
    parser.add_argument('--with-opencli', action='store_true', help='Verify/install the pinned Browser Bridge in Cesar')
    args = parser.parse_args()
    os.umask(0o077)
    deployment = Deployment(Path(__file__).resolve().parents[1], args.config)
    if args.action == 'prepare':
        with deployment.operation():
            deployment.assert_stopped()
            prepared = deployment.prepare(args.cesar, args.tyson, args.with_opencli)
            backup = prepared.activate()
            print(json.dumps({'config': str(deployment.config_file), 'release': str(prepared.release),
                              'backup': str(backup)}, indent=2))
    elif args.action == 'serve':
        ForegroundServices(deployment).run()
    elif args.action == 'status':
        print(json.dumps(deployment.request(), indent=2))
    elif args.action == 'disconnect':
        if not args.instance or not re.fullmatch(r'[\w-]+', args.instance):
            parser.error('Provide an instance ID from status.')
        print(json.dumps(deployment.request(f'instances/{args.instance}/disconnect', 'POST')))
    elif args.action == 'mcp-config':
        entry = Path(deployment.config()['workerEntry']).parent / 'managed/routerMain.js'
        print(json.dumps({'command': deployment.node, 'args': [str(entry)],
                          'env': {'JS_REVERSE_MANAGER_CONFIG': str(deployment.config_file)}}, indent=2))
    else:
        # Import the real macOS adapter only when a macOS operation is requested.
        spec = importlib.util.spec_from_file_location('js_reverse_macos', deployment.repository / 'macos/manage.py')
        adapter = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(adapter)
        adapter.operate(deployment, args)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
