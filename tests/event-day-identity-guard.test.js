'use strict';
// Validates: REQ-EVENTDAYWORKBOOK-004
const assert=require('node:assert/strict');
const {createFixture}=require('./helpers/event-day-memory.cjs');
for(const reg of [false,true]){
 const f=createFixture(),start=reg?27:3,total=reg?'총 등록 새가족':'총 방문 새가족';
 f.input('명군',start,3,[['보호원래사람','여',30,'01099999101']]);
 f.input('명군',start+1,3,[['보호다른사람','남',31,'01099999102']]);
 const before=JSON.stringify(f.raw()),ids=f.raw().map(r=>r[0]);
 const visible=f.sheets[total].getRange(3,2,1,reg?12:11).getValues();
 f.input(total,2,2,visible);f.repair();
 assert.equal(JSON.stringify(f.raw()),before,'다른 카드의 이름·휴대폰이 입력된 기존 번호는 원본 수정 보류');
 assert.equal(f.sheets[total].getRange(2,3).getValues()[0][0],'보호다른사람','사람의 화면 입력값은 보존');
 assert.equal(f.sheets[total].getRange(2,29).getValues()[0][0],ids[0],'의심 입력으로 관리번호를 바꾸지 않는다');
 assert.match(f.sheets[total].getRange(2,3).getNotes()[0][0],/입력 확인:.*관리번호/);
}
console.log('다른 기존 카드로 바뀐 이름·전화는 원본을 보존하고 확인 안내');
// 이동한 본문에 전화 등 추가 수정이 섞여 정확한 기존 카드가 없어도 보호한다.
const x=createFixture();x.input('명군',3,3,[['원래가상','여',30,'01099999201']]);const saved=JSON.stringify(x.raw());
x.input('총 방문 새가족',2,3,[['새로운가상','여',30,'01099999202']]);x.repair();
assert.equal(JSON.stringify(x.raw()),saved,'이름과 전화가 함께 달라진 기존 카드 원본 보존');
assert.equal(x.sheets['총 방문 새가족'].data[1][2],'새로운가상');
console.log('기존 카드의 이름·전화 동시 변경은 정확한 후보가 없어도 보류');
