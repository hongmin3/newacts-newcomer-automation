"""Conservative identity review; never creates a member."""
import re


def inspect_identity(applicant, search):
    candidates={}; complete=True
    # Always inspect both sources across all membership states.
    for query in [{'name':applicant['name']}, {'phone':applicant['phone']}]:
        if not next(iter(query.values())): continue
        try:
            response=search(**query,all_states=True)
        except Exception:
            return {'state':'REVIEW','external_id':None,'reason':'교적 조회 실패. 신규 판정 불가','candidates':[]}
        complete = complete and not response.get('truncated',True)
        for card in response.get('cards',[]):
            key=card.get('id') or repr(card)
            candidates[key]=card
    cards=list(candidates.values())
    matches=[]; conflict=False
    for c in cards:
        same_name=c.get('name','').strip()==applicant['name']
        phone=re.sub(r'\D','',str(c.get('phone','')))
        same_phone=bool(phone) and phone==applicant['phone']
        birth=c.get('birth') or c.get('birthdate') or ''
        birth_conflict=bool(birth and applicant.get('birth') and birth!=applicant['birth'])
        same_birth=bool(birth) and birth==applicant.get('birth')
        if same_name and (same_phone or same_birth) and not birth_conflict and c.get('id'):
            matches.append(c)
        else: conflict=True
    if complete and len(matches)==1 and not conflict:
        return {'state':'EXISTING','external_id':matches[0]['id'],'canonical_name':matches[0]['name'],
                'reason':'이름과 연락처 또는 생년월일 일치','candidates':cards}
    if complete and not cards:
        return {'state':'NEW_CANDIDATE','external_id':None,'reason':'검색 완료. 신규 여부 담당자 확인 필요','candidates':[]}
    return {'state':'REVIEW','external_id':None,'reason':'후보 충돌·검색 미완료 또는 추가 확인 필요','candidates':cards}
