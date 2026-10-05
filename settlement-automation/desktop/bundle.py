"""Strict packaging checks; callers supply an explicit read-only payload root."""
import json
from pathlib import Path

FORBIDDEN = {'config.py','credentials.json','token.json','settings.json','history.sqlite3', '.env'}
SECRET_KEYS = {'refresh_token','access_token','client_secret','private_key','password','user_pw'}

def audit_payload(root: Path):
    root=Path(root)
    if not root.is_dir(): raise RuntimeError('검사할 앱 폴더가 없습니다.')
    count=0
    for path in root.rglob('*'):
        if not path.is_file(): continue
        count+=1
        trusted_ca = path.name == 'cacert.pem' and path.parent.name == 'certifi'
        if path.name.lower() in FORBIDDEN or (path.suffix.lower() in {'.csv','.sqlite3','.pem','.key'} and not trusted_ca):
            raise RuntimeError('앱 입력에 인증 또는 사용자 데이터가 포함되어 있습니다.')
        if path.suffix.lower()=='.json' and path.stat().st_size < 2_000_000:
            try: value=json.loads(path.read_text())
            except (ValueError,UnicodeError): continue
            def sensitive(obj):
                if isinstance(obj,dict):
                    return any((str(k).lower() in SECRET_KEYS and isinstance(v,str) and bool(v)) or sensitive(v) for k,v in obj.items())
                return isinstance(obj,list) and any(sensitive(v) for v in obj)
            if sensitive(value): raise RuntimeError('앱 입력에 인증 정보가 포함되어 있습니다.')
    if not count: raise RuntimeError('앱 입력 폴더가 비어 있습니다.')
    return count

def check_browser(root: Path):
    root=Path(root).resolve()
    engines=list(root.glob('chromium-*/chrome-mac*/*.app/Contents/MacOS/*'))
    shells=list(root.glob('chromium_headless_shell-*/chrome-headless-shell-mac*/chrome-headless-shell'))
    if not engines or not shells or not all(p.is_file() for p in engines+shells):
        raise RuntimeError('앱에 Chromium 실행 파일이 없습니다.')
    return root

if __name__=='__main__':
    import sys
    try: print('앱 포함 파일 검사 통과:',audit_payload(Path(sys.argv[1])))
    except Exception as exc: print(str(exc),file=sys.stderr); sys.exit(1)
