'use strict';
const assert=require('node:assert/strict');
const {createFixture}=require('./helpers/event-day-memory.cjs');
// Validates: REQ-EVENTDAYWORKBOOK-006, REQ-EVENTDAYWORKBOOK-004.
// 중간 번호를 하나씩 쓰는 구현으로 되돌리면 첫 쓰기 직후 완성 번호 검사가 실패한다.
const f=createFixture(),sh=f.sheets['총 방문 새가족'];
for(let i=0;i<140;i++)sh.getRange(i+2,1,1,11).setValues([[i+2,'',i===20?'':'번호시험'+i,'여',30,'','보존주소','','명','','-']]);
const before=JSON.stringify(sh.data.map(r=>r.slice(1)));let writes=0;
f.setHook(e=>{if(e.kind==='write'&&e.phase==='after'&&e.sheet===sh.name&&e.col===1){writes++;let n=0;for(const r of sh.data.slice(1))assert.equal(r[0],r[2]?++n:'','A열 쓰기 직후 전체 번호가 완성되어야 함');}});
let wrapped=f.ctx.eventPlainWrap_(f.book);wrapped.labelNames={[sh.name]:true};f.ctx.eventPlainLabels_(wrapped,true);
assert.equal(writes,1);assert.equal(JSON.stringify(sh.data.map(r=>r.slice(1))),before);
console.log('통과: 140행 순번 한 번 갱신·빈 이름 제외·입력 값 보존');
// 넓은 읽기 직후 이름이 바뀌면 최신 이름을 다시 읽어 번호를 계산한다.
const g=createFixture(),gs=g.sheets['총 방문 새가족'];
gs.getRange(2,1,3,11).setValues([[9,'','첫째','','','','','','명','','-'],[9,'','둘째','','','','','','명','','-'],[9,'','셋째','','','','','','명','','-']]);
let changed=false;g.setHook(e=>{if(!changed&&e.kind==='read'&&e.phase==='after'&&e.sheet===gs.name&&e.nc===11){changed=true;gs.data[2][2]='';gs.data[3][6]='최신주소';}});
wrapped=g.ctx.eventPlainWrap_(g.book);wrapped.labelNames={[gs.name]:true};g.ctx.eventPlainLabels_(wrapped,true);
assert.deepEqual(gs.data.slice(1).map(r=>r[0]),[1,'',2]);assert.equal(gs.data[3][6],'최신주소');
console.log('통과: 갱신 직전 이름 삭제 반영·동시 주소 입력 보존');
// 대기 입력이 다른 군에서 계속 처리돼도 모든 명단의 순번을 먼저 확인한다.
const q=createFixture();q.input('조군',3,3,'먼저저장');q.sheets['조군'].getRange(3,1).setValue(99);
q.hold('busy');q.input('영군',3,3,'신규대기');q.ctx.eventImportUnsaved();q.release();
q.repair();assert.equal(q.sheets['조군'].data[2][0],1,'신규 대기 처리 전에 다른 군 번호도 정리');
console.log('통과: 신규 대기 중에도 전체 명단 순번 먼저 확인');
const cacheCheck=createFixture(),cacheWrap=cacheCheck.ctx.eventPlainWrap_(cacheCheck.book);
cacheCheck.ctx.eventPlainNumbers_(cacheWrap);
assert.deepEqual(Object.keys(cacheWrap.labelNames),[],'번호 확인이 명단 전체를 수정 대상으로 표시하지 않음');
console.log('통과: 번호 확인 후 실제 수정 대상 범위 유지');
// 행 수는 그대로지만 입력 범위 시작만 밀렸을 때 첫 두 명이 빠지는 재현.
const rangeFix=createFixture(),rp=rangeFix.sheets['명군'];
rangeFix.input('명군',27,3,[['범위첫째','여',30,'01099999301'],['범위둘째','남',31,'01099999302']]);
rangeFix.book.setNamedRange('_EVENT_'+rp.id+'_REG',rp.getRange(29,1,8,13));
const namesBefore=JSON.stringify(rp.data.map(r=>r.slice(2,13)));
const repaired=rangeFix.ctx.eventPlainConfigure_(rp,rangeFix.ctx.eventPlainMap_('명군::등록'));
assert.equal(repaired.offset+2,27,'실제 머리글 다음 첫 입력 행을 복구');
assert.equal(rangeFix.book.getRangeByName('_EVENT_'+rp.id+'_REG').getNumRows(),10);
assert.equal(JSON.stringify(rp.data.map(r=>r.slice(2,13))),namesBefore);
console.log('통과: 머리글과 입력 범위 불일치 복구·첫 두 명과 입력 보존');
