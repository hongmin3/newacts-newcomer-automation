"""Windows boundary around the existing read-only HTTP lookup implementation."""
import http.cookiejar
import importlib.util
import json
import pathlib
import urllib.parse
import urllib.request

from windows_runtime import protect_secret,unprotect_secret

ORIGIN='https://hansungv6.dimode.co.kr'
LOGIN='/Login/Login.aspx'
LIST='/WebYouth/Person/PersonList.aspx?mTag=MB2'
DEFAULT='/WebYouth/Default.aspx'
SEARCH='ctl00$cph1$PersonListYouth1$tabConSch$tabPnSch0$imgSearch0'
LOGIN_BUTTON='ctl00$cph1$LoginMain1$imgBtnLogin'
PAGER='ctl00$cph1$PersonListYouth1$AspNetPager1'


def validate_http_request(method,url,fields=()):
    parsed=urllib.parse.urlsplit(url)
    origin=parsed.scheme+'://'+parsed.netloc
    path=parsed.path+('?' + parsed.query if parsed.query else '')
    if origin!=ORIGIN or parsed.fragment or path not in (LOGIN,LIST,DEFAULT):
        raise ValueError('허용하지 않은 디모데 읽기 주소입니다.')
    if method=='GET': return True
    if method!='POST' or path==DEFAULT: raise ValueError('디모데 변경 요청을 차단했습니다.')
    values=dict(fields); event=values.get('__EVENTTARGET','')
    buttons=[k for k,v in fields if k.endswith(('.x','.y'))]
    if any(any(word in k.lower() for word in ('save','delete','modify','register')) for k,v in fields):
        raise ValueError('교적 변경 필드가 있어 요청을 차단했습니다.')
    if path==LOGIN:
        valid=not event and bool(buttons) and all(k in (LOGIN_BUTTON+'.x',LOGIN_BUTTON+'.y') for k in buttons)
    else:
        valid=(event==PAGER and not buttons and str(values.get('__EVENTARGUMENT','')).isdigit()) or (
            not event and bool(buttons) and all(k in (SEARCH+'.x',SEARCH+'.y') for k in buttons))
    if not valid: raise ValueError('확인되지 않은 디모데 폼 동작을 차단했습니다.')
    return True


class GuardedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        validate_http_request('GET',newurl)
        return super().redirect_request(req,fp,code,msg,headers,newurl)


class ReadOnlyHttp:
    def __init__(self):
        self.opener=urllib.request.build_opener(GuardedRedirect(),
                urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def __call__(self,method,url,fields=None):
        validate_http_request(method,url,fields or [])
        body=urllib.parse.urlencode(fields).encode() if method=='POST' else None
        request=urllib.request.Request(url,data=body,method=method,headers={'User-Agent':'Mozilla/5.0'})
        with self.opener.open(request,timeout=30) as response:
            validate_http_request('GET',response.geturl())
            return response.geturl(),response.read().decode('utf-8',errors='replace')


def lookup_module():
    path=pathlib.Path(__file__).resolve().parents[1]/'settlement-automation'/'dimode_lookup.py'
    spec=importlib.util.spec_from_file_location('newacts_readonly_lookup',path)
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def save_credentials(path,account,password):
    if not account or not password: raise ValueError('계정과 암호가 필요합니다.')
    pathlib.Path(path).write_bytes(protect_secret(json.dumps({'account':account,'password':password}).encode()))
    pathlib.Path(path).with_suffix('.blocked').unlink(missing_ok=True)


def open_reader(secret_path):
    secret_path=pathlib.Path(secret_path)
    if not secret_path.exists(): raise ValueError('Windows용 디모데 인증을 먼저 설정하세요.')
    if secret_path.with_suffix('.blocked').exists():
        raise ValueError('이전 로그인 실패 후 잠금 상태입니다. 계정·암호를 직접 확인해 인증을 다시 설정하세요.')
    secret=json.loads(unprotect_secret(secret_path.read_bytes()))
    module=lookup_module(); client=module.DimodeClient(ReadOnlyHttp())
    try: client.login(secret['account'],secret['password'])
    except Exception:
        secret_path.with_suffix('.blocked').touch()
        raise ValueError('디모데 로그인 실패. 자동 재시도하지 않습니다. 담당자가 인증을 확인하세요.') from None
    return client


def production_writer(mode,profile):
    # An unverified page profile must never be turned into a live registration writer.
    raise ValueError('운영 교적 저장은 아직 활성화하지 않았습니다. 등록 화면·권한·재조회 경계를 먼저 확인해야 합니다.')
