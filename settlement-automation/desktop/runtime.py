"""User-owned data and bundled read-only resources have separate lifetimes."""
import os
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

APP_NAME = 'NewactsSettlement'
KEYCHAIN_SERVICE = 'kr.newacts.settlement'


@dataclass(frozen=True)
class RuntimePaths:
    data_root: Path
    log_root: Path

    @classmethod
    def for_user(cls, home: Path):
        home = Path(home).expanduser().resolve()
        return cls(home / 'Library/Application Support' / APP_NAME,
                   home / 'Library/Logs' / APP_NAME)

    @property
    def settings_file(self):
        return self.data_root / 'settings.json'

    @property
    def oauth_client_file(self):
        return self.data_root / 'credentials.json'

    @property
    def oauth_token_file(self):
        return self.data_root / 'token.json'

    @property
    def history_file(self):
        return self.data_root / 'history.sqlite3'

    @property
    def runs_dir(self):
        return self.data_root / 'runs'

    @property
    def log_file(self):
        return self.log_root / 'app.log'

    def ensure_directories(self):
        for directory in (self.data_root, self.log_root, self.runs_dir):
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            directory.chmod(0o700)


def resource_path(relative: str) -> Path:
    """Resolve packaged resources without using that directory for user data."""
    name = Path(relative)
    if name.is_absolute() or '..' in name.parts:
        raise ValueError('리소스 경로는 앱 안의 상대 경로여야 합니다.')
    root = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1]))
    return root / name


def write_private_file(path: Path, content: str) -> None:
    """Atomically replace a text file, private even during the temporary write."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            if hasattr(os, 'fchmod'):
                os.fchmod(handle.fileno(), 0o600)
            else:
                # Windows lacks fchmod. Keep its legacy CLI usable while
                # retaining POSIX 0600 protection on macOS.
                os.chmod(temporary, 0o600)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class SecretStore:
    """Mac Keychain only. No plaintext or generic keyring backend fallback."""
    def __init__(self, backend=None):
        if backend is None:
            if sys.platform != 'darwin':
                raise RuntimeError('Mac 키체인은 macOS에서만 사용할 수 있습니다.')
            from keyring.backends.macOS import Keyring
            backend = Keyring()
        self._backend = backend

    def get_password(self, account: str) -> str | None:
        if not account:
            return None
        try:
            return self._backend.get_password(KEYCHAIN_SERVICE, account)
        except Exception:
            raise RuntimeError('키체인에서 암호를 읽지 못했습니다.') from None

    def set_password(self, account: str, password: str) -> None:
        if not account or not password:
            raise ValueError('계정과 암호를 입력해 주세요.')
        try:
            self._backend.set_password(KEYCHAIN_SERVICE, account, password)
        except Exception:
            raise RuntimeError('키체인에 암호를 저장하지 못했습니다.') from None
