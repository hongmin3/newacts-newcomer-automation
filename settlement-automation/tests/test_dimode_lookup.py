"""Validates: REQ-DIMODELOOKUP-001, REQ-DIMODELOOKUP-002, REQ-DIMODELOOKUP-003, REQ-DIMODELOOKUP-004"""
import io
import json
import subprocess
import unittest
from contextlib import redirect_stdout
from unittest import mock

import dimode_lookup as dl

P = dl.SEARCH_PREFIX

LOGIN_HTML = '''<form name="aspnetForm" method="post" action="./Login.aspx">
<input type="hidden" name="__VIEWSTATE" value="VS" />
<input type="hidden" name="__VIEWSTATEGENERATOR" value="GEN" />
<input type="text" name="ctl00$cph1$LoginMain1$txtLoginID" />
<input type="image" name="ctl00$cph1$LoginMain1$imgBtnLogin" />
<input type="password" name="ctl00$cph1$LoginMain1$txtLoginPWD" />
</form>'''


def list_page(name='', phone='', state1='청년', cards='', pages=1):
    pager = ''.join(
        f'<a href="javascript:__doPostBack(\'ctl00$cph1$PersonListYouth1$AspNetPager1\',\'{n}\')">{n}</a>'
        for n in range(2, pages + 1))
    return f'''<form method="post" action="./PersonList.aspx?mTag=MB2">
<input type="hidden" name="__VIEWSTATE" value="LIST" />
<input type="text" name="{P}txtNameSch0" value="{name}" />
<input type="text" name="{P}txtHandphoneSch0" value="{phone}" />
<select name="{P}ucStateSch0$ddlState"><option value=""></option><option value="교인" selected="selected">교인</option></select>
<select name="{P}ucStateSch0$ddlState1"><option value=""></option><option value="청년" {'selected="selected"' if state1 else ''}>청년</option></select>
<input type="checkbox" name="{P}ucState3Sch0$cblData$0" checked="checked" />
<input type="checkbox" name="{P}ucState3Sch0$cblData$1" />
<input type="image" name="{P}imgSearch0" />
</form>{cards}{pager}'''


def card(pid, name, phone='010-1111-2222', birth='1990-01-02 (양)', reg='2026-02-08',
         state='교인 &gt; 청년', org='조군(아너스) &gt; 보배 &gt; 리더()'):
    return f'''<table class="tablelineno"><tr><td class="tdtitle2">이름</td>
<td class="tddata"><span style="cursor:pointer" onclick="OpenPerosonModify('{pid}');">{name}</span>&nbsp;(37세,&nbsp;남)</td>
<td class="tdtitle2">생년월일</td><td class="tddata">{birth}</td></tr>
<tr><td class="tdtitle2">핸드폰</td><td class="tddata">{phone}</td></tr>
<tr><td class="tdtitle2">청년<div><span>부서보기▼</span></div></td>
<td class="tddata" colspan="5"><div style="color:Red; float:left;">{org}</div></td></tr>
<tr><td class="tdtitle2">교인구분</td><td class="tddata"><span>{state}</span>&nbsp;(<span>A</span>)</td>
<td class="tdtitle2">등록일</td><td class="tddata" colspan="3"><span>{reg}</span></td></tr></table>'''


class FakeHttp:
    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def __call__(self, method, url, fields=None):
        self.calls.append((method, url, dict(fields or [])))
        return self.routes(method, url, dict(fields or []), len(self.calls))


class KeychainTests(unittest.TestCase):
    def test_account_from_keychain_hex_blob(self):
        out = '"acct"<blob>=0xED858CEC8AA4ED8AB8EAB384ECA095  "x"\n"svce"<blob>="kr.newacts.settlement"\n'
        run = mock.Mock(return_value=subprocess.CompletedProcess([], 0, stdout=out, stderr=''))
        self.assertEqual(dl.resolve_account(None, env={}, run=run), '테스트계정')

    def test_account_priority_and_missing_item(self):
        run = mock.Mock(return_value=subprocess.CompletedProcess([], 44, stdout='', stderr='not found'))
        self.assertEqual(dl.resolve_account('직접', env={'NEWACTS_DIMODE_ACCOUNT': '환경'}, run=run), '직접')
        self.assertEqual(dl.resolve_account(None, env={'NEWACTS_DIMODE_ACCOUNT': '환경'}, run=run), '환경')
        with self.assertRaises(dl.DimodeError) as caught:
            dl.resolve_account(None, env={}, run=run)
        self.assertIn('security add-generic-password', str(caught.exception))

    def test_password_never_in_error_text(self):
        run = mock.Mock(return_value=subprocess.CompletedProcess([], 0, stdout='s3cret!\n', stderr=''))
        self.assertEqual(dl.read_password('계정', run=run), 's3cret!')
        self.assertIn('-w', run.call_args.args[0])
        bad = mock.Mock(return_value=subprocess.CompletedProcess([], 44, stdout='', stderr='s3cret!'))
        with self.assertRaises(dl.DimodeError) as caught:
            dl.read_password('계정', run=bad)
        self.assertNotIn('s3cret', str(caught.exception))


