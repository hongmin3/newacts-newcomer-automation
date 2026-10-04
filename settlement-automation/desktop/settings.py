"""Explicit allow-list of non-secret app settings, independent of CLI config.py."""
import json
import runpy
from dataclasses import asdict, dataclass, fields
from datetime import date
from pathlib import Path

from .runtime import RuntimePaths, resource_path, write_private_file


@dataclass(frozen=True)
class AppSettings:
    sheet_url: str
    source_sheet_name: str
    result_sheet_name: str
    dimode_url: str
    oauth_client_file: Path
    oauth_token_file: Path
    dimode_account: str = ''
    roster_start: str | None = None
    roster_end: str | None = None
    army_order: tuple[str, ...] = ('신', '조', '명', '총', '석', '전', '영', '슬', '임')
    min_query_completion_rate: float = 0.95

    def validate(self):
        start = date.fromisoformat(self.roster_start) if self.roster_start else None
        end = date.fromisoformat(self.roster_end) if self.roster_end else None
        if start and end and start > end:
            raise ValueError('명단 시작일은 종료일보다 늦을 수 없습니다.')
        if self.min_query_completion_rate != 0.95:
            raise ValueError('조회 완료율 기준은 0.95입니다.')
        if not self.oauth_client_file.is_absolute() or not self.oauth_token_file.is_absolute():
            raise ValueError('인증 파일에는 전체 경로를 사용해 주세요.')


def load_settings(paths: RuntimePaths) -> AppSettings:
    defaults = runpy.run_path(str(resource_path('config.example.py')))
    settings = dict(sheet_url=defaults['SHEET_URL'],
                    source_sheet_name=defaults['SOURCE_SHEET_NAME'],
                    result_sheet_name=defaults['RESULT_SHEET_NAME'],
                    dimode_url=defaults['DIMODE_URL'],
                    oauth_client_file=paths.oauth_client_file,
                    oauth_token_file=paths.oauth_token_file)
    if paths.settings_file.exists():
        saved = json.loads(paths.settings_file.read_text(encoding='utf-8'))
        allowed = {field.name for field in fields(AppSettings)}
        if not isinstance(saved, dict) or set(saved) - allowed:
            raise ValueError('설정 파일에 지원하지 않는 항목이 있습니다.')
        settings.update(saved)
    for key in ('oauth_client_file', 'oauth_token_file'):
        settings[key] = Path(settings[key])
    if 'army_order' in settings:
        settings['army_order'] = tuple(settings['army_order'])
    result = AppSettings(**settings)
    result.validate()
    return result


def save_settings(paths: RuntimePaths, settings: AppSettings) -> None:
    settings.validate()
    paths.ensure_directories()
    payload = asdict(settings)
    for key in ('oauth_client_file', 'oauth_token_file'):
        payload[key] = str(payload[key])
    write_private_file(paths.settings_file, json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
