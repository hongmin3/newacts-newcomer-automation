'use strict';
const assert=require('node:assert/strict');
const {createFixture}=require('./helpers/event-day-memory.cjs');
// Validates: REQ-EVENTDAYWORKBOOK-013. 실제 입력 오류 경로에서 색 표시 누락을 잡는다.
const f=createFixture();
f.input('명군',3,3,[['표시검증','여',30,'01012345678']]);
f.input('명군',3,9,'없는군');
assert.match(f.sheets['명군'].notes['3,3'],/^입력 확인:/);
assert.equal(f.sheets['명군'].getRange(3,3).getFontColors()[0][0],'#b45309','잘못된 입력을 주황 글씨로 표시');
assert.equal(f.sheets['명군'].data[2][8],'없는군','오류 입력값 보존');
f.input('명군',3,9,'명');
assert.equal(f.sheets['명군'].getRange(3,3).getFontColors()[0][0],'#000000','수정 완료 후 원래 글씨색');
console.log('통과: 실제 입력 오류 표시·해결·값 보존');
// 군별 탭에서는 기존 군을 비워도 해당 탭의 군으로 유지해야 한다.
const g=createFixture();
g.input('명군',3,3,[['군이동검증','여',30,'01012345679']]);
g.input('명군',3,9,'');
assert.equal(g.raw()[0][2],'명군','군별 탭에서는 기존 군을 비워도 해당 군');
assert.equal(g.visible('명군').length,1);
assert.equal(g.visible('기타').length,0);
assert.equal(g.visible('명군')[0].values[5],'010-1234-5679');
console.log('통과: 군별 기존 명단 빈칸은 해당 군 유지·개인 정보 보존');
// 표시 갱신 중 사용자 입력도 남고 데이터 쓰기 자체가 없는지 확인한다.
const h=createFixture();
h.input('총 방문 새가족',2,3,[['표시전용검증','여',30,'01012345680']]);
h.sheets['총 방문 새가족'].getRange(2,3).setNote('충돌: 팀 (저장값: 가 / 입력: 나)');
h.sheets['총 방문 새가족'].rules=[{external:'기존 중복 경고'}];
const data=JSON.stringify(Object.values(h.sheets).map(s=>s.data));let injected=false;
h.setHook(e=>{assert.notEqual(e.kind,'write','표시 갱신은 데이터 쓰기를 하면 안 됨');if(e.kind==='format'&&e.phase==='before'&&!injected){injected=true;h.sheets['총 방문 새가족'].data[1][6]='동시에 입력한 주소';}});
assert.equal(h.ctx.eventRefreshStatusDisplay(),true);
h.setHook(null);
assert.ok(injected);assert.equal(h.sheets['총 방문 새가족'].data[1][6],'동시에 입력한 주소');
h.sheets['총 방문 새가족'].data[1][6]='';
assert.equal(JSON.stringify(Object.values(h.sheets).map(s=>s.data)),data,'전체 명단·원본·기록·연결 값 보존');
assert.equal(h.sheets['총 방문 새가족'].fontColors['2,3'],'#c5221f');
assert.deepEqual(h.sheets['총 방문 새가족'].rules,[{external:'기존 중복 경고'}]);
assert.match(h.sheets['총 방문 새가족'].notes['1,3'],/입력 상태 색상/);
const note=h.sheets['총 방문 새가족'].notes['2,3'];h.ctx.eventRefreshStatusDisplay();assert.equal(h.sheets['총 방문 새가족'].notes['2,3'],note,'반복 실행 안내문 중복 없음');
console.log('통과: 표시 전용 실행 중 새 입력·전체 데이터·중복 규칙 보존');
// 실제 충돌 경로, 두 입력값 보존, 선택 후 빨강 해제.
const c=createFixture();c.input('명군',27,3,[['충돌검증','여',30,'01012345681']]);
c.hold('busy');c.input('명군',27,10,'둘째팀','second');c.input('총 등록 새가족',2,10,'첫째팀','third');c.release();c.repair();
assert.equal(c.sheets['명군'].fontColors['27,3'],'#c5221f');assert.equal(c.sheets['명군'].data[26][9],'둘째팀');assert.equal(c.raw()[0][3],'첫째팀');
c.input('명군',27,10,'둘째팀');assert.equal(c.raw()[0][3],'둘째팀');assert.equal(c.sheets['명군'].fontColors['27,3'],'#000000');
console.log('통과: 충돌 두 값 보존·재입력 해결 후 표시 해제');
// 기타 이동은 방문과 등록의 연결을 섞지 않는다.
for(const registered of [false,true])for(const where of ['전체','군']){
 const x=createFixture(),name=where==='전체'?(registered?'총 등록 새가족':'총 방문 새가족'):'명군',r=where==='전체'?2:(registered?27:3);
 x.input(name,r,3,[['군비우기','여',30,'01012345682']]);x.input(name,r,9,'명');const before=x.raw()[0];x.input(name,r,9,'');
 const after=x.raw()[0];assert.equal(after[2],where==='전체'?'기타':'명군');assert.equal(after[0],before[0]);assert.deepEqual(after.slice(3,18),before.slice(3,18));assert.equal(x.visible(where==='전체'?'기타':'명군',registered).length,1);
}
console.log('통과: 전체 빈칸 기타·군별 빈칸 해당 군 4경로·관리번호 보존');
// 새 군별 입력은 군을 먼저 쓰지 않아도 탭의 군으로 배정한다.
for(const group of ['신군','조군','명군','총군','영군','석군','전군','임군','슬군'])for(const registered of [false,true]){
 const n=createFixture(),r=registered?27:3;n.input(group,r,3,'새입력검증');
 assert.equal(n.raw()[0][2],group,'새 이름 입력은 해당 군 기본 배정');
 assert.equal(n.sheets[group].data[r-1][8],group.slice(0,-1));
 assert.equal(n.visible('기타',registered).length,0);
 n.input(group,r,6,'01012345683');assert.equal(n.raw()[0][2],group,'연락처를 나중에 채워도 군 유지');
}
console.log('통과: 9개 군의 방문·등록 새 입력 18경로 기본 군 배정');
// 편집값 복구 경로에서도 군별 빈칸을 기타로 바꾸지 않는다.
for(const name of ['신군','총 방문 새가족']){
 const q=createFixture(),r=name==='신군'?3:2;q.input(name,r,3,'대기군검증');q.input(name,r,9,'신');q.hold('busy');q.input(name,r,9,'');q.release();q.repair();
 assert.equal(q.raw()[0][2],name==='신군'?'신군':'기타');
}
console.log('통과: 잠금 대기 후 군 빈칸도 입력 탭 기준으로 복구');
// 충돌 확인 전 다른 칸을 고쳤다는 이유로 충돌 값을 채택하면 안 된다.
const u=createFixture();u.input('명군',27,3,[['미확정충돌','여',30,'01012345684']]);
u.hold('busy');u.input('명군',27,10,'확인전팀','second');u.input('총 등록 새가족',2,10,'저장팀','third');u.release();u.repair();
u.input('명군',27,7,'추가주소');
assert.equal(u.raw()[0][3],'저장팀','다른 칸 수정으로 충돌을 확정하지 않음');
assert.equal(u.raw()[0][10],'추가주소');assert.equal(u.sheets['명군'].data[26][9],'확인전팀');assert.match(u.sheets['명군'].notes['27,3'],/^충돌:/);
console.log('통과: 충돌 중 다른 칸 수정은 충돌 값을 확정하지 않음');
