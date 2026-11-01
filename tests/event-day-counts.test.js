'use strict';
const assert=require('node:assert/strict');
const {createFixture}=require('./helpers/event-day-memory.cjs');
// Validates: REQ-EVENTDAYWORKBOOK-003
const f=createFixture(),g=f.sheets['신군'];
f.hold('busy');f.input('신군',3,3,'대기입력');f.release();
assert.equal(f.raw().length,0);
const m=f.ctx.eventPlainConfigure_(g,f.ctx.eventPlainMap_('신군::방문'));
f.ctx.eventPlainFooter_(g,m);
let formula=g.getRange(23,12).getFormulas()[0][0];
assert.ok(formula.includes('_EVENT_'+g.id+'_VISIT'),'계는 원본 저장을 기다리지 않고 실제 입력 구역을 센다');
assert.ok(!formula.includes('_원본'),'대기 인원을 제외하지 않는다');
g.insertRowsBefore(4,2);f.ctx.eventPlainConfigure_(g,m);f.ctx.eventPlainFooter_(g,m);
assert.equal(g.getRange(25,12).getFormulas()[0][0],formula,'행 삽입 후 같은 이름 지정 범위로 집계');
g.deleteRows(4,1);f.ctx.eventPlainConfigure_(g,m);f.ctx.eventPlainFooter_(g,m);
assert.equal(g.getRange(24,12).getFormulas()[0][0],formula,'행 삭제 후 범위 유지');
assert.equal(g.getRange(3,3).getValues()[0][0],'대기입력','집계 갱신은 입력 보존');
const before=JSON.stringify(g.data.map(r=>r?.slice(0,10)));
f.ctx.eventRefreshCounts();assert.equal(JSON.stringify(g.data.map(r=>r?.slice(0,10))),before);
assert.ok(f.sheets['총 방문 새가족'].getRange(1,16).getFormulas()[0][0].includes('C2:C'));
console.log('대기 이름 집계·행 추가 삭제 범위·입력 보존 통과');
const z=createFixture();z.hold('다른입력');const snapshot=JSON.stringify(Object.values(z.sheets).map(s=>s.data));assert.equal(z.ctx.eventRefreshCounts(),false);assert.equal(JSON.stringify(Object.values(z.sheets).map(s=>s.data)),snapshot,'잠금 중 명단·계 모두 보존');z.release();z.ctx.eventRefreshCounts();for(const g of z.groups)for(const kind of ['VISIT','REG']){const sh=z.sheets[g],region=z.book.getRangeByName('_EVENT_'+sh.id+'_'+kind);assert.match(sh.getRange(region.getLastRow()+1,kind==='REG'?13:12).getFormulas()[0][0],new RegExp('_EVENT_'+sh.id+'_'+kind));}
const layout=require('../event-day-workbook/layout.cjs');const formulas=layout.build().flatMap(q=>(q.updateCells?.rows||[]).flatMap(r=>r.values||[]).map(c=>c.userEnteredValue?.formulaValue).filter(Boolean));assert.equal(formulas.length,22);assert.ok(formulas.every(s=>s.startsWith('=SUMPRODUCT(N(LEN(TRIM(')&&!s.includes('_원본')));
console.log('10군 방문·등록20구역·전체2구역·잠금 대기·초기 양식 집계 통과');
const shifted=createFixture();shifted.sheets['신군'].getRange(23,11).setValue('입력중');shifted.sheets['신군'].getRange(23,12).setValue('보존할메모');shifted.ctx.eventRefreshCounts();assert.equal(shifted.sheets['신군'].getRange(23,12).getValues()[0][0],'보존할메모');assert.equal(shifted.props.EVENT_COUNTS_REV,undefined,'계 위치 불명확하면 완료로 표시하지 않는다');
console.log('계 위치 이동·일반 입력값 덮어쓰기 방지 통과');
