'use strict';
const assert=require('node:assert/strict');const {createFixture}=require('./helpers/event-day-memory.cjs');
// Validates: REQ-EVENTDAYWORKBOOK-014
function activate(f){f.ctx.eventEnableStructureTracking();}
function person(f,n='명군',row=3,name='행삭제시험'){f.input(n,row,3,[[name,'여',30,'01077770001']]);}
const f=createFixture();person(f);person(f,'명군',27);activate(f);f.sheets['명군'].deleteRows(3,1);f.ctx.eventOnChange({source:f.book,changeType:'REMOVE_ROW'});f.repair();assert.equal(f.visible('총 방문 새가족').length,0);assert.equal(f.visible('명군').length,0);assert.equal(f.visible('총 등록 새가족',true).length,1);assert.equal(f.raw().filter(r=>r[21]).length,1);console.log('물리 방문행 삭제가 등록카드를 보존하며 전체/군에 전파');
for(const title of ['총 방문 새가족','총 등록 새가족','명군'])for(const reg of title==='명군'?[false,true]:[title==='총 등록 새가족']){
 const x=createFixture(),row=title==='명군'?(reg?27:3):2;person(x,title,row);activate(x);x.sheets[title].deleteRows(row,1);x.ctx.eventOnChange({source:x.book,changeType:'REMOVE_ROW'});x.repair();assert.equal(x.raw().filter(r=>!r[21]).length,0);x.ctx.eventOnChange({source:x.book,changeType:'REMOVE_ROW'});assert.equal(x.raw().filter(r=>r[21]).length,1);
}
console.log('전체/군별 방문·등록4경로와 반복삭제 안전');
const blank=createFixture();person(blank);activate(blank);blank.sheets['명군'].deleteRows(10,2);blank.ctx.eventOnChange({source:blank.book,changeType:'REMOVE_ROW'});assert.equal(blank.raw().filter(r=>!r[21]).length,1);blank.sheets['명군'].insertRowsBefore(3,2);blank.ctx.eventOnChange({source:blank.book,changeType:'INSERT_ROW'});assert.equal(blank.book.getRangeByName('_EVENT_'+blank.sheets['명군'].id+'_VISIT').getRow(),3);assert.equal(blank.visible('명군')[0].values[0],1);
console.log('빈행 삭제·첫입력행 앞 삽입·번호·입력범위 보존');
const all=createFixture();person(all);activate(all);all.sheets['명군'].deleteRows(3,20);all.ctx.eventOnChange({source:all.book,changeType:'REMOVE_ROW'});assert.equal(all.raw().filter(r=>!r[21]).length,0);assert.ok(all.book.getRangeByName('_EVENT_'+all.sheets['명군'].id+'_VISIT').getNumRows()>=1);
console.log('입력영역 전체행 삭제 후 빈입력행 재확보');
const delayed=createFixture();person(delayed);activate(delayed);delayed.hold('동시입력');delayed.sheets['명군'].deleteRows(3,1);delayed.ctx.eventOnChange({source:delayed.book,changeType:'REMOVE_ROW'});assert.equal(delayed.raw().filter(r=>!r[21]).length,1);delayed.release();delayed.repair();assert.equal(delayed.raw().filter(r=>!r[21]).length,0);
console.log('잠금대기 중 행삭제도 다음 자동확인에서 취소');
const absent=createFixture();person(absent);activate(absent);absent.sheets['총 방문 새가족'].getRange(2,1,1,32).clearContent();absent.advance(16*60000);absent.repair();assert.equal(absent.raw().filter(r=>!r[21]).length,1);assert.equal(absent.visible('총 방문 새가족').length,1);
console.log('행수 변화 없는 화면누락은 취소하지 않고 복구');
const twin=createFixture();person(twin);const saved=twin.sheets['명군'].getRange(3,1,1,32).getValues();twin.sheets['명군'].getRange(4,1,1,32).setValues(saved);activate(twin);twin.sheets['명군'].deleteRows(4,1);twin.ctx.eventOnChange({source:twin.book,changeType:'REMOVE_ROW'});assert.equal(twin.raw().filter(r=>!r[21]).length,1);
console.log('같은ID 중복행 한줄만 삭제하면 카드 유지');
const mid=createFixture();person(mid);activate(mid);let once=false;mid.setHook(e=>{if(!once&&e.kind==='read'&&e.phase==='after'&&e.sheet==='명군'){once=true;mid.sheets['명군'].deleteRows(3,1);}});try{mid.input('총 방문 새가족',2,7,'다른화면주소');}catch(_){}mid.setHook(null);mid.advance(16*60000);mid.repair();assert.ok(once);assert.equal(mid.raw().filter(r=>!r[21]).length,0);
console.log('처리도중 물리행삭제 후에도 기록이 되살아나지 않음');
const bulk=createFixture();for(let i=0;i<4;i++)person(bulk,'명군',3+i,'일괄'+i);activate(bulk);bulk.sheets['명군'].deleteRows(4,2);bulk.ctx.eventOnChange({source:bulk.book,changeType:'REMOVE_ROW'});bulk.repair();assert.equal(bulk.raw().filter(r=>!r[21]).length,2);assert.deepEqual(bulk.visible('총 방문 새가족').map(r=>Number(r.values[0])),[1,2]);assert.deepEqual(bulk.visible('명군').map(r=>Number(r.values[0])),[1,2]);
console.log('여러행 삭제 후 남은 명단 연속번호');
const net=createFixture();person(net);activate(net);net.sheets['명군'].deleteRows(3,1);net.sheets['명군'].insertRowsBefore(3,1);net.ctx.eventOnChange({source:net.book,changeType:'REMOVE_ROW'});assert.equal(net.raw().filter(r=>!r[21]).length,0);
console.log('삭제와 삽입으로 전체행수가 같아도 삭제알림으로 처리');
const growth=createFixture();activate(growth);for(let i=0;i<19;i++)person(growth,'명군',3+i,'확장'+i);growth.repair();assert.equal(growth.raw().filter(r=>!r[21]).length,19);assert.equal(growth.visible('총 방문 새가족').length,19);
console.log('자동10행확장과 수동행삭제 판단 분리');
const initial=createFixture();person(initial);initial.sheets['총 방문 새가족'].deleteRows(2,1);activate(initial);initial.advance(16*60000);initial.repair();assert.equal(initial.raw().filter(r=>!r[21]).length,1);assert.equal(initial.visible('총 방문 새가족').length,1);
console.log('활성화 전 빠진행은 추측취소하지 않음');
const concurrent=createFixture();person(concurrent);activate(concurrent);concurrent.hold('busy');concurrent.input('총 방문 새가족',2,7,'삭제동시새주소');concurrent.sheets['명군'].deleteRows(3,1);concurrent.release();concurrent.ctx.eventOnChange({source:concurrent.book,changeType:'REMOVE_ROW'});assert.equal(concurrent.raw().filter(r=>!r[21]).length,0);assert.ok(concurrent.sheets['_변경기록'].data.some(r=>String(r[4]).includes('삭제동시새주소')));
console.log('삭제와 겹친 다른화면 수정값은 취소기록에 보관');
const broken=createFixture();person(broken);activate(broken);broken.sheets['명군'].deleteRows(2,2);try{broken.ctx.eventOnChange({source:broken.book,changeType:'REMOVE_ROW'});}catch(_){}assert.equal(broken.raw().filter(r=>!r[21]).length,1);
console.log('머리글까지 삭제한 잘못된 구조에서는 명단 취소 보류');
const brokenTotal=createFixture();person(brokenTotal);activate(brokenTotal);brokenTotal.sheets['총 방문 새가족'].deleteRows(1,2);try{brokenTotal.ctx.eventOnChange({source:brokenTotal.book,changeType:'REMOVE_ROW'});}catch(_){}assert.equal(brokenTotal.raw().filter(r=>!r[21]).length,1);
console.log('전체 명단 머리글 삭제 시 원본 보존');

const queued=createFixture();person(queued);queued.hold('busy');queued.ctx.eventEnableStructureTracking();assert.equal(queued.props.EVENT_STRUCT_REQUESTED,'v1');queued.release();queued.repair();assert.equal(queued.props.EVENT_STRUCT_ENABLED,'v1');assert.equal(queued.raw().filter(r=>!r[21]).length,1);console.log('동시 입력 잠금 중 활성화 요청도 다음 처리에서 안전하게 초기화');
