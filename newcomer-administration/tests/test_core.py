# Validates: REQ-ADMIN-001~004, REQ-ADMIN-006~008
import copy
import pathlib
import tempfile
import unittest

from source import read_applicants, parse_birth, source_digest
from identity import inspect_identity
from bulletin import build_bulletin_plan, verify_bulletin
from store import OperationStore
from service import approve, verify_approval, apply_step
from files import publish_bulletin, file_hash
from network_guard import classify_request
from windows_runtime import acquire_writer_lock, protect_secret, unprotect_secret, user_data_root


def person(**changes):
    row = dict(record_id='r1', date='2026-11-08', name='가상등록A', phone='01012345678',
               birth='1990-01-02', kind='registration', introducer_id='i1', introducer='가상인도자',
               identity='EXISTING', external_id='d1', issues=[])
    return row | changes


def baseline():
    return dict(file_hash='abc', last_number=308, total=308, youth_total=100,
                introducers={'i1': {'name': '가상인도자', 'count': 9}}, profile_version='v1')


class SourceTests(unittest.TestCase):
    def test_suffix_phone_and_stable_sort(self):
        rows = [person(record_id='b'), person(record_id='a', name='가상등록J', phone='010-1234-5678'),
                person(record_id='old', date='2026-11-01'), person(record_id='v', kind='visitor')]
        got = read_applicants(rows, '2026-11-01', '2026-11-08', '2026-11-15')
        self.assertEqual([x['record_id'] for x in got], ['old', 'b', 'a'])
        self.assertEqual(got[-1]['name'], '가상등록J')
        self.assertEqual(got[-1]['phone'], '01012345678')

    def test_cross_year_explicit_dates(self):
        got = read_applicants([person(date='2026-12-31'), person(date='2027-01-01', record_id='r2')],
                              '2026-12-28', '2027-01-03', '2027-01-10')
        self.assertEqual(len(got), 2)

    def test_invalid_and_partial_date_rejected(self):
        for value in ['11/08', '2026-02-30']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                read_applicants([person(date=value)], '2026-11-01', '2026-11-08', '2026-11-15')

    def test_birth_year_never_invents_date(self):
        self.assertEqual(parse_birth('1990년생', 2026), {'birth': '', 'age': 37, 'issues': []})
        self.assertEqual(parse_birth('30세', 2026)['age'], 30)
        self.assertTrue(parse_birth('90', 2026)['issues'])

    def test_row_number_does_not_change_digest(self):
        self.assertEqual(source_digest(person(row_number=2)), source_digest(person(row_number=99)))

    def test_missing_id_review_and_duplicates_not_merged(self):
        got = read_applicants([person(record_id=''), person(record_id='')], '2026-11-01', '2026-11-08', '2026-11-15')
        self.assertEqual(len(got), 2)
        self.assertTrue(all(x['issues'] for x in got))


class IdentityTests(unittest.TestCase):
    def inspect(self, cards, complete=True, **kwargs):
        return inspect_identity(person(**kwargs), lambda **query: {'cards': cards, 'truncated': not complete})

    def test_shared_phone_is_review(self):
        got = self.inspect([{'id':'1', 'name':'다른가상', 'phone':'01012345678', 'birth':'1990-01-02'}])
        self.assertEqual(got['state'], 'REVIEW')

    def test_existing_requires_matching_name_and_birth_or_phone(self):
        got = self.inspect([{'id':'1', 'name':'가상등록A', 'phone':'01012345678', 'birth':'1990-01-02'}])
        self.assertEqual((got['state'], got['external_id']), ('EXISTING', '1'))

    def test_conflicting_birth_and_multiple_matches_are_review(self):
        for cards in [[{'id':'1','name':'가상등록A','phone':'01012345678','birth':'1980-01-02'}],
                      [{'id':str(i),'name':'가상등록A','phone':'01012345678','birth':'1990-01-02'} for i in [1,2]]]:
            self.assertEqual(self.inspect(cards)['state'], 'REVIEW')

    def test_incomplete_search_cannot_prove_new(self):
        self.assertEqual(self.inspect([], complete=False)['state'], 'REVIEW')
        self.assertEqual(self.inspect([])['state'], 'NEW_CANDIDATE')

    def test_suffix_collision_is_review(self):
        self.assertEqual(self.inspect([{'id':'1','name':'가상등록B','phone':'','birth':''}])['state'], 'REVIEW')


class ApprovalTests(unittest.TestCase):
    def batch(self):
        return dict(batch_id='b1', start='2026-11-01', end='2026-11-08', bulletin_date='2026-11-15',
                    template_hash='abc', policy={'existing':'include'}, records=[person()])

    def test_approval_detects_every_material_change(self):
        batch = approve(self.batch(), '담당자')
        self.assertTrue(verify_approval(batch))
        for key, value in [('records', []), ('bulletin_date','2026-11-22'), ('template_hash','def')]:
            changed = copy.deepcopy(batch); changed[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): verify_approval(changed)

    def test_review_or_missing_id_cannot_be_approved(self):
        for p in [person(issues=['확인 필요']), person(record_id=''), person(identity='REVIEW')]:
            batch = self.batch(); batch['records'] = [p]
            with self.assertRaises(ValueError): approve(batch, '담당자')


