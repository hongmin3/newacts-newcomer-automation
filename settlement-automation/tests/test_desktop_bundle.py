"""Validates: REQ-RATEDESKTOP-001. Missing assets fail; credentials never ship."""
import tempfile
import unittest
from pathlib import Path

class BundleTests(unittest.TestCase):
    def test_bundle_without_chromium_fails_preflight(self):
        from desktop.bundle import check_browser
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(RuntimeError): check_browser(Path(folder))

    def test_bundle_input_with_credentials_is_refused(self):
        from desktop.bundle import audit_payload
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'credentials.json').write_text('{"installed":{"client_secret":"fake"}}')
            with self.assertRaises(RuntimeError): audit_payload(root)

    def test_benign_name_cannot_hide_oauth_content(self):
        from desktop.bundle import audit_payload
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'benign.json').write_text('{"refresh_token":"fake"}')
            with self.assertRaises(RuntimeError): audit_payload(root)

    def test_clean_payload_passes(self):
        from desktop.bundle import audit_payload
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); (root/'config.example.py').write_text('USER_PW = ""')
            audit_payload(root)

    def test_public_api_schema_is_not_a_credential(self):
        from desktop.bundle import audit_payload
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'api.json').write_text('{"password":{"type":"string"}}')
            audit_payload(root)