class LoginTests(unittest.TestCase):
    def test_login_posts_hidden_fields_and_credentials(self):
        def routes(method, url, fields, n):
            if method == 'GET':
                return dl.BASE_URL + dl.LOGIN_PATH, LOGIN_HTML
            return dl.BASE_URL + '/WebYouth/Default.aspx', 'ok'
        http = FakeHttp(routes)
        dl.DimodeClient(http).login('계정', '암호')
        sent = http.calls[1][2]
        self.assertEqual(sent['__VIEWSTATE'], 'VS')
        self.assertEqual(sent['ctl00$cph1$LoginMain1$txtLoginID'], '계정')
        self.assertEqual(sent['ctl00$cph1$LoginMain1$txtLoginPWD'], '암호')
        self.assertIn('ctl00$cph1$LoginMain1$imgBtnLogin.x', sent)

    def test_login_failure_stops_without_retry_or_password(self):
        http = FakeHttp(lambda m, u, f, n: (dl.BASE_URL + dl.LOGIN_PATH, LOGIN_HTML))
        with self.assertRaises(dl.DimodeError) as caught:
            dl.DimodeClient(http).login('계정', '비밀암호')
        self.assertEqual(len(http.calls), 2)
        self.assertNotIn('비밀암호', str(caught.exception))


class SearchTests(unittest.TestCase):
    def test_parse_card_fields(self):
        c = dl.parse_cards(card('7', '홍길동G', birth='1987-05-06 (양)'))[0]
        self.assertEqual((c['id'], c['display_name'], c['name']), ('7', '홍길동G', '홍길동'))
        self.assertEqual((c['phone'], c['birth'], c['registered']), ('010-1111-2222', '19870506', '2026-02-08'))
        self.assertEqual(c['state'], '교인 > 청년')
        self.assertEqual(c['orgs'], [{'army': '조', 'team': '보배', 'raw': '조군(아너스) > 보배'}])

    def test_card_without_edit_link_uses_name_cell(self):
        plain = card('9', '홍길동').replace("<span style=\"cursor:pointer\" onclick=\"OpenPerosonModify('9');\">홍길동</span>", '홍길동')
        c = dl.parse_cards(plain)[0]
        self.assertEqual((c['id'], c['display_name'], c['name']), ('', '홍길동', '홍길동'))

    def test_search_fresh_form_echo_and_all_states(self):
        def routes(method, url, fields, n):
            if method == 'GET':
                return url, list_page()
            return url, list_page(name=fields[P + 'txtNameSch0'], state1='', cards=card('1', '홍길동'))
        http = FakeHttp(routes)
        result = dl.DimodeClient(http).search(name='홍길동', all_states=True)
        sent = http.calls[1][2]
        self.assertEqual(sent[P + 'ucStateSch0$ddlState1'], '')
        self.assertEqual(sent[P + 'ucStateSch0$ddlState'], '')
        self.assertIn(P + 'ucState3Sch0$cblData$0', sent)
        self.assertNotIn(P + 'ucState3Sch0$cblData$1', sent)
        self.assertEqual([c['id'] for c in result['cards']], ['1'])
        self.assertTrue(all(m in ('GET', 'POST') for m, _, _ in http.calls))
        self.assertTrue(all('PersonList.aspx' in u for _, u, _ in http.calls))

    def test_search_echo_mismatch_is_error(self):
        http = FakeHttp(lambda m, u, f, n: (u, list_page(name='다른사람')))
        with self.assertRaises(dl.DimodeError):
            dl.DimodeClient(http).search(name='홍길동')

    def test_search_reads_every_page(self):
        def routes(method, url, fields, n):
            if method == 'GET':
                return url, list_page()
            page = fields.get('__EVENTARGUMENT') or '1'
            return url, list_page(name='김', cards=card(page, '김' + page), pages=3)
        http = FakeHttp(routes)
        result = dl.DimodeClient(http).search(name='김')
        self.assertEqual([c['id'] for c in result['cards']], ['1', '2', '3'])
        self.assertFalse(result['truncated'])

    def test_repeated_page_and_too_many_pages(self):
        repeat = FakeHttp(lambda m, u, f, n: (u, list_page(name='김', cards=card('1', '김'), pages=2) if m == 'POST' else list_page()))
        with self.assertRaises(dl.DimodeError):
            dl.DimodeClient(repeat).search(name='김')
        many = FakeHttp(lambda m, u, f, n: (u, list_page(name='김', cards=card('1', '김'), pages=40) if m == 'POST' else list_page()))
        self.assertTrue(dl.DimodeClient(many).search(name='김')['truncated'])

    def test_expired_session_is_error(self):
        http = FakeHttp(lambda m, u, f, n: (dl.BASE_URL + dl.LOGIN_PATH, LOGIN_HTML))
        with self.assertRaises(dl.DimodeError):
            dl.DimodeClient(http).search(name='김')


