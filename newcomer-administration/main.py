"""Manual Windows entrypoint. No login, file creation or network on import."""
import argparse
import csv
import importlib.util
import json
import os
import pathlib
import sys


def doctor():
    import winreg
    hancom=False
    try:
        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT,r'HWPFrame.HwpObject\CLSID'): hancom=True
    except OSError: pass
    root=pathlib.Path(os.environ['LOCALAPPDATA'])/'NewactsNewcomerAdministration'
    return {'python':sys.version.split()[0],'windows':os.name=='nt','hancom_registered':hancom,
            'google_library':importlib.util.find_spec('googleapiclient') is not None,
            'google_authorized':(root/'google-token.dpapi').exists(),
            'dimode_configured':(root/'dimode.dpapi').exists(),
            'hancom_profile_confirmed':(root/'template-profile.json').exists(),
            'production_dimode_write_enabled':False}


def load_json(path):
    from sheets import outside_repo
    return json.loads(outside_repo(path).read_text(encoding='utf-8-sig'))


def save_json(path,value):
    from sheets import outside_repo
    path=outside_repo(path)
    with open(path,'x',encoding='utf-8') as stream:
        json.dump(value,stream,ensure_ascii=False,indent=2)


def main(argv=None):
    if hasattr(sys.stdout,'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr,'reconfigure'): sys.stderr.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser(description='새가족 교적·주보 업무 도우미')
    sub=parser.add_subparsers(dest='command')
    sub.add_parser('doctor',help='연결 준비 상태 확인. 운영 자료를 변경하지 않습니다.')
    sub.add_parser('gui',help='담당자 화면 열기')
    p=sub.add_parser('preview',help='CSV를 읽고 외부 변경 없이 검토 자료 생성')
    p.add_argument('--csv',required=True); p.add_argument('--start',required=True); p.add_argument('--end',required=True)
    p.add_argument('--publication',required=True); p.add_argument('--output',required=True)
    p.add_argument('--lookup',action='store_true',help='저장한 Windows 인증으로 교적을 읽기만 합니다.')
    p=sub.add_parser('authorize-google',help='Google 읽기 권한 인증')
    p.add_argument('--client',required=True)
    sub.add_parser('configure-dimode',help='Windows 현재 사용자 전용 암호화 인증 설정')
    p=sub.add_parser('inspect-hwp',help='원본을 보존하고 별도 한글 사본 구조 확인'); p.add_argument('source')
    p=sub.add_parser('draft',help='확인된 검토 자료·양식으로 로컬 초안 작성')
    for flag in ['review','baseline','profile','template','output','reviewer']: p.add_argument('--'+flag,required=True)
    p=sub.add_parser('publish',help='페이지를 확인한 초안을 별도 파일로 최종 저장')
    p.add_argument('--job',required=True); p.add_argument('--target',required=True)
    p.add_argument('--page-reviewed',action='store_true')
    args=parser.parse_args(argv)
    try:
        if args.command=='doctor': print(json.dumps(doctor(),ensure_ascii=False,indent=2)); return 0
        if args.command in (None,'gui'):
            from window import run
            run(); return 0
        from windows_runtime import user_data_root,acquire_writer_lock
        from sheets import outside_repo
        from files import file_hash
        root=user_data_root()
        if args.command=='preview':
            from source import read_csv
            from workflow import preview
            reader=None
            if args.lookup:
                from dimode import open_reader
                reader=open_reader(root/'dimode.dpapi')
            source=outside_repo(args.csv)
            result=preview(read_csv(source),args.start,args.end,args.publication,reader)
            result.update(source_path=str(source),source_file_hash=file_hash(source))
            save_json(args.output,result)
            print(f"검토 대상 {len(result['records'])}명. 교적·시트·주보 변경 0회. 검토 자료를 저장했습니다.")
        elif args.command=='authorize-google':
            from sheets import authorize
            authorize(args.client,root/'google-token.dpapi')
            print('Google 읽기 권한 인증을 저장했습니다. 시트는 변경하지 않았습니다.')
        elif args.command=='configure-dimode':
            import getpass
            from dimode import save_credentials
            account=input('디모데 계정: ').strip(); password=getpass.getpass('디모데 암호: ')
            save_credentials(root/'dimode.dpapi',account,password)
            print('현재 Windows 사용자 전용으로 암호화했습니다. 아직 로그인하지 않았습니다.')
        elif args.command=='inspect-hwp':
            from inspect_hwp import main as inspect_main
            sys.argv=[sys.argv[0],args.source]; inspect_main()
        elif args.command=='draft':
            from workflow import prepare_batch,make_draft
            from store import OperationStore
            review,base,profile=map(load_json,[args.review,args.baseline,args.profile])
            template=outside_repo(args.template); target=outside_repo(args.output)
            if review.get('source_path') and file_hash(review['source_path'])!=review['source_file_hash']:
                raise ValueError('검토 뒤 입력 파일이 바뀌었습니다. 다시 조회하세요.')
            with acquire_writer_lock(root/'writer.lock'):
                batch=prepare_batch(review,template,args.reviewer,base,profile)
                plan=make_draft(batch,base,template,target,profile,OperationStore(root/'history.sqlite'))
                job={'batch':batch,'plan':plan,'draft':str(target),'profile':profile}
                save_json(target.with_suffix('.job.json'),job)
            print('로컬 초안 저장본을 대조했습니다. 한글에서 페이지를 확인한 후 최종 저장하세요.')
        elif args.command=='publish':
            from workflow import publish
            from store import OperationStore
            job=load_json(args.job); target=outside_repo(args.target)
            with acquire_writer_lock(root/'writer.lock'):
                publish(job['batch'],job['plan'],job['draft'],target,job['profile'],OperationStore(root/'history.sqlite'),args.page_reviewed)
            print('최종 파일 저장·재읽기와 게시 이력을 확인했습니다. 실물 카드는 담당자가 전달하세요.')
        return 0
    except (ValueError,FileNotFoundError,PermissionError) as error:
        # Only controlled, non-sensitive application validation messages are surfaced.
        if isinstance(error,ValueError) and not isinstance(error,json.JSONDecodeError): print(str(error),file=sys.stderr)
        else: print('필요한 파일이나 접근 권한을 확인하세요. 운영 변경을 다시 시도하지 않았습니다.',file=sys.stderr)
        return 1
    except Exception:
        print('작업을 완료하지 못했습니다. 연결과 파일 상태를 확인하세요. 자동 재시도하지 않습니다.',file=sys.stderr)
        return 1


if __name__=='__main__': sys.exit(main())