class BulletinTests(unittest.TestCase):
    def test_existing_people_and_number_independent_of_row(self):
        got = build_bulletin_plan([person(), person(record_id='r2', row_number=999)], baseline(), '2026-11-15')
        self.assertEqual([x['number'] for x in got['entries']], [309,310])
        self.assertEqual(got['introducers']['i1']['count'], 11)
        self.assertEqual((got['total'], got['youth_total']), (310,102))

    def test_new_introducer_two_members_once(self):
        got = build_bulletin_plan([person(introducer_id='new'), person(record_id='r2', introducer_id='new')], baseline(), '2026-11-15')
        self.assertEqual(got['introducers']['new']['count'], 2)

    def test_clergy_skips_credit_but_not_total(self):
        got = build_bulletin_plan([person(clergy=True)], baseline(), '2026-11-15')
        self.assertEqual(got['total'], 309)
        self.assertEqual(got['introducers']['i1']['count'], 9)

    def test_visitor_excluded_and_bad_baseline_blocks(self):
        self.assertEqual(build_bulletin_plan([person(kind='visitor')], baseline(), '2026-11-15')['entries'], [])
        with self.assertRaises(ValueError): build_bulletin_plan([person()], baseline() | {'total':300}, '2026-11-15')

    def test_unresolved_introducer_and_duplicate_id_block(self):
        for records in [[person(introducer_id='')], [person(), person()]]:
            with self.assertRaises(ValueError): build_bulletin_plan(records, baseline(), '2026-11-15')

    def test_verifier_rejects_missing_name_wrong_total_or_color(self):
        plan = build_bulletin_plan([person()], baseline(), '2026-11-15')
        self.assertTrue(verify_bulletin(plan, copy.deepcopy(plan)))
        for key, value in [('entries', []), ('total',308), ('introducers',baseline()['introducers'])]:
            with self.assertRaises(ValueError): verify_bulletin(plan, copy.deepcopy(plan) | {key:value})


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = pathlib.Path(self.tmp.name) / 'history.db'
        self.db = OperationStore(self.path)

    def test_response_loss_never_retries_writer(self):
        calls=[]
        def lost(): calls.append(1); raise TimeoutError()
        with self.assertRaises(TimeoutError): apply_step(self.db, 'b','r','dimode', 'before', lost, lambda: True)
        with self.assertRaises(ValueError): apply_step(self.db, 'b','r','dimode', 'before', lost, lambda: True)
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.db.step('b','r','dimode')['state'], 'UNKNOWN')

    def test_verified_step_is_not_repeated(self):
        calls=[]
        def write(): calls.append(1); return 'external-id'
        for _ in range(2): apply_step(self.db,'b','r','dimode','before',write,lambda:'verified')
        self.assertEqual(calls, [1])

    def test_crash_recovered_and_sqlite_handle_closed(self):
        self.db.begin_step('b','r','dimode','before')
        self.db = OperationStore(self.path)
        self.assertEqual(self.db.step('b','r','dimode')['state'], 'UNKNOWN')
        moved=self.path.with_suffix('.moved'); self.path.rename(moved); moved.rename(self.path)

    def test_person_cannot_be_published_in_another_batch(self):
        self.db.record_publication('r','2026-11-15','b')
        with self.assertRaises(ValueError): self.db.record_publication('r','2026-11-22','other')


class FileTests(unittest.TestCase):
    def test_publish_preserves_source_and_refuses_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=pathlib.Path(tmp)/'초안.hwpx'; source.write_bytes(b'synthetic')
            target=pathlib.Path(tmp)/'다음 주.hwpx'
            publish_bulletin(source,target,None)
            self.assertEqual(source.read_bytes(), target.read_bytes())
            target.write_bytes(b'other editor')
            with self.assertRaises(ValueError): publish_bulletin(source,target,file_hash(source))
            self.assertEqual(target.read_bytes(), b'other editor')

    def test_excel_and_same_path_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=pathlib.Path(tmp)/'draft.hwp'; source.write_bytes(b'a')
            for target in [source, pathlib.Path(tmp)/'other.xlsx']:
                with self.assertRaises(ValueError): publish_bulletin(source,target,None)


class RuntimeTests(unittest.TestCase):
    def test_user_folder_acl_can_be_applied(self):
        self.assertTrue(user_data_root().is_dir())

    def test_lock_competition_and_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'lock'
            with acquire_writer_lock(path):
                with self.assertRaises(OSError):
                    with acquire_writer_lock(path): pass
            with acquire_writer_lock(path): pass

    def test_dpapi_roundtrip_and_corruption(self):
        data=b'synthetic-only'
        encrypted=protect_secret(data)
        self.assertNotIn(data,encrypted)
        self.assertEqual(unprotect_secret(encrypted),data)
        with self.assertRaises(ValueError): unprotect_secret(b'bad')


class GuardTests(unittest.TestCase):
    def test_only_exact_read_rule_is_allowed(self):
        rules=[dict(origin='https://example.invalid',path='/list',method='POST',event_target='search')]
        for req, expected in [
            (dict(origin='https://example.invalid',path='/list',method='POST',event_target='search'),'ALLOW_READ'),
            (dict(origin='https://example.invalid',path='/list',method='POST',event_target='save'),'BLOCK'),
            (dict(origin='https://example.invalid',path='/list?delete=1',method='GET'),'BLOCK'),
            (dict(origin='https://other.invalid',path='/list',method='POST',event_target='search'),'BLOCK')]:
            self.assertEqual(classify_request(req,'LIVE_READONLY',rules),expected)
            self.assertEqual(classify_request(req,'OFFLINE_SIMULATED',rules),'BLOCK')
