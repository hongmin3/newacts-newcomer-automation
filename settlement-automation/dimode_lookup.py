"""디모데 읽기 전용 조회 도구 (REQ-DIMODELOOKUP-001~004).

Mac 키체인 또는 Windows 자격 증명 관리자(kr.newacts.settlement)에 저장한 계정으로 로그인해 교인을 검색하고
원본 명단 행과 같은 사람인지 판정한다. 표준 라이브러리만 쓴다.
암호는 화면·파일·오류 문장에 남기지 않는다. 교적 수정 화면은 열지 않는다.
"""
import argparse
import html
import http.cookiejar
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser

KEYCHAIN_SERVICE = 'kr.newacts.settlement'
BASE_URL = 'https://hansungv6.dimode.co.kr'
LOGIN_PATH = '/Login/Login.aspx'
LIST_PATH = '/WebYouth/Person/PersonList.aspx?mTag=MB2'
LOGIN_PREFIX = 'ctl00$cph1$LoginMain1$'
SEARCH_PREFIX = 'ctl00$cph1$PersonListYouth1$tabConSch$tabPnSch0$'
PAGER_TARGET = 'ctl00$cph1$PersonListYouth1$AspNetPager1'
MAX_PAGES = 15
ALIASES = {'조': {'조', '아너스'}, '신': {'신', '아하'}}
SAVE_HINT = 'security add-generic-password -s kr.newacts.settlement -a <디모데 계정> -U -w'
WIN_SAVE_HINT = 'cmdkey /generic:kr.newacts.settlement /user:<디모데 계정> /pass'


class DimodeError(RuntimeError):
    pass


# --- 암호 저장소(Mac 키체인 · Windows 자격 증명 관리자) -----------------------

def _run(args):
    return subprocess.run(args, capture_output=True, text=True, check=False)


def _read_windows_credential(target):
    """Windows 일반 자격 증명에서 (계정, 암호)를 읽는다. 없으면 None."""
    import ctypes
    from ctypes import wintypes

    class CREDENTIAL(ctypes.Structure):
        _fields_ = [('Flags', wintypes.DWORD), ('Type', wintypes.DWORD),
                    ('TargetName', wintypes.LPWSTR), ('Comment', wintypes.LPWSTR),
                    ('LastWritten', wintypes.FILETIME), ('CredentialBlobSize', wintypes.DWORD),
                    ('CredentialBlob', ctypes.POINTER(ctypes.c_ubyte)), ('Persist', wintypes.DWORD),
                    ('AttributeCount', wintypes.DWORD), ('Attributes', ctypes.c_void_p),
                    ('TargetAlias', wintypes.LPWSTR), ('UserName', wintypes.LPWSTR)]

    advapi = ctypes.WinDLL('advapi32', use_last_error=True)
    advapi.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                 ctypes.POINTER(ctypes.POINTER(CREDENTIAL))]
    advapi.CredReadW.restype = wintypes.BOOL
    advapi.CredFree.argtypes = [ctypes.c_void_p]
    pointer = ctypes.POINTER(CREDENTIAL)()
    if not advapi.CredReadW(target, 1, 0, ctypes.byref(pointer)):  # 1 = CRED_TYPE_GENERIC
        return None
    try:
        cred = pointer.contents
        blob = ctypes.string_at(cred.CredentialBlob, cred.CredentialBlobSize)
        return cred.UserName or '', blob.decode('utf-16-le')
    finally:
        advapi.CredFree(pointer)


