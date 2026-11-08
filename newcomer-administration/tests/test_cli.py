# Validates: REQ-ADMIN-001, REQ-ADMIN-007
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

MAIN=pathlib.Path(__file__).resolve().parents[1]/'main.py'


class CliTests(unittest.TestCase):
    def run_cli(self,*args):
        return subprocess.run([sys.executable,'-B',str(MAIN),*args],cwd=tempfile.gettempdir(),
                              capture_output=True,text=True,encoding='utf-8')

    def test_help_from_another_folder(self):
        result=self.run_cli('--help')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('doctor',result.stdout)

    def test_preview_writes_only_chosen_local_review_and_reports_pending(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=pathlib.Path(tmp)/'input.csv'; output=pathlib.Path(tmp)/'review.json'
            source.write_text('관리번호,날짜,새신자,핸드폰,생년월일\nr1,2026-11-08,가상등록A,01012345678,1990-01-02\n',encoding='utf-8-sig')
            result=self.run_cli('preview','--csv',str(source),'--start','2026-11-01','--end','2026-11-08',
                                '--publication','2026-11-15','--output',str(output))
            self.assertEqual(result.returncode,0,result.stderr)
            review=json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(review['records'][0]['identity'],'NOT_CHECKED')
            self.assertNotIn('가상등록',result.stdout)

    def test_cli_failure_does_not_print_personal_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=pathlib.Path(tmp)/'input.csv'
            source.write_text('관리번호,날짜,새신자,핸드폰\nr1,PRIVATE,PRIVATE,01012345678\n',encoding='utf-8')
            result=self.run_cli('preview','--csv',str(source),'--start','2026-11-01','--end','2026-11-08',
                                '--publication','2026-11-15','--output',str(pathlib.Path(tmp)/'review.json'))
            self.assertNotEqual(result.returncode,0)
            self.assertNotIn('PRIVATE',result.stderr)
