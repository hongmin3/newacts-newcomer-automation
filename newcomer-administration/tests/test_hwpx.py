# Validates: REQ-ADMIN-005, REQ-ADMIN-006
import copy
import pathlib
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET

from hwp_adapter import inspect_hwpx, write_bulletin_draft, read_bulletin_draft

NS='http://www.hancom.co.kr/hwpml/2011/paragraph'


def fixture(path):
    root=ET.Element('{'+NS+'}sec')
    for rows in [[['번호','성명','교구','인도자'],['308','가상기존','청년','가상인도자']], [['총계','308'],['청년','100'],['발행일','2026-11-15']],
                 [['실적','명단'],['9','가상인도자'],['10',''],['11','']]]:
        table=ET.SubElement(root,'{'+NS+'}tbl',rowCnt=str(len(rows)),colCnt=str(len(rows[0])))
        for row in rows:
            tr=ET.SubElement(table,'{'+NS+'}tr')
            for text in row:
                tc=ET.SubElement(tr,'{'+NS+'}tc')
                sub=ET.SubElement(tc,'{'+NS+'}subList')
                p=ET.SubElement(sub,'{'+NS+'}p')
                run=ET.SubElement(p,'{'+NS+'}run',charPrIDRef='0')
                ET.SubElement(run,'{'+NS+'}t').text=text
    with zipfile.ZipFile(path,'w') as z:
        z.writestr('Contents/section0.xml',ET.tostring(root))
        z.writestr('Contents/header.xml','<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"><hh:refList><hh:charProperties itemCnt="1"><hh:charPr id="0" textColor="#000000"/></hh:charProperties></hh:refList></hh:head>')
        z.writestr('other.bin',b'preserve-exactly')


class HwpxTests(unittest.TestCase):
    def test_actual_layout_can_use_filename_date_and_existing_blank_row(self):
        import hwp_adapter as h
        with zipfile.ZipFile(self.source) as z: data={n:z.read(n) for n in z.namelist()}
        tree=h.parse_xml(data['Contents/section0.xml']); table=h.tables(tree)[0]
        blank=copy.deepcopy(h.rows(table)[-1])
        for cell in h.cells(blank): h.put_text(cell,'')
        table.append(blank); table.set('rowCnt','3')
        data['Contents/section0.xml']=ET.tostring(tree)
        with zipfile.ZipFile(self.source,'w') as z:
            for name,value in data.items(): z.writestr(name,value)
        self.profile['structure']=inspect_hwpx(self.source)['structure']
        self.profile['publication_mode']='filename'
        self.profile['totals'].pop('publication')
        self.target=self.target.with_name('새가족현황-2026-11-15.hwpx')
        write_bulletin_draft(self.source,self.target,self.profile,self.plan)
        self.assertEqual(len(inspect_hwpx(self.target)['tables'][0]['rows']),3)
        self.assertEqual(read_bulletin_draft(self.target,self.profile,'2026-11-15',{'r1':309})['entries'][0]['name'],'가상등록A')

    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.source=pathlib.Path(self.tmp.name)/'base.hwpx'; fixture(self.source)
        self.target=pathlib.Path(self.tmp.name)/'draft.hwpx'
        self.profile={'version':'v1','section':'Contents/section0.xml',
                      'structure':inspect_hwpx(self.source)['structure'],
                      'welcome':{'table':0,'header_rows':1,'columns':{'number':0,'name':1,'parish':2,'introducer':3}},
                      'totals':{'table':1,'total':[0,1],'youth_total':[1,1],'publication':[2,1]},
                      'buckets':{'table':2,'rows':{'9':[1,1],'10':[2,1],'11':[3,1]},'separator':', '},
                      'introducer_names':{'i1':'가상인도자'},'confirmed':True}
        self.plan={'bulletin_date':'2026-11-15','baseline_hash':'unused','profile_version':'v1',
                   'entries':[{'record_id':'r1','number':309,'name':'가상등록A','parish':'청년','introducer':'가상인도자'}],
                   'introducers':{'i1':{'name':'가상인도자','count':11,'highlight':True}},
                   'last_number':309,'total':309,'youth_total':101}

    def test_other_archive_members_unchanged_and_saved_file_reopened(self):
        before=self.source.read_bytes()
        write_bulletin_draft(self.source,self.target,self.profile,self.plan)
        self.assertEqual(self.source.read_bytes(),before)
        with zipfile.ZipFile(self.target) as z: self.assertEqual(z.read('other.bin'),b'preserve-exactly')
        actual=read_bulletin_draft(self.target,self.profile,self.plan['bulletin_date'],{'r1':309})
        self.assertEqual(actual['entries'],self.plan['entries'])
        self.assertEqual((actual['total'],actual['youth_total']), (309,101))
        self.assertEqual(actual['introducers']['i1']['count'],11)

    def test_profile_mismatch_and_original_target_rejected(self):
        for profile,target in [(self.profile|{'structure':'wrong'},self.target),(self.profile,self.source)]:
            with self.assertRaises(ValueError): write_bulletin_draft(self.source,target,profile,self.plan)
        self.assertFalse(self.target.exists())

    def test_unknown_names_and_missing_bucket_block(self):
        for changes in [{'introducer_names':{}},{'buckets':self.profile['buckets']|{'rows':{'9':[1,1]}}}]:
            with self.assertRaises(ValueError): write_bulletin_draft(self.source,self.target,self.profile|changes,self.plan)

    def test_existing_target_not_overwritten(self):
        self.target.write_bytes(b'other editor')
        with self.assertRaises(ValueError): write_bulletin_draft(self.source,self.target,self.profile,self.plan)
        self.assertEqual(self.target.read_bytes(),b'other editor')