def resolve_account(account=None, env=None, run=_run, platform=None, read_cred=_read_windows_credential):
    if account:
        return account
    env = os.environ if env is None else env
    if env.get('NEWACTS_DIMODE_ACCOUNT'):
        return env['NEWACTS_DIMODE_ACCOUNT']
    if (platform or sys.platform) == 'win32':
        cred = read_cred(KEYCHAIN_SERVICE)
        if not cred or not cred[0]:
            raise DimodeError(f'자격 증명 관리자에 디모데 계정이 없습니다. PowerShell에서 직접 저장하세요: {WIN_SAVE_HINT}')
        return cred[0]
    result = run(['security', 'find-generic-password', '-s', KEYCHAIN_SERVICE])
    if result.returncode != 0:
        raise DimodeError(f'키체인에 디모데 계정이 없습니다. 터미널에서 직접 저장하세요: {SAVE_HINT}')
    match = re.search(r'"acct"<blob>=(?:0x([0-9A-Fa-f]+)|"([^"]*)")', result.stdout)
    if not match:
        raise DimodeError('키체인 항목에서 계정 이름을 읽지 못했습니다. --account로 지정하세요.')
    return bytes.fromhex(match.group(1)).decode('utf-8') if match.group(1) else match.group(2)


def read_password(account, run=_run, platform=None, read_cred=_read_windows_credential):
    if (platform or sys.platform) == 'win32':
        cred = read_cred(KEYCHAIN_SERVICE)
        if not cred or cred[0] != account or not cred[1]:
            raise DimodeError(f'자격 증명 관리자에서 이 계정의 디모데 암호를 읽지 못했습니다. 저장 방법: {WIN_SAVE_HINT}')
        return cred[1]
    result = run(['security', 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'])
    if result.returncode != 0 or not result.stdout.strip():
        raise DimodeError(f'키체인에서 디모데 암호를 읽지 못했습니다. 저장 방법: {SAVE_HINT}')
    return result.stdout.rstrip('\n')


# --- HTML 읽기 -------------------------------------------------------------

class _FormParser(HTMLParser):
    """브라우저 FormData처럼 첫 form의 전송 값을 모은다(이미지·버튼 제외)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.fields, self._depth, self._done = [], 0, False
        self._select = None
        self._options = []
        self._textarea = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if self._done:
            return
        if tag == 'form':
            self._depth += 1
            return
        if not self._depth:
            return
        name = a.get('name')
        if tag == 'input' and name:
            kind = (a.get('type') or 'text').lower()
            if kind in ('image', 'submit', 'button', 'reset', 'file'):
                return
            if kind in ('checkbox', 'radio'):
                if 'checked' in a:
                    self.fields.append((name, a.get('value') or 'on'))
                return
            self.fields.append((name, a.get('value') or ''))
        elif tag == 'select' and name:
            self._select, self._options = name, []
        elif tag == 'option' and self._select is not None:
            self._options.append((a.get('value', ''), 'selected' in a))
        elif tag == 'textarea' and name:
            self._textarea = [name, '']

    def handle_data(self, data):
        if self._textarea is not None:
            self._textarea[1] += data

    def handle_endtag(self, tag):
        if tag == 'select' and self._select is not None:
            chosen = [v for v, s in self._options if s] or [v for v, _ in self._options[:1]]
            if chosen:
                self.fields.append((self._select, chosen[0]))
            self._select = None
        elif tag == 'textarea' and self._textarea is not None:
            self.fields.append(tuple(self._textarea))
            self._textarea = None
        elif tag == 'form' and self._depth:
            self._depth -= 1
            self._done = self._depth == 0


def parse_form(text):
    parser = _FormParser()
    parser.feed(text)
    return parser.fields


def _text(fragment):
    fragment = re.sub(r'<br\s*/?>', '\n', fragment, flags=re.I)
    fragment = re.sub(r'<[^>]+>', ' ', fragment)
    return re.sub(r'[ \t\r\f\v\xa0]+', ' ', html.unescape(fragment)).strip()


def normalize_name(value):
    text = re.sub(r'\s+', '', str(value or ''))
    return re.sub(r'[A-Za-z]$', '', text)


def normalize_phone(value):
    d = re.sub(r'\D', '', str(value or ''))
    if len(d) == 11:
        return f'{d[:3]}-{d[3:7]}-{d[7:]}'
    if len(d) == 10:
        return f'{d[:3]}-{d[3:6]}-{d[6:]}'
    return ''


def normalize_birth(value):
    d = re.sub(r'\D', '', str(value or ''))
    return d[:8] if len(d) >= 8 else ''


def normalize_army(value):
    value = re.sub(r'\([^)]*\)', '', str(value or '')).strip()
    return value[:-1] if value.endswith('군') else value


def normalize_team(value):
    return re.sub(r'\s*\([^)]*\)\s*', ' ', str(value or '')).strip()


def parse_cards(text):
    starts = [m.start() for m in re.finditer(r'<table[^>]*class="tablelineno"', text)]
    cards = []
    for i, start in enumerate(starts):
        chunk = text[start: starts[i + 1] if i + 1 < len(starts) else len(text)]
        ident = re.search(r"OpenPerosonModify\('(\d+)'\);?\"[^>]*>(.*?)</span>", chunk, re.S)
        labels = {}
        for key, value in re.findall(r'<td[^>]*class="tdtitle2"[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>', chunk, re.S):
            labels.setdefault(_text(key), value)
        red = re.search(r'<td[^>]*colspan="5"[^>]*>\s*<div[^>]*color:\s*Red[^>]*>(.*?)</div>', chunk, re.S | re.I)
        orgs = []
        for line in (_text(red.group(1)).split('\n') if red else []):
            line = line.strip()
            m = re.match(r'^([^\s>(]+군)(\([^)]*\))?\s*>\s*([^>]+?)\s*(?:>.*)?$', line)
            if m:
                orgs.append({'army': normalize_army(m.group(1)), 'team': normalize_team(m.group(3)),
                             'raw': f'{m.group(1)}{m.group(2) or ""} > {normalize_team(m.group(3))}'})
        state = re.sub(r'\s*\(\s*[A-Z]\s*\)\s*$', '', _text(labels.get('교인구분', '')))
        display = _text(ident.group(2)) if ident else ''
        if not display:
            # 장년 등 일부 카드는 이름에 수정 링크가 없다. 이름 칸 글자에서 '(나이, 성별)'을 뗀다.
            display = re.sub(r'\s*\(.*$', '', _text(labels.get('이름', '')))
        cards.append({
            'id': ident.group(1) if ident else '',
            'display_name': display,
            'name': normalize_name(display),
            'phone': normalize_phone(_text(labels.get('핸드폰', ''))),
            'birth': normalize_birth(_text(labels.get('생년월일', ''))),
            'registered': _text(labels.get('등록일', '')),
            'state': state,
            'orgs': list({(o['army'], o['team']): o for o in orgs}.values()),
        })
    return cards


def _field(fields, name):
    return next((v for k, v in fields if k == name), None)


def _pages(text):
    numbers = [int(n) for n in re.findall(re.escape(PAGER_TARGET) + r"'\s*,\s*'(\d+)'", text)]
    return max([1] + numbers)


# --- HTTP -----------------------------------------------------------------

class UrllibHttp:
    def __init__(self):
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def __call__(self, method, url, fields=None):
        data = urllib.parse.urlencode(fields or []).encode() if method == 'POST' else None
        request = urllib.request.Request(url, data=data, method=method, headers={'User-Agent': 'Mozilla/5.0'})
        with self.opener.open(request, timeout=30) as response:
            return response.geturl(), response.read().decode('utf-8', errors='replace')


class DimodeClient:
    def __init__(self, http_call):
        self.http = http_call

    def login(self, account, password):
        _, page = self.http('GET', BASE_URL + LOGIN_PATH)
        fields = [(k, v) for k, v in parse_form(page)
                  if k not in (LOGIN_PREFIX + 'txtLoginID', LOGIN_PREFIX + 'txtLoginPWD')]
        fields += [(LOGIN_PREFIX + 'txtLoginID', account), (LOGIN_PREFIX + 'txtLoginPWD', password),
                   (LOGIN_PREFIX + 'imgBtnLogin.x', '10'), (LOGIN_PREFIX + 'imgBtnLogin.y', '10')]
        final_url, _ = self.http('POST', BASE_URL + LOGIN_PATH, fields)
        if '/Login/' in final_url:
            raise DimodeError('디모데 로그인에 실패했습니다. 계정 잠김을 막기 위해 다시 시도하지 않습니다. 키체인의 계정·암호를 확인하세요.')

    def _list(self, method, fields=None):
        final_url, page = self.http(method, BASE_URL + LIST_PATH, fields)
        if '/Login/' in final_url:
            raise DimodeError('디모데 로그인이 풀렸습니다.')
        return page

    def search(self, name='', phone='', all_states=False):
        if bool(name) == bool(phone):
            raise DimodeError('이름이나 전화번호 중 하나만 넣으세요.')
        empty = self._list('GET')
        overrides = {SEARCH_PREFIX + 'txtNameSch0': name, SEARCH_PREFIX + 'txtHandphoneSch0': phone}
        if all_states:
            overrides[SEARCH_PREFIX + 'ucStateSch0$ddlState'] = ''
            overrides[SEARCH_PREFIX + 'ucStateSch0$ddlState1'] = ''
        fields = [(k, v) for k, v in parse_form(empty) if k not in overrides] + list(overrides.items())
        fields += [(SEARCH_PREFIX + 'imgSearch0.x', '5'), (SEARCH_PREFIX + 'imgSearch0.y', '5')]
        page = self._list('POST', fields)
        echo = parse_form(page)
        if (_field(echo, SEARCH_PREFIX + 'txtNameSch0') or '') != name or \
           (_field(echo, SEARCH_PREFIX + 'txtHandphoneSch0') or '') != phone:
            raise DimodeError('검색 결과가 요청한 검색어와 다릅니다(이전 검색 결과가 남았을 수 있음).')
        total = _pages(page)
        if total > MAX_PAGES:
            return {'cards': [], 'pages': total, 'truncated': True}
        cards = {}
        seen_pages = set()

        def add_cards(text, number):
            parsed = parse_cards(text)
            signature = json.dumps(parsed, ensure_ascii=False, sort_keys=True)
            if signature in seen_pages:
                return
            seen_pages.add(signature)
            for index, candidate in enumerate(parsed):
                # A missing ID is not an identity: retain every such candidate.
                key = ('id', candidate['id']) if candidate['id'] else ('anonymous', number, index)
                cards[key] = candidate

        add_cards(page, 1)
        for number in range(2, total + 1):
            form = [(k, v) for k, v in parse_form(page) if k not in ('__EVENTTARGET', '__EVENTARGUMENT')]
            page = self._list('POST', form + [('__EVENTTARGET', PAGER_TARGET), ('__EVENTARGUMENT', str(number))])
            before = len(cards)
            add_cards(page, number)
            if len(cards) == before:
                raise DimodeError(f'{number}쪽에서 새 교인이 나오지 않았습니다(쪽 넘김 실패).')
        return {'cards': list(cards.values()), 'pages': total, 'truncated': False}


def open_client(account=None):
    account = resolve_account(account)
    client = DimodeClient(UrllibHttp())
    client.login(account, read_password(account))
    return client


# --- 동일인 판정 ----------------------------------------------------------

def match_person(row, searcher):
    exp = {'name': normalize_name(row.get('name')), 'phone': normalize_phone(row.get('phone')),
           'birth': normalize_birth(row.get('birth')), 'army': normalize_army(row.get('army')),
           'team': normalize_team(row.get('team'))}
    armies = ALIASES.get(exp['army'], {exp['army']})

    def org_same(c):
        return any(o['army'] in armies and (not exp['team'] or o['team'] == exp['team']) for o in c['orgs'])

    def birth_same(c):
        return bool(exp['birth']) and c['birth'] == exp['birth']

    def pick(cands, method, all_states=False):
        if len(cands) > 1 and exp['birth']:
            narrowed = [c for c in cands if birth_same(c)]
            cands = narrowed or cands
        if len(cands) == 1:
            c = cands[0]
            return {'status': 'matched', 'method': method, 'card': c, 'all_states': all_states,
                    'name_differs': c['name'] != exp['name']}
        if len(cands) > 1:
            return {'status': 'check', 'reason': f'{method} 후보 여러 명', 'candidates': cands}
        return None

    def by_phone(all_states):
        if not exp['phone']:
            return None
        result = searcher(phone=exp['phone'], all_states=all_states)
        same = [c for c in result['cards'] if c['phone'] == exp['phone']]
        return (pick([c for c in same if c['name'] == exp['name'] and (org_same(c) or birth_same(c))], '전화+이름+생년월일/군팀', all_states)
                or pick([c for c in same if c['name'] == exp['name']], '전화+이름(생년월일·소속 차이 허용)', all_states)
                or pick([c for c in same if birth_same(c) and c['name'] != exp['name']], '전화+생년월일(이름은 디모데 기준)', all_states))

    phone_found = by_phone(False)
    if phone_found and phone_found['status'] == 'matched':
        return phone_found

    def by_name(all_states):
        result = searcher(name=exp['name'], all_states=all_states)
        if result['truncated']:
            return {'status': 'check', 'reason': f'이름 검색 결과 {result["pages"]}쪽 초과', 'candidates': []}, []
        cands = [c for c in result['cards'] if c['name'] == exp['name']]
        return (pick([c for c in cands if birth_same(c)], '이름+생년월일', all_states)
                or pick([c for c in cands if org_same(c)
                         and not (exp['birth'] and c['birth'] and c['birth'] != exp['birth'])
                         and not (exp['phone'] and c['phone'] and c['phone'] != exp['phone'])],
                        '이름+군팀', all_states)), cands

    found, cands = (phone_found, []) if phone_found else by_name(False)
    if found and found['status'] == 'matched':
        return found
    # 청년 필터로 정하지 못하면 장년·새가족에서 넘어온 사람까지 넓혀 다시 찾는다.
    wide_phone = by_phone(True)
    if wide_phone:
        return wide_phone
    wide, wide_cands = by_name(True)
    if wide:
        return wide
    if found:
        return found
    if phone_found:
        return phone_found
    cands = wide_cands or cands
    reason = '이름 후보가 있으나 확정할 수 없음' if cands else '디모데 검색 결과 없음'
    return {'status': 'check', 'reason': reason, 'candidates': cands}


# --- 명령줄 ----------------------------------------------------------------

def _read_rows(path):
    stream = sys.stdin if path == '-' else open(path, encoding='utf-8')
    with stream:
        lines = [l.rstrip('\n') for l in stream if l.strip()]
    header = lines[0].split('\t')
    return [dict(zip(header, l.split('\t'))) for l in lines[1:]]


def main(argv=None):
    parser = argparse.ArgumentParser(description='디모데 읽기 전용 조회(키체인 자동 로그인). 결과는 JSON으로 화면에만 출력한다.')
    parser.add_argument('--account', help='디모데 계정(기본: 키체인 항목)')
    sub = parser.add_subparsers(dest='command', required=True)
    s = sub.add_parser('search', help='이름 또는 전화번호로 검색')
    s.add_argument('--name', default='')
    s.add_argument('--phone', default='')
    s.add_argument('--all-states', action='store_true', help='교인구분 필터를 비워 장년·새가족도 찾기')
    m = sub.add_parser('match', help='TSV 행(name, phone, birth, army, team)을 동일인 판정')
    m.add_argument('input', help="TSV 파일 경로 또는 '-'(표준 입력)")
    args = parser.parse_args(argv)
    # Windows 콘솔 기본 인코딩(cp949)으로 읽으면 한글 이름 비교가 어긋난다.
    for stream in (sys.stdin, sys.stdout):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    try:
        client = open_client(args.account)
        if args.command == 'search':
            phone = normalize_phone(args.phone) or args.phone
            output = client.search(name=args.name, phone=phone, all_states=args.all_states)
        else:
            output = [{'row': row, **match_person(row, client.search)} for row in _read_rows(args.input)]
    except DimodeError as error:
        print(f'오류: {error}', file=sys.stderr)
        return 2
    print(json.dumps(output, ensure_ascii=False, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
