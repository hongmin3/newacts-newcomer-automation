"""Windows user-only secrets and kernel-owned single-writer locks."""
import contextlib
import ctypes
import os
import pathlib
import subprocess


def user_data_root():
    if os.name!='nt': raise OSError('Windows 전용 실행입니다.')
    root=pathlib.Path(os.environ['LOCALAPPDATA'])/'NewactsNewcomerAdministration'
    root.mkdir(parents=True,exist_ok=True)
    # Use SID instead of a localized account/group name. Keep SYSTEM recovery access.
    sid=subprocess.check_output(['whoami','/user','/fo','csv','/nh'],text=True).strip().split(',')[-1].strip('"')
    result=subprocess.run(['icacls',str(root),'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F',
                           '*S-1-5-18:(OI)(CI)F'],capture_output=True)
    if result.returncode: raise OSError('사용자 데이터 폴더 접근 권한 설정 실패')
    return root


class Blob(ctypes.Structure):
    _fields_=[('size',ctypes.c_ulong),('data',ctypes.POINTER(ctypes.c_ubyte))]


def _crypt(data,decrypt=False):
    if os.name!='nt': raise OSError('Windows DPAPI가 필요합니다.')
    buffer=ctypes.create_string_buffer(data)
    incoming=Blob(len(data),ctypes.cast(buffer,ctypes.POINTER(ctypes.c_ubyte))); outgoing=Blob()
    fn=ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    description=ctypes.c_wchar_p()
    second=ctypes.byref(description) if decrypt else 'NEWACTS'
    if not fn(ctypes.byref(incoming),second,None,None,None,1,ctypes.byref(outgoing)):
        raise ValueError('인증 정보 해독 실패. 다시 인증하세요.')
    try: return ctypes.string_at(outgoing.data,outgoing.size)
    finally:
        ctypes.windll.kernel32.LocalFree.argtypes=[ctypes.c_void_p]
        ctypes.windll.kernel32.LocalFree.restype=ctypes.c_void_p
        ctypes.windll.kernel32.LocalFree(outgoing.data)
        if description: ctypes.windll.kernel32.LocalFree(ctypes.cast(description,ctypes.c_void_p))


def protect_secret(data): return _crypt(data)
def unprotect_secret(data): return _crypt(data,True)


@contextlib.contextmanager
def acquire_writer_lock(path):
    import msvcrt
    with open(path,'a+b') as stream:
        if stream.seek(0,os.SEEK_END)==0: stream.write(b'0'); stream.flush()
        stream.seek(0)
        msvcrt.locking(stream.fileno(),msvcrt.LK_NBLCK,1)
        try: yield
        finally:
            stream.seek(0); msvcrt.locking(stream.fileno(),msvcrt.LK_UNLCK,1)
