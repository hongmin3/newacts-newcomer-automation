"""Validates: REQ-RATEDESKTOP-001 (runtime/settings foundation)."""
import io
import json
import logging
import stat
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from desktop.runtime import RuntimePaths, SecretStore, resource_path, write_private_file
from desktop.settings import load_settings, save_settings


class DesktopRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.paths = RuntimePaths.for_user(self.home)

    def test_app_replacement_preserves_user_data(self):
        with patch('sys.executable', '/Applications/First.app/Contents/MacOS/app'):
            first = RuntimePaths.for_user(self.home)
        with patch('sys.executable', '/Applications/Replacement.app/Contents/MacOS/app'):
            second = RuntimePaths.for_user(self.home)
        self.assertEqual(first.data_root, second.data_root)
        self.assertEqual(first.data_root.parent, self.home / 'Library/Application Support')
        self.assertEqual(first.log_root.parent, self.home / 'Library/Logs')
        first.ensure_directories()
        write_private_file(first.history_file, 'retained')
        self.assertEqual(second.history_file.read_text(), 'retained')
        self.assertEqual(stat.S_IMODE(first.data_root.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(first.history_file.stat().st_mode), 0o600)

    def test_password_never_enters_settings_or_logs(self):
        backend = MemoryKeychain()
        store = SecretStore(backend=backend)
        secret = 'fake-secret-do-not-persist'
        captured = io.StringIO()
        handler = logging.StreamHandler(captured)
        logging.getLogger().addHandler(handler)
        self.addCleanup(logging.getLogger().removeHandler, handler)
        store.set_password('fake-account', secret)
        self.assertEqual(store.get_password('fake-account'), secret)
        settings = replace(load_settings(self.paths), dimode_account='fake-account')
        save_settings(self.paths, settings)
        self.assertEqual(load_settings(self.paths), settings)
        self.assertNotIn(secret, self.paths.settings_file.read_text() + captured.getvalue() + repr(store))
        self.assertEqual(stat.S_IMODE(self.paths.settings_file.stat().st_mode), 0o600)
        self.assertEqual(settings.oauth_token_file, self.paths.oauth_token_file)

    def test_missing_config_uses_safe_test_bootstrap(self):
        import config
        self.assertFalse(config.USER_ID)
        self.assertFalse(config.USER_PW)
        self.assertIn('test-only', config.SHEET_URL)
        self.assertEqual(config.ADMIN_RECIPIENTS, [])

    def test_settings_reject_secret_and_unknown_fields(self):
        self.paths.ensure_directories()
        write_private_file(self.paths.settings_file, json.dumps({'password': 'fake'}))
        with self.assertRaises(ValueError):
            load_settings(self.paths)

    def test_settings_reject_invalid_date_range(self):
        settings = replace(load_settings(self.paths), roster_start='2026-12-31', roster_end='2026-01-01')
        with self.assertRaises(ValueError):
            save_settings(self.paths, settings)
        self.assertFalse(self.paths.settings_file.exists())

    def test_resource_path_follows_bundle_only_for_resources(self):
        with patch('sys._MEIPASS', str(self.home / 'bundle'), create=True):
            self.assertEqual(resource_path('assets/icon.png'), self.home / 'bundle/assets/icon.png')
        with self.assertRaises(ValueError):
            resource_path('../token.json')


class MemoryKeychain:
    def __init__(self):
        self.entries = {}
    def get_password(self, service, account):
        return self.entries.get((service, account))
    def set_password(self, service, account, password):
        self.entries[(service, account)] = password


class AuthBoundaryTest(unittest.TestCase):
    def test_google_auth_uses_explicit_paths_and_private_token(self):
        import sys
        import types
        import settlement_automation as automation
        with tempfile.TemporaryDirectory() as temporary:
            paths = RuntimePaths.for_user(Path(temporary))
            paths.ensure_directories()
            write_private_file(paths.oauth_client_file, '{}')
            class Credentials:
                valid = True
                expired = False
                refresh_token = None
                def has_scopes(self, scopes):
                    return True
                def to_json(self):
                    return '{"fake-token": true}'
                @classmethod
                def from_authorized_user_file(cls, filename):
                    return cls()
            modules = {}
            for name in ('google', 'google.auth', 'google.auth.transport', 'google.auth.transport.requests',
                         'google.oauth2', 'google.oauth2.credentials', 'google_auth_oauthlib',
                         'google_auth_oauthlib.flow'):
                modules[name] = types.ModuleType(name)
            modules['google.auth.transport.requests'].Request = object
            modules['google.oauth2.credentials'].Credentials = Credentials
            class Flow:
                @classmethod
                def from_client_secrets_file(cls, filename, scopes):
                    if Path(filename) != paths.oauth_client_file:
                        raise AssertionError('wrong client file')
                    return cls()
                def run_local_server(self, port):
                    return Credentials()
            modules['google_auth_oauthlib.flow'].InstalledAppFlow = Flow
            with patch.dict(sys.modules, modules):
                automation.get_google_credentials(paths=paths)
            self.assertEqual(json.loads(paths.oauth_token_file.read_text()), {'fake-token': True})
            self.assertEqual(stat.S_IMODE(paths.oauth_token_file.stat().st_mode), 0o600)

    def test_keychain_failure_does_not_expose_backend_exception(self):
        class FailingBackend:
            def set_password(self, service, account, password):
                raise RuntimeError(password)
        store = SecretStore(backend=FailingBackend())
        with self.assertRaises(RuntimeError) as raised:
            store.set_password('fake', 'fake-secret')
        self.assertNotIn('fake-secret', str(raised.exception))


    def test_dimode_login_accepts_injected_secret_store(self):
        import settlement_automation as automation
        class Page:
            url = 'https://example.invalid/Login/'
            def locator(self, selector):
                return Locator(self, selector)
            def wait_for_load_state(self, state, timeout):
                pass
        class Locator:
            def __init__(self, page, selector):
                self.page, self.selector = page, selector
                self.first = self
            def fill(self, value):
                if self.selector == 'input[type="text"]':
                    self.page.account = value
                else:
                    self.page.password = value
            def press(self, value):
                self.page.url = 'https://example.invalid/Person/'
        backend = MemoryKeychain()
        store = SecretStore(backend=backend)
        store.set_password('fake-id', 'fake-password')
        page = Page()
        automation.wait_for_login(page, account='fake-id', secret_store=store)
        self.assertEqual(page.account, 'fake-id')
        self.assertEqual(page.password, 'fake-password')
