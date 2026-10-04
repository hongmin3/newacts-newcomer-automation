"""Lazy CLI config boundary; desktop adapters supply non-secret explicit settings."""
import importlib
from contextlib import contextmanager
from contextvars import ContextVar
from types import SimpleNamespace

_explicit = ContextVar('settlement_explicit_config', default=None)


class LazyConfig:
    def __getattr__(self, name):
        selected = _explicit.get()
        if selected is not None:
            return getattr(selected, name)
        return getattr(importlib.import_module('config'), name)


config = LazyConfig()


@contextmanager
def use_settings(settings):
    value = SimpleNamespace(SHEET_URL=settings.sheet_url,
        SOURCE_SHEET_NAME=settings.source_sheet_name, RESULT_SHEET_NAME=settings.result_sheet_name,
        DIMODE_URL=settings.dimode_url, GOOGLE_OAUTH_CLIENT_FILE=settings.oauth_client_file,
        GOOGLE_OAUTH_TOKEN_FILE=settings.oauth_token_file,
        SEARCH_DELAY=.8, PAGE_DELAY=.3, LOGIN_WAIT_SECONDS=300)
    token = _explicit.set(value)
    try: yield
    finally: _explicit.reset(token)
