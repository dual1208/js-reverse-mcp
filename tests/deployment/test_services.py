"""Contract tests with real temporary files and an external package installer stub."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from browser_services.deployment import Deployment, private_json
from browser_services.opencli import prepare_bridge


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='browser services space ')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.repo = self.root / 'checkout'
        (self.repo / 'build/src/managed').mkdir(parents=True)
        (self.repo / 'build/src/managed/routerMain.js').write_text('export {};')
        (self.repo / 'build/src/index.js').write_text('export {};')
        (self.repo / 'package.json').write_text('{"type":"module"}')
        (self.repo / 'package-lock.json').write_text('{}')
        self.profiles = {name: str(self.root / name) for name in ('cesar', 'tyson')}
        for root in self.profiles.values():
            (Path(root) / 'Default').mkdir(parents=True)
            (Path(root) / 'Default/Preferences').write_text('{}')
        self.config = {'version': 1, 'stateDir': str(self.root / 'private state'),
                       'profiles': self.profiles, 'workerEntry': str(self.repo / 'build/src/index.js'),
                       'allowedRoots': [str(self.root / 'observations')], 'futureSetting': {'keep': True}}
        self.file = self.root / 'config.json'
        private_json(self.file, self.config)
        self.deployment = Deployment(self.repo, self.file)

    def install_dependencies(self, _argv, **options):
        modules = Path(options['cwd']) / 'node_modules'
        modules.mkdir()
        (modules / 'installed.txt').write_text('locked dependencies')
        return subprocess.CompletedProcess(_argv, 0)

    def test_release_is_independent_and_preserves_configuration(self):
        with patch('browser_services.deployment.run', self.install_dependencies):
            prepared = self.deployment.prepare()
        self.assertEqual(self.deployment.config(), self.config, 'Preparation must not activate')
        (self.repo / 'build/src/index.js').write_text('changed checkout')
        self.assertEqual((prepared.release / 'build/src/index.js').read_text(), 'export {};')
        self.assertFalse((prepared.release / 'node_modules').is_symlink())
        backup = prepared.activate()
        self.assertEqual(json.loads((backup / 'config.json').read_text()), self.config)
        self.assertEqual(self.deployment.config()['futureSetting'], {'keep': True})
        self.assertEqual(self.deployment.config()['profiles'], self.profiles)
        for command in self.deployment.jobs().values():
            self.assertTrue(str(prepared.release) in command[1])
            self.assertTrue(Path(command[1]).is_absolute())

    def test_live_owner_and_concurrent_edits_block_activation(self):
        with patch('browser_services.deployment.run', self.install_dependencies):
            prepared = self.deployment.prepare()
        runtime = Path(self.config['stateDir']) / 'cesar.json'
        private_json(runtime, {'pid': os.getpid()})
        with self.assertRaisesRegex(ValueError, 'still running'):
            prepared.activate()
        runtime.unlink()
        private_json(self.file, {**self.config, 'newSetting': True})
        with self.assertRaisesRegex(ValueError, 'changed during preparation'):
            prepared.activate()
        self.assertTrue(self.deployment.config()['newSetting'])

    def test_invalid_profiles_fail_before_installation(self):
        with patch('browser_services.deployment.run') as installer:
            with self.assertRaisesRegex(ValueError, 'separate'):
                self.deployment.prepare(tyson=self.profiles['cesar'])
            with self.assertRaises(FileNotFoundError):
                self.deployment.prepare(tyson=str(self.root / 'missing'))
            installer.assert_not_called()
        self.assertEqual(self.deployment.config(), self.config)

    def test_install_failure_preserves_active_configuration(self):
        with patch('browser_services.deployment.run', side_effect=RuntimeError('npm failed')):
            with self.assertRaisesRegex(RuntimeError, 'npm failed'):
                self.deployment.prepare()
        self.assertEqual(self.deployment.config(), self.config)
        self.assertEqual(list((Path(self.config['stateDir']) / 'releases').iterdir()), [])

    def test_operation_excludes_another_supervisor_and_releases_on_failure(self):
        with self.deployment.operation():
            with self.assertRaisesRegex(ValueError, 'Another deployment'):
                with self.deployment.operation():
                    self.fail('Second owner was admitted')
        with self.deployment.operation():
            pass

    def test_control_never_sends_capability_to_remote_host(self):
        private_json(Path(self.config['stateDir']) / 'manager.json', {
            'pid': os.getpid(), 'url': 'http://example.org:1234', 'token': 'test-only',
        })
        with self.assertRaisesRegex(ValueError, 'loopback'):
            self.deployment.request()

    def test_bridge_checksums_and_existing_identity(self):
        assets = {'manifest.json': b'{"name":"OpenCLI"}', 'dist/background.js': b'// fixture'}
        lock = {'repository': 'example/fixture', 'revision': 'a' * 40,
                'files': {name: hashlib.sha256(content).hexdigest() for name, content in assets.items()}}
        private_json(self.repo / 'integrations/opencli/bridge-lock.json', lock)
        state = Path(self.config['stateDir'])
        bridge = prepare_bridge(self.repo, state, fetch=lambda url: assets[url.split('/extension/')[1]])
        self.assertTrue((bridge / 'dist/background.js').exists())
        # Existing path may predate this installer. Keeping it preserves Chrome ID/storage.
        legacy = state / 'existing bridge'
        bridge.rename(legacy)
        self.assertEqual(prepare_bridge(self.repo, state, [legacy], fetch=lambda _: self.fail()), legacy)
        (legacy / 'dist/background.js').write_text('tampered')
        with self.assertRaisesRegex(ValueError, 'differs from the lock'):
            prepare_bridge(self.repo, state, [legacy])
        with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
            prepare_bridge(self.repo, state, fetch=lambda _: b'incorrect')
        self.assertFalse(bridge.exists(), 'Failed download must not become an installed bridge')

    def test_cli_configuration_and_macos_boundary(self):
        cli = Path(__file__).resolve().parents[2] / 'scripts/managed.py'
        result = subprocess.run([sys.executable, str(cli), 'mcp-config', '--config', str(self.file)],
                                capture_output=True, text=True, check=True)
        config = json.loads(result.stdout)
        self.assertEqual(config['env']['JS_REVERSE_MANAGER_CONFIG'], str(self.file))
        self.assertTrue(Path(config['args'][0]).is_absolute())
        self.assertFalse('launchctl' in result.stdout)


if __name__ == '__main__':
    unittest.main()
