# Validates: REQ-ADMIN-003~008
import copy
import pathlib
import tempfile
import unittest
import threading
from unittest.mock import patch
from workflow import preview, prepare_batch, make_draft, publish
from store import OperationStore
from test_core import person, baseline
from test_hwpx import fixture
from hwp_adapter import inspect_hwpx
from files import file_hash


class WorkflowTests(unittest.TestCase):
    def test_baseline_counts_must_match_document(self):
        review=preview([person()],'2026-11-01','2026-11-08','2026-11-15')
        review['records'][0].update(identity='EXISTING',external_id='d1')
        base=baseline()|{'file_hash':file_hash(self.template)}
        for bad in [base|{'youth_total':99},base|{'introducers':{'i1':{'name':'가상인도자','count':10}}}]:
            with self.assertRaises(ValueError): prepare_batch(review,self.template,'담당자',bad,self.profile)

    def test_second_writer_cannot_enter_during_external_copy(self):
        from windows_runtime import acquire_writer_lock
        batch=self.batch(); base=baseline()|{'file_hash':file_hash(self.template)}
        draft=self.root/'draft.hwpx'; plan=make_draft(batch,base,self.template,draft,self.profile,self.db)
        with acquire_writer_lock(self.db.path.with_suffix('.writer.lock')):
            with self.assertRaises(OSError):
                publish(batch,plan,draft,self.root/'published.hwpx',self.profile,self.db,True)
        self.assertFalse((self.root/'published.hwpx').exists())

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name)
        self.template=self.root/'source.hwpx'; fixture(self.template)
        self.profile={'version':'v1','confirmed':True,'section':'Contents/section0.xml',
             'structure':inspect_hwpx(self.template)['structure'],
             'welcome':{'table':0,'header_rows':1,'columns':{'number':0,'name':1,'parish':2,'introducer':3}},
             'totals':{'table':1,'total':[0,1],'youth_total':[1,1],'publication':[2,1]},
             'buckets':{'table':2,'rows':{'9':[1,1],'10':[2,1],'11':[3,1]},'separator':', '},
             'introducer_names':{'i1':'가상인도자'}}
        self.db=OperationStore(self.root/'history.db')

    def batch(self):
        review=preview([person()], '2026-11-01','2026-11-08','2026-11-15')
        # Preview cannot infer a successful external lookup.
        review['records'][0]['identity']='EXISTING'
        review['records'][0]['external_id']='d1'
        return prepare_batch(review,self.template,'담당자',baseline()|{'file_hash':file_hash(self.template)},self.profile)

    def test_preview_has_no_external_side_effects_and_no_implicit_existing(self):
        original=person()
        result=preview([original], '2026-11-01','2026-11-08','2026-11-15')
        self.assertEqual(result['records'][0]['identity'],'NOT_CHECKED')
        self.assertEqual(original['identity'],'EXISTING')
        self.assertEqual(list(self.root.glob('*.hwpx')),[self.template])

    def test_local_draft_then_page_review_then_publish(self):
        batch=self.batch(); base=baseline()|{'file_hash':file_hash(self.template)}
        draft=self.root/'draft.hwpx'
        plan=make_draft(batch,base,self.template,draft,self.profile,self.db)
        target=self.root/'published.hwpx'
        with self.assertRaises(ValueError): publish(batch,plan,draft,target,self.profile,self.db,False)
        self.assertFalse(target.exists())
        publish(batch,plan,draft,target,self.profile,self.db,True)
        self.assertEqual(self.db.published(),{'r1'})
        self.assertEqual(target.read_bytes(),draft.read_bytes())
        # Repeating the same verified operation makes no second file and no credit.
        publish(batch,plan,draft,target,self.profile,self.db,True)
        other=self.root/'other.hwpx'
        with self.assertRaises(ValueError): publish(batch|{'batch_id':'other'},plan,draft,other,self.profile,self.db,True)

    def test_changed_template_or_changed_draft_prevents_publish(self):
        batch=self.batch(); base=baseline()|{'file_hash':file_hash(self.template)}
        draft=self.root/'draft.hwpx'; plan=make_draft(batch,base,self.template,draft,self.profile,self.db)
        draft.write_bytes(b'changed')
        with self.assertRaises(ValueError): publish(batch,plan,draft,self.root/'out.hwpx',self.profile,self.db,True)

    def test_changed_approval_or_unverified_profile_blocks_draft(self):
        batch=self.batch(); base=baseline()|{'file_hash':file_hash(self.template)}
        for current,profile in [(batch|{'records':[]},self.profile),(batch,self.profile|{'confirmed':False})]:
            with self.assertRaises(ValueError): make_draft(current,base,self.template,self.root/'draft.hwpx',profile,self.db)