def cardinfo(pid, name, phone='', birth='', army='조', team='보배', state='교인 > 청년'):
    return {'id': pid, 'display_name': name, 'name': dl.normalize_name(name), 'phone': phone,
            'birth': birth, 'registered': '2026-01-01', 'state': state,
            'orgs': [{'army': army, 'team': team, 'raw': ''}] if army else []}


def plain_card(pid, name, **kwargs):
    return card(pid, name, **kwargs).replace(
        f'<span style="cursor:pointer" onclick="OpenPerosonModify(\'{pid}\');">{name}</span>', name)


class MissingIdTests(unittest.TestCase):
    # Validates: REQ-DIMODELOOKUP-002, REQ-DIMODELOOKUP-003
    def client(self, pages):
        def routes(method, url, fields, n):
            if method == 'GET':
                return url, list_page()
            number = int(fields.get('__EVENTARGUMENT') or '1')
            return url, list_page(name='홍길동', cards=pages[number - 1], pages=len(pages))
        return dl.DimodeClient(FakeHttp(routes))

    def test_search_preserves_two_missing_ids_on_one_page(self):
        result = self.client([plain_card('1', '홍길동') + plain_card('2', '홍길동')]).search(name='홍길동')
        self.assertEqual(len(result['cards']), 2)
        self.assertEqual([c['id'] for c in result['cards']], ['', ''])

    def test_search_preserves_missing_ids_across_pages(self):
        client = self.client([plain_card('1', '홍길동', birth='1990-01-02'),
                              plain_card('2', '홍길동', birth='1991-01-02')])
        result = client.search(name='홍길동')
        self.assertEqual([c['birth'] for c in result['cards']], ['19900102', '19910102'])

    def test_missing_id_namesakes_remain_check(self):
        client = self.client([plain_card('1', '홍길동') + plain_card('2', '홍길동')])
        result = dl.match_person({'name': '홍길동', 'army': '조', 'team': '보배'}, client.search)
        self.assertEqual(result['status'], 'check')
        self.assertEqual(len(result['candidates']), 2)

    def test_repeated_missing_id_page_still_stops(self):
        markup = plain_card('1', '홍길동')
        with self.assertRaises(dl.DimodeError):
            self.client([markup, markup]).search(name='홍길동')


class FakeSearcher:
    def __init__(self, by_phone=None, by_name=None, by_name_all=None):
        self.by_phone, self.by_name, self.by_name_all = by_phone or {}, by_name or {}, by_name_all or {}
        self.calls = []

    def __call__(self, name='', phone='', all_states=False):
        self.calls.append((name, phone, all_states))
        if phone:
            cards = self.by_phone.get(phone, [])
        else:
            cards = (self.by_name_all if all_states else self.by_name).get(name, [])
        return {'cards': cards, 'pages': 1, 'truncated': False}


ROW = {'name': '홍길동A', 'phone': '01011112222', 'birth': '19900102', 'army': '조', 'team': '보배'}


