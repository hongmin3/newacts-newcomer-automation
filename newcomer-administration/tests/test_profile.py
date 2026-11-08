# Validates: REQ-ADMIN-005
import pathlib
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET
from template_profile import detect_profile

P='http://www.hancom.co.kr/hwpml/2011/paragraph'


class ProfileTests(unittest.TestCase):
    def test_actual_two_table_shape_is_detected_without_personal_defaults(self):
        root=ET.Element('{'+P+'}sec')
        for data in [[['번호','이름','교구','인도자'],['308','가상등록','청년','가상인도']],
                     [['1교구','청년부','계'],['208','100','308'],['9','가상인도, '],['10','']]]:
            table=ET.SubElement(root,'{'+P+'}tbl',colCnt=str(len(data[0])),rowCnt=str(len(data)))
            for values in data:
                row=ET.SubElement(table,'{'+P+'}tr')
                for value in values:
                    cell=ET.SubElement(row,'{'+P+'}tc')
                    p=ET.SubElement(ET.SubElement(cell,'{'+P+'}subList'),'{'+P+'}p')
                    ET.SubElement(ET.SubElement(p,'{'+P+'}run',charPrIDRef='0'),'{'+P+'}t').text=value
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'source.hwpx'
            with zipfile.ZipFile(path,'w') as z: z.writestr('Contents/section0.xml',ET.tostring(root))
            profile=detect_profile(path)
            self.assertFalse(profile['confirmed'])
            self.assertEqual(profile['totals'],{'table':1,'total':[1,2],'youth_total':[1,1]})
            self.assertEqual(profile['buckets']['rows'],{'9':[2,1],'10':[3,1]})
            self.assertEqual(list(profile['introducer_names'].values()),['가상인도'])
