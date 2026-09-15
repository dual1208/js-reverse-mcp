"""macOS adapter contract; native tools are substituted, real plists are inspected."""
from contextlib import redirect_stdout
import importlib.util
import io
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from browser_services.deployment import Deployment, private_json


@unittest.skipUnless(sys.platform == 'darwin', 'macOS adapter test')
class MacOSAdapterTests(unittest.TestCase):
    def test_install_uses_shared_release_commands_and_keeps_launchd_settings(self):
        repo = Path(__file__).resolve().parents[2]
        spec = importlib.util.spec_from_file_location('macos_adapter_test', repo / 'macos/manage.py')
        adapter = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(adapter)
        with tempfile.TemporaryDirectory(prefix='js reverse macos adapter ') as temporary:
            root = Path(temporary).resolve()
            profiles = {name: str(root / name) for name in ('cesar', 'tyson')}
            for profile in profiles.values():
                private_json(Path(profile) / 'Default/Preferences', {})
            file = root / 'config.json'
            private_json(file, {'version': 1, 'stateDir': str(root / 'state'), 'profiles': profiles,
                                'workerEntry': str(repo / 'build/src/index.js'), 'allowedRoots': [str(root / 'output')]})
            deployment = Deployment(repo, file)
            commands = []

            def external(argv, **_options):
                commands.append([str(arg) for arg in argv])
                if argv[0] == 'xcrun':
                    Path(argv[-1]).write_text('fixture menu executable')
                return subprocess.CompletedProcess(argv, 0)

            absent = subprocess.CompletedProcess([], 1)
            with patch('browser_services.deployment.run', external), patch.object(adapter, 'run', external), \
                 patch.object(adapter, 'stop') as stop, patch.object(adapter.subprocess, 'run', return_value=absent), \
                 patch.object(adapter.subprocess, 'check_output', return_value=''), \
                 patch.object(Path, 'home', return_value=root), \
                 patch.object(deployment, 'request', return_value={'profiles': [{'running': True}, {'running': True}]}), \
                 redirect_stdout(io.StringIO()):
                adapter.operate(deployment, SimpleNamespace(action='install', cesar=None, tyson=None, with_opencli=False))
            self.assertEqual([call.args[0] for call in stop.call_args_list], list(reversed(adapter.JOBS)))
            for name, command in deployment.jobs().items():
                with (root / 'Library/LaunchAgents' / (adapter.label(name) + '.plist')).open('rb') as stream:
                    definition = plistlib.load(stream)
                self.assertEqual(definition['ProgramArguments'], command)
                self.assertEqual(definition['EnvironmentVariables'], {'JS_REVERSE_MANAGER_CONFIG': str(file)})
                self.assertTrue(definition['KeepAlive'])
                self.assertEqual(definition['LimitLoadToSessionType'], 'Aqua')
            self.assertTrue((root / 'Applications/JS-Reverse.app/Contents/MacOS/JSReverseMenu').exists())
            self.assertEqual(deployment.config()['profiles'], profiles)
            self.assertEqual(len([command for command in commands if command[:2] == ['launchctl', 'bootstrap']]), 4)