class MatchTests(unittest.TestCase):
    def test_ambiguous_phone_candidates_are_not_replaced_by_partial_name_search(self):
        candidates = [cardinfo('1', '홍길동', '010-1111-2222'),
                      cardinfo('2', '홍길동', '010-1111-2222')]
        def search(name='', phone='', all_states=False):
            return {'cards': candidates if phone else candidates[:1], 'pages': 1, 'truncated': False}
        result = dl.match_person({**ROW, 'birth': ''}, search)
        self.assertEqual(result['status'], 'check')
        self.assertEqual(len(result['candidates']), 2)

    def test_all_states_repeats_phone_birth_rule_for_changed_name(self):
        def search(name='', phone='', all_states=False):
            cards = [cardinfo('9', '홍길순', '010-1111-2222', '19900102')] if phone and all_states else []
            return {'cards': cards, 'pages': 1, 'truncated': False}
        result = dl.match_person(ROW, search)
        self.assertEqual(result['status'], 'matched')
        self.assertEqual((result['card']['id'], result['all_states'], result['name_differs']), ('9', True, True))

    def test_phone_name_and_birth(self):
        s = FakeSearcher(by_phone={'010-1111-2222': [cardinfo('1', '홍길동B', '010-1111-2222', '19900102', army='명', team='하이')]})
        r = dl.match_person(ROW, s)
        self.assertEqual((r['status'], r['card']['id']), ('matched', '1'))

    def test_phone_name_with_birth_typo_is_same_person(self):
        s = FakeSearcher(by_phone={'010-1111-2222': [cardinfo('1', '홍길동', '010-1111-2222', '19900103', army='명', team='하이')]})
        self.assertEqual(dl.match_person(ROW, s)['status'], 'matched')

    def test_phone_birth_name_differs_uses_dimode_name(self):
        s = FakeSearcher(by_phone={'010-1111-2222': [cardinfo('1', '홍길순', '010-1111-2222', '19900102')]})
        r = dl.match_person(ROW, s)
        self.assertEqual((r['status'], r['card']['display_name'], r['name_differs']), ('matched', '홍길순', True))

    def test_shared_family_phone_is_not_same_person(self):
        s = FakeSearcher(by_phone={'010-1111-2222': [cardinfo('1', '홍아빠', '010-1111-2222', '19600101')]})
        self.assertEqual(dl.match_person(ROW, s)['status'], 'check')

    def test_name_fallbacks_and_conflicts(self):
        same_birth = FakeSearcher(by_name={'홍길동': [cardinfo('2', '홍길동', '', '19900102', army='명'), cardinfo('3', '홍길동C', '', '19800101')]})
        self.assertEqual(dl.match_person(ROW, same_birth)['card']['id'], '2')
        same_org = FakeSearcher(by_name={'홍길동': [cardinfo('4', '홍길동', '', ''), cardinfo('5', '홍길동', '', '', army='명')]})
        self.assertEqual(dl.match_person(ROW, same_org)['card']['id'], '4')
        conflict = FakeSearcher(by_name={'홍길동': [cardinfo('6', '홍길동', '010-9999-9999', '')]})
        self.assertEqual(dl.match_person(ROW, conflict)['status'], 'check')

    def test_multiple_candidates_stay_check(self):
        s = FakeSearcher(by_name={'홍길동': [cardinfo('2', '홍길동', '', '19900102'), cardinfo('3', '홍길동D', '', '19900102')]})
        self.assertEqual(dl.match_person(ROW, s)['status'], 'check')

    def test_all_states_retry_when_youth_candidates_do_not_match(self):
        s = FakeSearcher(by_name={'홍길동': [cardinfo('2', '홍길동A', '', '19960101', army='석', team='퓨어')]},
                         by_name_all={'홍길동': [cardinfo('2', '홍길동A', '', '19960101', army='석', team='퓨어'),
                                                cardinfo('9', '홍길동G', '', '19870101', state='교인 > 새가족')]})
        r = dl.match_person({'name': '홍길동', 'army': '조', 'team': '보배'}, s)
        self.assertEqual((r['status'], r['card']['id'], r['all_states']), ('matched', '9', True))

    def test_all_states_retry_finds_moved_member(self):
        s = FakeSearcher(by_name_all={'홍길동': [cardinfo('8', '홍길동G', '', '19900102', state='교인 > 새가족')]})
        r = dl.match_person({**ROW, 'phone': ''}, s)
        self.assertEqual((r['status'], r['card']['id'], r['all_states']), ('matched', '8', True))
        self.assertIn(('홍길동', '', True), s.calls)


class CliTests(unittest.TestCase):
    def test_search_prints_json_only(self):
        fake = mock.Mock()
        fake.search.return_value = {'cards': [cardinfo('1', '홍길동')], 'pages': 1, 'truncated': False}
        out = io.StringIO()
        with mock.patch.object(dl, 'open_client', return_value=fake), redirect_stdout(out):
            code = dl.main(['search', '--name', '홍길동', '--all-states'])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())['cards'][0]['id'], '1')
        fake.search.assert_called_once_with(name='홍길동', phone='', all_states=True)


if __name__ == '__main__':
    unittest.main()
