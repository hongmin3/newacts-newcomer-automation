"""오늘 기준 Mac 실행. 인증·결과는 Git 제외 local/에만 둔다."""
import csv
import fcntl
import json
import os
from collections import Counter
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
LOCAL = ROOT / 'local'
SCOPE = ['https://www.googleapis.com/auth/spreadsheets']


def today():
    return datetime.now(ZoneInfo('Asia/Seoul')).date()


def totals(results):
    complete = [r for r in results if r['조회 상태'] == '조회완료']
    possible = sum(r['대상 일요일'] for r in complete)
    attended = sum(r['출석 일요일'] for r in complete)
    from desktop.metrics import army_metrics
    summaries = army_metrics(results)
    settled = sum(item['settled_count'] for item in summaries)
    return dict(settled_count=settled, settlement_rate=settled/len(results) if results else None,
                observing_count=sum(item['observing_count'] for item in summaries),
                unsettled_count=sum(item['unsettled_count'] for item in summaries),
                settlement_review_count=sum(item['settlement_review_count'] for item in summaries),
                attendance_rate=attended/possible if possible else None,
                total=len(results), eligible=sum(r['대상 일요일'] > 0 for r in results), complete=len(complete), possible=possible,
                attended=attended, rate=attended / possible if possible else None)


def require_quality(results):
    info = totals(results)
    if not info['eligible'] or info['complete'] / info['eligible'] < .95:
        raise RuntimeError('조회 완료율이 95% 미만이므로 시트를 갱신하지 않았습니다.')
    return info


def verify_summary(values, results):
    info = totals(results)
    expected = [info['total'], info['complete'], info['possible'], info['attended'], info['rate'] or 0]
    for index, value in enumerate(expected, 4):
        actual = values[index][8]
        if not isinstance(actual, (int, float)) or abs(actual-value) > 1e-9:
            raise RuntimeError('전체 요약값이 계산 결과와 다릅니다.')
    from settlement_automation import summary_rows
    for offset, summary in enumerate(summary_rows(results), 4):
        expected = [value or 0 for value in summary[1:]]
        cells = values[offset]
        if len(cells) < 6 or cells[0] != summary[0]:
            raise RuntimeError('군별 요약의 필수 칸이 없습니다.')
        for actual, value in zip(cells[1:6], expected):
            if not isinstance(actual, (int, float)) or abs(actual-value) > 1e-9:
                raise RuntimeError('군별 요약값이 계산 결과와 다릅니다.')
    if len(values) < 11 or len(values[10]) < 9:
        raise RuntimeError('새 정착률 요약 칸이 없습니다.')
    for actual, expected in ((values[9][8], info['settled_count']), (values[10][8], info['settlement_rate'] or 0)):
        if not isinstance(actual, (int, float)) or abs(actual-expected)>1e-9:
            raise RuntimeError('정착률 요약값이 계산 결과와 다릅니다.')
    for offset, summary in enumerate(summary_rows(results), 4):
        members=[r for r in results if (r.get('군') or '미배정')==summary[0]]
        settled=sum(r.get('정착상태', r.get('settlement_status'))=='정착' for r in members)
        actual=values[offset][6]
        if not isinstance(actual, (int,float)) or abs(actual-settled/len(members))>1e-9:
            raise RuntimeError('군별 정착률이 계산 결과와 다릅니다.')
    return info


def normalize_no_sundays(result, as_of):
    from datetime import date
    result = dict(result)
    registration = result['등록일']
    if isinstance(registration, str):
        registration = date.fromisoformat(registration)
    if registration and registration <= as_of and result['대상 일요일'] == 0:
        result.update({'조회 상태': '계산대상없음', '비고': '등록 이후 아직 주일이 없음'})
    return result


def google():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
    from desktop.runtime import write_private_file
    token = LOCAL / 'token.json'
    credentials = Credentials.from_authorized_user_file(str(token)) if token.exists() else None
    if credentials and credentials.refresh_token and not credentials.valid:
        credentials.refresh(Request())
    if not credentials or not credentials.valid or not credentials.has_scopes(SCOPE):
        flow = InstalledAppFlow.from_client_secrets_file(str(LOCAL / 'credentials.json'), SCOPE)
        credentials = flow.run_local_server(host='127.0.0.1', port=0)
    write_private_file(token, credentials.to_json())
    return build('sheets', 'v4', credentials=credentials)


