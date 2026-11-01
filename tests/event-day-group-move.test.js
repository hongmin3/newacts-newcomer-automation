// Validates: REQ-EVENTDAYWORKBOOK-002, REQ-EVENTDAYWORKBOOK-004, REQ-EVENTDAYWORKBOOK-007, REQ-EVENTDAYWORKBOOK-011
const assert=require('node:assert/strict');
const {createFixture}=require('./helpers/event-day-memory.cjs');
for(const registered of [false,true]){
 const f=createFixture(),row=registered?27:3;
 f.input('기타',row,3,[['군이동가상','여',30,'01012345678']]);
 const id=f.raw()[0][0];
 f.hold('busy');f.input('기타',row,9,'신');f.release();
 // 전체 화면 복구가 느려도 군 수정은 그 앞에서 저장·이동되어야 한다.
 const refresh=f.ctx.eventRefreshProjections_;
 f.ctx.eventRefreshProjections_=function(ss){assert.equal(f.raw()[0][2],'신군','군 변경을 전체 복구보다 먼저 반영');return refresh(ss);};
 f.repair();
 assert.equal(f.raw()[0][2],'신군');assert.equal(f.raw()[0][0],id);
 assert.equal(f.visible('기타',registered).length,0);
 assert.equal(f.visible('신군',registered).length,1);
 const total=f.visible(registered?'총 등록 새가족':'총 방문 새가족',registered);
 assert.equal(total[0].values[8],'신');assert.equal(total[0].id,id);
 assert.equal(f.raw().filter(x=>!x[21]).length,1);
}
console.log('기타 군 변경은 방문·등록 각각 전체 확인에 앞서 이동·연결');
const pending=createFixture();pending.input('기타',3,3,[['군주소동시','여',30,'01012345679']]);pending.hold('busy');pending.input('기타',3,7,'함께입력한주소');pending.input('기타',3,9,'총군');pending.release();pending.repair();pending.repair();pending.repair();assert.equal(pending.raw()[0][2],'총군');assert.equal(pending.raw()[0][10],'함께입력한주소');assert.equal(pending.visible('기타').length,0);assert.equal(pending.visible('총군').length,1);
const conflict=createFixture();conflict.input('기타',3,3,[['군충돌가상','여',30,'01012345670']]);conflict.hold('busy');conflict.input('총 방문 새가족',2,9,'명');conflict.input('기타',3,9,'신');conflict.release();conflict.repair();assert.equal(conflict.raw()[0][2],'신군');assert.match(conflict.visible('총 방문 새가족')[0].note,/충돌:/);assert.equal(conflict.visible('총 방문 새가족')[0].values[8],'명');console.log('군 이동과 겹친 주소 보존·다른 화면의 군 충돌 보호');
const early=createFixture();early.input('기타',3,3,[['군변경우선','여',30,'01012345671']]);early.hold('busy');early.input('기타',3,9,'석');early.release();early.ctx.eventReplayEdits_=()=>{throw Error('다른 편집 보관값 처리가 오래 걸림');};early.repair();assert.equal(early.raw()[0][2],'석군','오래된 다른 편집 보관값을 처리하기 전에 군 이동');assert.equal(early.visible('기타').length,0);
const manual=createFixture();for(let n=0;n<7;n++)manual.input('기타',3+n,3,[['군이동묶음'+n,'여',30,'0109999'+String(1000+n)]]);manual.hold('busy');for(let n=0;n<7;n++)manual.input('기타',3+n,9,n?'신':'총');manual.release();assert.equal(manual.ctx.eventSyncGroupMoves(),true);assert.equal(manual.visible('기타').length,0);assert.equal(manual.visible('신군').length,6);assert.equal(manual.visible('총군').length,1);assert.equal(manual.visible('총 방문 새가족').length,7);console.log('군 변경 전용 재처리에서 일곱 카드의 번호·인원 보존');
