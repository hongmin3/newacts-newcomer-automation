import hashlib
import os
import pathlib
import shutil
import uuid


def file_hash(path):
    with open(path,'rb') as stream: return hashlib.file_digest(stream,'sha256').hexdigest()


def publish_bulletin(source,target,expected_target_hash):
    source,target=pathlib.Path(source).resolve(),pathlib.Path(target).resolve()
    if source==target or target.suffix.lower() not in ('.hwp','.hwpx') or source.suffix.lower()!=target.suffix.lower():
        raise ValueError('별도 한글 대상 파일이 필요합니다.')
    if expected_target_hash is not None:
        # Replacing a shared edited document needs a separate reviewed backup flow.
        raise ValueError('기존 최종본 교체는 지원하지 않습니다. 별도 파일명을 선택하세요.')
    if target.exists(): raise ValueError('다른 파일이 이미 있습니다. 덮어쓰지 않습니다.')
    temporary=target.with_name('.'+target.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        with open(source,'rb') as src, open(temporary,'xb') as out:
            shutil.copyfileobj(src,out); out.flush(); os.fsync(out.fileno())
        expected=file_hash(source)
        if file_hash(temporary)!=expected: raise ValueError('복사본 해시 불일치')
        # Windows rename does not overwrite an existing destination, including SMB.
        if os.name=='nt': os.rename(temporary,target)
        else:
            os.link(temporary,target); temporary.unlink()
        if file_hash(target)!=expected: raise ValueError('최종 파일 재읽기 불일치')
        return expected
    finally:
        if temporary.exists(): temporary.unlink()