def run():
    import runpy
    from types import SimpleNamespace
    from desktop.legacy_config import _explicit
    from desktop.runtime import write_private_file
    import settlement_automation as legacy
    from dimode_lookup import UrllibHttp, DimodeClient, resolve_account, read_password
    from playwright.sync_api import sync_playwright
    as_of = today()
    defaults = runpy.run_path(str(ROOT / 'config.example.py'))
    settings = SimpleNamespace(**{k: v for k, v in defaults.items() if k.isupper()})
    selected = _explicit.set(settings)
    try:
        with sync_playwright() as check:
            if not Path(check.chromium.executable_path).is_file():
                print('Chromium이 없습니다. local/browsers/의 브라우저를 준비해 주세요.', flush=True)
                raise RuntimeError('browser_missing')
        service = google()
        ident = legacy.spreadsheet_id_from_url(settings.SHEET_URL)
        api = service.spreadsheets().values()
        source_range = "'등록 새가족'!A:T"
        before = api.get(spreadsheetId=ident, range=source_range).execute().get('values', [])
        rows = legacy.load_source_rows(service)
        rows = [r for r in rows if legacy.parse_registration_date(r['날짜']) <= as_of]
        print(f'기준일: {as_of} / 대상: {len(rows)}명', flush=True)
        # 암호·세션은 도구 내부에서만 취급한다. 로그인은 한 번만 한다.
        http = UrllibHttp()
        client = DimodeClient(http)
        account = resolve_account()
        client.login(account, read_password(account))
        jar = next(h.cookiejar for h in http.opener.handlers if hasattr(h, 'cookiejar'))
        cookies = [dict(name=c.name, value=c.value, domain=c.domain, path=c.path,
                        secure=c.secure, httpOnly=bool(c.has_nonstandard_attr('HttpOnly')))
                   for c in jar]
        results = []
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=False)
            try:
                context = browser.new_context()
                context.add_cookies(cookies)
                page = context.new_page()
                page.goto(legacy.PERSON_LIST_URL)
                if '/Login/' in page.url:
                    raise RuntimeError('디모데 로그인 연결을 확인하지 못했습니다.')
                frame = page.locator('body')
                for i, row in enumerate(rows, 1):
                    result = legacy.collect_results(page, frame, [row],
                                legacy.RunOptions(as_of, None), on_progress=lambda *_: None)[0]
                    result = normalize_no_sundays(result, as_of)
                    result['No.'] = i
                    results.append(result)
                    if i % 10 == 0 or i == len(rows):
                        print(f'출결 조회: {i}/{len(rows)}명 / 완료 {totals(results)["complete"]}명', flush=True)
            finally:
                browser.close()
        stamp = datetime.now(ZoneInfo('Asia/Seoul')).strftime('%Y%m%d-%H%M%S-%f')
        output = LOCAL / 'results' / stamp
        output.mkdir(parents=True, mode=0o700)
        path = output / 'settlement_result.csv'
        with path.open('w', encoding='utf-8-sig', newline='') as f:
            os.chmod(path, 0o600)
            writer = csv.DictWriter(f, fieldnames=legacy.DETAIL_HEADERS, extrasaction='ignore')
            writer.writeheader(); writer.writerows(results)
        print('조회 상태: '+json.dumps(dict(Counter(r['조회 상태'] for r in results)), ensure_ascii=False), flush=True)
        info = totals(results)
        summary = {'as_of': str(as_of), **info, 'published': False}
        write_private_file(output / 'summary.json', json.dumps(summary, ensure_ascii=False, indent=2))
        if not info['eligible'] or info['complete'] / info['eligible'] < .95:
            print('조회 완료율이 95% 미만입니다. 새 CSV와 요약을 보관하고 기존 결과 탭은 유지합니다.', flush=True)
        info = require_quality(results)
        current = api.get(spreadsheetId=ident, range=source_range).execute().get('values', [])
        if current != before:
            raise RuntimeError('조회 중 원본 명단이 변경되어 시트를 갱신하지 않았습니다.')
        backup = api.get(spreadsheetId=ident, range="'정착률'!A:P").execute()
        write_private_file(output / 'previous-sheet.json', json.dumps(backup, ensure_ascii=False))
        legacy.write_result_sheet(service, results, as_of)
        readback = api.get(spreadsheetId=ident, range="'정착률'!A1:P1200", valueRenderOption="UNFORMATTED_VALUE").execute().get('values', [])
        assert readback[1][1] == as_of.isoformat(), '결과 기준일이 다릅니다.'
        actual = [r for r in readback if len(r) >= 13 and str(r[0]).isdigit()]
        assert len(actual) == len(results), '결과 인원이 다릅니다.'
        for actual_row, expected in zip(actual, results):
            assert (actual_row + [''] * (len(legacy.DETAIL_HEADERS)-len(actual_row)))[:len(legacy.DETAIL_HEADERS)] == [legacy.cell_value(expected[h]) for h in legacy.DETAIL_HEADERS], '상세 결과가 다릅니다.'
        assert api.get(spreadsheetId=ident, range=source_range).execute().get('values', []) == before, '원본 명단이 변경되었습니다.'
        verify_summary(readback, results)
        summary = {'as_of': str(as_of), **info, 'published': True}
        write_private_file(output / 'summary.json', json.dumps(summary, ensure_ascii=False, indent=2))
        print('시트 갱신·재조회 확인 완료: '+json.dumps(summary, ensure_ascii=False), flush=True)
        print('메일 발송: 0통', flush=True)
    finally:
        _explicit.reset(selected)


def main():
    LOCAL.mkdir(exist_ok=True, mode=0o700)
    os.chmod(LOCAL, 0o700)
    with (LOCAL / 'run.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('이미 정착률 조회가 실행 중입니다.', flush=True)
            return 1
        try:
            from desktop.service import ProcessLock
            shared = Path.home() / 'Library/Application Support/NewactsSettlement/execution.lock'
            shared.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with ProcessLock(shared):
                run()
            return 0
        except Exception as error:
            print(f'실행 중단 ({type(error).__name__}). 인증 또는 연결과 local/results의 조회 상태를 확인해 주세요.', flush=True)
            return 1


if __name__ == '__main__':
    raise SystemExit(main())
