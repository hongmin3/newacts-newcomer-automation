"""Allow-listed guidance and private diagnostics; never retain exception messages."""
import json
import errno
import os
import uuid
from dataclasses import dataclass

# Messages are product text, not interpolated provider errors or roster values.
GUIDANCE = {
    'sheet_structure': '관리 탭의 소유 정보와 열 구성을 확인해 주세요. 기존 내용을 보존한 채 담당자에게 확인을 요청하세요.',
    'duplicate_id': '새가족 돌봄 기록의 디모데 ID가 중복되어 있습니다. 담당자가 중복 행을 확인한 뒤 이어서 실행해 주세요.',
    'oauth_file': 'Google 인증 파일 형식이 올바르지 않습니다. Desktop OAuth JSON 파일을 다시 선택해 주세요.',
    'google_reauthorize': 'Google 승인이 만료되었거나 토큰을 읽을 수 없습니다. 인증 다시 설정에서 Google 계정을 다시 승인해 주세요.',
    'account': '디모데 계정과 암호를 입력하고 최초 설정을 완료해 주세요.',
    'date': '명단 시작일·종료일과 기준일을 확인해 주세요. 시작일은 종료일보다 늦을 수 없습니다.',
    'settings': '설정 파일의 항목과 형식을 확인하고 최초 설정을 다시 완료해 주세요.',
    'file_access': '선택한 인증 파일과 앱 저장 폴더의 접근 권한·저장 공간을 확인해 주세요.',
    'connection': '일시적으로 연결하지 못했습니다. 연결을 확인한 뒤 같은 작업을 다시 시도해 주세요.',
    'authentication': 'Google 승인과 디모데 로그인을 확인해 주세요. 인증 다시 설정에서 다시 승인할 수 있습니다.',
    'validation': '입력 또는 저장된 자료 형식을 확인해야 합니다. 진단 번호를 담당자에게 전달해 주세요.',
    'external': '외부 서비스 작업을 완료하지 못했습니다. 연결 상태를 확인하고 진단 번호를 담당자에게 전달해 주세요.',
}

class ValidationIssue(ValueError):
    def __init__(self, code, *, tab=None):
        if code not in GUIDANCE: code='validation'
        self.code=code
        # Only constant product tab names may be shown, never arbitrary data.
        self.tab=tab if tab in ('군별 정착 현황','정착률 월별 이력','새가족 돌봄 기록') else None
        super().__init__(GUIDANCE[code])

@dataclass(frozen=True)
class Failure:
    code: str
    guidance: str
    diagnostic_id: str
    retryable: bool


def diagnose(error, stage, paths):
    if isinstance(error,ValidationIssue): code=error.code; error_type='validation'
    elif isinstance(error,(TimeoutError,ConnectionError)): code='connection'; error_type='connection'
    elif isinstance(error,(PermissionError,FileNotFoundError,IsADirectoryError)): code='file_access'; error_type='file_access'
    elif isinstance(error,OSError):
        code='file_access' if stage=='setup' or error.errno in (errno.EACCES,errno.ENOSPC,errno.EROFS) else 'external'
        error_type='os_error'
    elif isinstance(error,ValueError): code='validation'; error_type='validation'
    else: code='authentication' if stage=='authentication' else 'external'; error_type='external'
    diagnostic_id=uuid.uuid4().hex[:12]
    guidance=GUIDANCE[code]
    if isinstance(error,ValidationIssue) and error.tab: guidance=error.tab+': '+guidance
    stage=stage if stage in ('setup','authentication','roster','query','quality','publication','history','preview','delivery') else 'other'
    record={'diagnostic_id':diagnostic_id,'code':code,'stage':stage,'error_type':error_type}
    try:
        paths.ensure_directories()
        fd=os.open(paths.log_file,os.O_CREAT|os.O_WRONLY|os.O_APPEND,0o600)
        with os.fdopen(fd,'a',encoding='utf-8') as stream:
            os.fchmod(stream.fileno(),0o600)
            stream.write(json.dumps(record,ensure_ascii=False)+'\n')
    except OSError:
        guidance+=' 진단 기록을 저장하지 못했습니다. 앱 저장 폴더 권한을 확인해 주세요.'
    return Failure(code,guidance+' (진단 번호: '+diagnostic_id+')',diagnostic_id,code in ('connection','external','authentication'))
