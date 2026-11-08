"""Read an explicitly chosen HWP through an owned, hidden Hancom instance."""
import argparse
import json
import pathlib
import shutil
import uuid
import zipfile
import xml.etree.ElementTree as ET

from files import file_hash
from windows_runtime import user_data_root


def convert_copy(source, target):
    import pythoncom
    import win32com.client
    source=pathlib.Path(source).resolve(); target=pathlib.Path(target).resolve()
    if source==target or target.exists() or target.suffix.lower()!='.hwpx':
        raise ValueError('존재하지 않는 별도 HWPX 사본 경로가 필요합니다.')
    before=file_hash(source)
    pythoncom.CoInitialize()
    app=None
    try:
        app=win32com.client.DispatchEx('HWPFrame.HwpObject')
        app.XHwpWindows.Item(0).Visible=False
        if not app.Open(str(source),'HWP',''): raise ValueError('한글 사본 열기 실패')
        fields=app.GetFieldList(0,0)
        if not app.SaveAs(str(target),'HWPX',''): raise ValueError('HWPX 사본 저장 실패')
        if file_hash(source)!=before: raise ValueError('원본 파일이 바뀌었습니다.')
        return {'source_sha256':before,'fields':fields,'converted':str(target)}
    finally:
        if app is not None: app.Quit()
        pythoncom.CoUninitialize()


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('source'); args=parser.parse_args()
    root=user_data_root()/'inspection'; root.mkdir(exist_ok=True)
    source=pathlib.Path(args.source)
    private=root/(uuid.uuid4().hex+'.hwp'); shutil.copy2(source,private)
    report=convert_copy(private,private.with_suffix('.hwpx'))
    report['source_copy']=str(private)
    with zipfile.ZipFile(report['converted']) as z:
        summaries=[]
        for name in z.namelist():
            if not name.startswith('Contents/section') or not name.endswith('.xml'): continue
            tree=ET.fromstring(z.read(name))
            tables=list(tree.iter('{http://www.hancom.co.kr/hwpml/2011/paragraph}tbl'))
            for i,table in enumerate(tables):
                rows=list(table.findall('{*}tr'))
                # Only structure and column labels. Do not print registration lists.
                first=[''.join(c.itertext())[:80] for c in rows[0].findall('{*}tc')] if rows else []
                summaries.append({'section':name,'table':i,'rows':len(rows),'header':first})
        report['tables']=summaries
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__': main()
