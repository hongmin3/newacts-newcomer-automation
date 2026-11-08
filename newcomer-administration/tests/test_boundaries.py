# Validates: REQ-ADMIN-001~003, REQ-ADMIN-008
import pathlib
import tempfile
import unittest
from unittest.mock import patch

from dimode import validate_http_request, production_writer
from sheets import build_source_patch
from source import source_digest


class BoundaryTests(unittest.TestCase):
    def test_live_writer_unavailable_without_verified_profile(self):
        for mode in ['OFFLINE_SIMULATED','LIVE_READONLY','LIVE_APPROVED']:
            with self.assertRaises(ValueError): production_writer(mode,{})

    def test_dimode_unknown_get_and_post_blocked(self):
        base='https://hansungv6.dimode.co.kr'
        for method,url,fields in [('GET',base+'/WebYouth/Person/PersonModify.aspx',[]),
                                  ('GET',base+'/WebYouth/Person/PersonList.aspx?mTag=MB2&delete=1',[]),
                                  ('POST',base+'/WebYouth/Person/PersonList.aspx?mTag=MB2',[('__EVENTTARGET','Save')]),
                                  ('GET','https://other.invalid/Login/Login.aspx',[])]:
            with self.subTest(url=url), self.assertRaises(ValueError): validate_http_request(method,url,fields)

    def test_exact_search_and_login_actions_only(self):
        base='https://hansungv6.dimode.co.kr'
        self.assertTrue(validate_http_request('GET',base+'/Login/Login.aspx',[]))
        self.assertTrue(validate_http_request('POST',base+'/WebYouth/Person/PersonList.aspx?mTag=MB2',
                        [('ctl00$cph1$PersonListYouth1$tabConSch$tabPnSch0$imgSearch0.x','5')]))

    def test_reordered_rows_patch_by_metadata_and_only_allowed_fields(self):
        row={'record_id':'fixed','name':'원래A','existing_mark':'','row_number':9}
        record={'record_id':'fixed','source_version':source_digest(row),
                'allowed_field_changes':{'existing_mark':{'before':'','after':'○'}}}
        plan=build_source_patch(record,[row],{'name':'F','existing_mark':'P'})
        self.assertEqual(plan,[{'row':9,'column':'P','before':'','after':'○'}])
        with self.assertRaises(ValueError): build_source_patch(record,[row|{'existing_mark':'수동변경'}],{'existing_mark':'P'})

    def test_unapproved_or_missing_id_patch_refused(self):
        for record in [{'record_id':'missing','allowed_field_changes':{}},
                       {'record_id':'fixed','source_version':'old','allowed_field_changes':{'army':{'before':'a','after':'b'}}}]:
            with self.assertRaises(ValueError): build_source_patch(record,[{'record_id':'fixed'}],{'army':'C'})
