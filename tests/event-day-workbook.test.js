'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const file = path.join(__dirname, '../event-day-workbook/Code.gs');
const ctx = {console, Date, JSON, Math, Set, Map};
if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
// Validates: REQ-EVENTDAYWORKBOOK-001, REQ-EVENTDAYWORKBOOK-002, REQ-EVENTDAYWORKBOOK-003, REQ-EVENTDAYWORKBOOK-004, REQ-EVENTDAYWORKBOOK-005, TEST-EVENTDAYWORKBOOK-001
assert.equal(typeof ctx.eventPlainMap_, 'function', '체크박스 없이 방문·등록 입력 영역을 구분해야 한다');
assert.equal(typeof ctx.onEdit, 'function', '전체와 군별 입력을 처리하는 onEdit이 있어야 한다');
assert.equal(typeof ctx.eventApplyPatch_, 'function', '입력 검사·항목 충돌을 처리해야 한다');
const empty = () => Array(22).fill('');
let r = empty(); r[0]='ID-1'; r[1]='2026-11-01'; r[2]='신군'; r[5]='가상하나'; r[9]='01011112222'; r[13]=true; r[14]=false; r[20]=1; r[21]=false;
let result=ctx.eventApplyPatch_(r, r, {14:true}, '신군', false);
assert.equal(result.row[14],true); assert.equal(result.row[13],true);
result=ctx.eventApplyPatch_(r,r,{9:'010-1111-2222'},'신군',false);
assert.equal(result.row[9],'010-1111-2222');
assert.throws(()=>ctx.eventApplyPatch_(r,r,{1:'2026-10-31'},'신군',false), /11월 1일/);
assert.throws(()=>ctx.eventApplyPatch_(r,r,{2:'없는군'},'신군',false), /군/);
assert.throws(()=>ctx.eventApplyPatch_(r,r,{9:'abc'},'신군',false), /전화/);
assert.throws(()=>ctx.eventApplyPatch_(r,r,{7:-1},'신군',false), /나이/);
let canonical=r.slice(); canonical[3]='먼저팀';
result=ctx.eventApplyPatch_(canonical,r,{4:'새순'},'신군',false);
assert.equal(result.row[3],'먼저팀'); assert.equal(result.row[4],'새순');
result=ctx.eventApplyPatch_(canonical,r,{3:'다른팀'},'신군',false);
assert.equal(result.conflicts.length,1); assert.equal(result.row[3],'먼저팀');
let next=r.slice();next[3]='새팀';
let current=r.slice();current[4]='대기순';
let projection=ctx.eventProjection_(current,r,next);
assert.equal(projection.values[3],'새팀'); assert.equal(projection.values[4],'대기순');
assert.equal(projection.baseline[4],r[4]);
assert.equal(ctx.eventKey_(r), ctx.eventKey_(Object.assign(r.slice(),{9:'010-1111-2222'})));
let noPhone=r.slice();noPhone[9]='';assert.equal(ctx.eventKey_(noPhone),'');
console.log('행축 당일 검사·등록 유지·충돌·대기 입력 보존 통과');

// 실제 onEdit 진입점을 실행한다. 외부 Sheets 경계만 대체한다.
class Range {
 constructor(sheet,row,col,nr=1,nc=1){Object.assign(this,{sheet,row,col,nr,nc});}
 getSheet(){return this.sheet;} getRow(){return this.row;} getColumn(){return this.col;}
 getLastRow(){return this.row+this.nr-1;} getLastColumn(){return this.col+this.nc-1;}
 getNumRows(){return this.nr;} getNumColumns(){return this.nc;}
 getValues(){return Array.from({length:this.nr},(_,i)=>Array.from({length:this.nc},(_,j)=>this.sheet.data[this.row+i-1]?.[this.col+j-1]??''));}
 setValues(rows){
  const f=this.sheet.ss.failWrite;if(f?.name===this.sheet.name&&f.count-->0)throw Error('가상 네트워크 중단');
  rows.forEach((r,i)=>r.forEach((v,j)=>{this.sheet.data[this.row+i-1]??=[];this.sheet.data[this.row+i-1][this.col+j-1]=v;}));return this;
 }
 setValue(v){return this.setValues([[v]]);}
 clearContent(){return this.setValues(Array.from({length:this.nr},()=>Array(this.nc).fill('')));}
}
class Sheet {
 constructor(ss,name){Object.assign(this,{ss,name,data:[Array(22).fill('머리글')],max:1001,activeRow:2});}
 getName(){return this.name;}getMaxRows(){return this.max;}insertRowsAfter(n,count){this.max+=count;}
 getLastRow(){for(let i=this.data.length-1;i>=0;i--)if(this.data[i]?.some(v=>v!==''&&v!==null&&v!==undefined))return i+1;return 0;}
 getRange(r,c,nr,nc){if(typeof r==='string'){const m=r.match(/^([A-Z]+)(\d+)$/);return new Range(this,+m[2],m[1].split('').reduce((n,x)=>n*26+x.charCodeAt(0)-64,0));}return new Range(this,r,c,nr,nc);}
 appendRow(r){this.getRange(this.getLastRow()+1,1,1,r.length).setValues([r]);}
 getActiveRange(){return this.getRange(this.activeRow,1);}
}
let uuid=0,active,locked=false;
const ss={sheets:{},toasts:[],getSheetByName(n){return this.sheets[n];},getActiveSheet(){return active;},toast(m){this.toasts.push(m);}};
ctx.eventViews_().concat([ctx.EVENT.raw,ctx.EVENT.log,ctx.EVENT.conflicts,'사용 안내']).forEach(n=>ss.sheets[n]=new Sheet(ss,n));ctx.EVENT.groups.forEach(g=>ss.sheets[g]=ss.sheets[g+'::방문']);
ctx.Utilities={getUuid:()=>`test-${++uuid}`,formatDate:(_d,_tz,fmt)=>fmt==='yyyy-MM-dd'?'2026-11-01':'2026-11-01 12:00:00'};
ctx.LockService={getDocumentLock:()=>({tryLock:()=>!locked,releaseLock(){}})};
ctx.SpreadsheetApp={getActive:()=>ss,flush(){},getUi:()=>({alert:()=>1,ButtonSet:{YES_NO:1},Button:{YES:1}})};
const rows=n=>ctx.eventData_(ss.sheets[n]).filter(r=>r[0]);
function edit(name,row,col,value){const sh=ss.sheets[name];sh.getRange(row,col).setValue(value);ctx.onEdit({source:ss,range:sh.getRange(row,col),value:String(value)});}
function paste(name,row,col,values){const sh=ss.sheets[name];sh.getRange(row,col,values.length,values[0].length).setValues(values);ctx.onEdit({source:ss,range:sh.getRange(row,col,values.length,values[0].length)});}
function assertHealthy(name){const data=ctx.eventData_(ss.sheets[name]);assert.ok(!data.some(r=>/^입력 확인|반영 중단/.test(r[18])),`${name}: ${data.map(r=>r[18])}`);}
// 전체 방문 → 군, 등록 체크 → 등록 명단, 등록 해제 → 방문 유지.
paste(ctx.EVENT.visitors,2,3,[['신군','시작팀','시작순','가상하나','남',30,'19960101','01000000001']]);
assertHealthy(ctx.EVENT.visitors);
assert.equal(rows('신군').length,1);assert.equal(rows(ctx.EVENT.raw).length,1);
edit('신군',2,15,true);
assert.equal(rows(ctx.EVENT.registrations).length,1);assert.equal(rows(ctx.EVENT.visitors)[0][13],true);
edit(ctx.EVENT.registrations,2,15,false);assert.equal(rows(ctx.EVENT.registrations).length,0);assert.equal(rows(ctx.EVENT.visitors).length,1);
// 군 이동과 군 → 전체. 원래 군의 명단은 비워진다.
edit(ctx.EVENT.visitors,2,3,'조군');assert.equal(rows('신군').length,0);assert.equal(rows('조군').length,1);
paste('명군',2,6,[['가상둘','여',25,'20010101','01000000002'],['가상셋','남',27,'19990101','01000000003']]);
assertHealthy('명군');assert.equal(rows('명군').length,2);assert.equal(rows(ctx.EVENT.visitors).length,3);
// 총 등록에서 기존 사람 입력. 방문·등록 한 관리번호로 연결한다.
paste(ctx.EVENT.registrations,2,6,[['가상하나','남',30,'19960101','010-0000-0001']]);
assertHealthy(ctx.EVENT.registrations);assert.equal(rows(ctx.EVENT.raw).length,3);assert.equal(rows(ctx.EVENT.registrations).length,1);
assert.equal(rows(ctx.EVENT.visitors)[0][0],rows(ctx.EVENT.registrations)[0][0]);
// 이름만 같은 무전화 기록은 합치지 않는다. 같은 전화번호 다른 이름도 구분.
edit('기타',2,6,'가상동명');edit('기타',3,6,'가상동명');assert.equal(rows('기타').length,2);
paste('기타',4,6,[['가상가족','','','','01000000001']]);assert.equal(rows('기타').length,3);assert.match(rows('기타')[2][18],/다른 이름/);
// 다른 항목의 대기 입력은 화면 갱신 때 지켜지고, 복구 메뉴가 처리한다.
ss.sheets['조군'].getRange(2,5).setValue('대기순');edit(ctx.EVENT.visitors,2,4,'새팀');
assert.equal(rows('조군')[0][4],'대기순');ctx.eventRepair();assert.equal(rows(ctx.EVENT.visitors)[0][4],'대기순');
// 같은 항목을 동시에 다르게 고치면 기존 저장값을 보존한다.
ss.sheets['조군'].getRange(2,4).setValue('충돌팀');edit(ctx.EVENT.visitors,2,4,'먼저팀');
ctx.onEdit({source:ss,range:ss.sheets['조군'].getRange(2,4),value:'충돌팀'});
assert.match(rows('조군')[0][18],/^충돌:/);assert.equal(rows(ctx.EVENT.raw)[0][3],'먼저팀');
active=ss.sheets['조군'];ctx.eventAcceptConflict();assert.equal(rows(ctx.EVENT.raw)[0][3],'충돌팀');assert.equal(rows(ctx.EVENT.visitors)[0][3],'충돌팀');
// 범위를 벗어난 날짜는 저장하지 않는다.
edit(ctx.EVENT.visitors,2,2,'2026-10-31');assert.equal(rows(ctx.EVENT.raw)[0][1],'2026-11-01');assert.match(rows(ctx.EVENT.visitors)[0][18],/11월 1일/);
active=ss.sheets[ctx.EVENT.visitors];ctx.eventRestoreRow();assert.equal(rows(ctx.EVENT.visitors)[0][1],'2026-11-01');
// 화면 반영 중 실패해도 원본을 보존하고 메뉴에서 다시 맞춘다.
ss.failWrite={name:'신군',count:1};paste(ctx.EVENT.visitors,8,3,[['신군','','','가상복구','','','','01000000004']]);
assert.equal(rows(ctx.EVENT.raw).filter(r=>r[5]==='가상복구').length,1);ss.failWrite=null;ctx.eventRepair();
assert.equal(rows('신군').filter(r=>r[5]==='가상복구').length,1);
// 직접 삭제한 화면은 원본에서 복구된다. 취소는 원본·이력을 남기고 되돌린다.
ss.sheets['조군'].data.splice(1,1);ctx.eventRepair();assert.equal(rows('조군').length,1);
ss.sheets[ctx.EVENT.visitors].getRange(2,4).setValue('취소 전 대기팀');
active=ss.sheets['조군'];ctx.eventCancel();assert.equal(rows('조군').length,0);assert.equal(rows(ctx.EVENT.raw).filter(r=>r[21]).length,1);assert.equal(rows(ctx.EVENT.visitors).some(r=>r[0]===rows(ctx.EVENT.raw)[0][0]),false,'대기 입력이 있어도 취소된 사람은 화면에서 제외한다');
ss.failWrite={name:ctx.EVENT.raw,count:1};assert.throws(()=>ctx.eventUndoCancel(),/네트워크/);ss.failWrite=null;
ctx.eventUndoCancel();assert.equal(rows('조군').length,1);assert.equal(rows(ctx.EVENT.raw).filter(r=>r[21]).length,0);
// 잠금 대기는 입력을 지우지 않는다.
locked=true;edit('슬군',2,6,'가상대기');assert.equal(rows('슬군').length,0);assert.equal(ss.sheets['슬군'].getRange(2,6).getValues()[0][0],'가상대기');locked=false;ctx.eventRepair();assert.equal(rows('슬군').length,1);
const layout=require('../event-day-workbook/layout.cjs');const requests=layout.build([]);
assert.ok(requests.every(r=>Object.keys(r).length===1));
assert.equal(requests.filter(r=>r.addTable).length,0);
assert.equal(requests.filter(r=>r.addSheet&&r.addSheet.properties.gridProperties.frozenRowCount===1).length,15);
assert.ok(requests.filter(r=>r.addTable).every(r=>r.addTable.table.range.startRowIndex===0));
assert.equal(requests.filter(r=>r.setDataValidation).length,0,'유형 적용된 테이블 열에 별도 validation을 겹치지 않는다');
// 지연된 이벤트의 과거 e.value보다 화면의 최신 입력을 처리해야 한다.
const delayedId=rows(ctx.EVENT.raw)[0][0],delayedRow=ctx.eventFind_(ss.sheets[ctx.EVENT.visitors],delayedId)[0].row;
ss.sheets[ctx.EVENT.visitors].getRange(delayedRow,4).setValue('최신입력');
ctx.onEdit({source:ss,range:ss.sheets[ctx.EVENT.visitors].getRange(delayedRow,4),value:'이전이벤트'});
assert.equal(rows(ctx.EVENT.raw).find(r=>r[0]===delayedId)[3],'최신입력');assert.equal(rows(ctx.EVENT.visitors).find(r=>r[0]===delayedId)[3],'최신입력');
// 기존 사람과 다른 팀을 붙여넣어 충돌한 신규 행도 메뉴로 해결할 수 있다.
const conflictRow=ctx.eventData_(ss.sheets[ctx.EVENT.registrations]).length+2;
paste(ctx.EVENT.registrations,conflictRow,4,[['다른팀','','가상하나','남',30,'19960101','01000000001']]);
assert.match(ss.sheets[ctx.EVENT.registrations].getRange(conflictRow,19).getValues()[0][0],/^충돌:/);
assert.ok(ss.sheets[ctx.EVENT.registrations].getRange(conflictRow,1).getValues()[0][0]);
active=ss.sheets[ctx.EVENT.registrations];active.activeRow=conflictRow;ctx.eventRestoreRow();active.activeRow=2;
// 원래 Google 테이블은 빈 BOOLEAN 열에 false를 채운다. 첫 실제 기록은 2행에 보여야 한다.
ss.sheets['전군'].getRange(2,14,20,3).setValues(Array.from({length:20},()=>[false,false,false]));
edit('전군',2,6,'가상체크');
assert.equal(rows('전군')[0][13],true,'빈 체크박스 기본값이 방문 기본값을 해제하면 안 된다');
assert.equal(ss.sheets[ctx.EVENT.visitors].data.findIndex(r=>r?.[5]==='가상체크')<20,true);
// 이름 후 전화번호를 순서대로 적어도 기존 인물과 연결된다.
const visitorCount=rows(ctx.EVENT.raw).filter(r=>!r[21]).length;
edit(ctx.EVENT.registrations,5,6,'가상둘');edit(ctx.EVENT.registrations,5,10,'01000000002');
assert.equal(rows(ctx.EVENT.raw).filter(r=>!r[21]).length,visitorCount,'순차 입력도 같은 이름+전화번호이면 한 사람이어야 한다');
assert.equal(rows(ctx.EVENT.registrations).filter(r=>r[5]==='가상둘').length,1);
const afterMergeCount=rows(ctx.EVENT.raw).filter(r=>!r[21]).length;ctx.eventUndoCancel();assert.equal(rows(ctx.EVENT.raw).filter(r=>!r[21]).length,afterMergeCount,'동일인 연결로 폐기한 ID는 취소 복구 대상이 아니다');
// 군 이동 반영이 중단되면 원본의 현재 군을 기준으로 옛 군 화면도 제거해야 한다.
ss.failWrite={name:'임군',count:1};edit(ctx.EVENT.visitors,delayedRow,3,'임군');ss.failWrite=null;ctx.eventRepair();
assert.equal(rows('조군').filter(r=>r[0]===delayedId).length,0,'복구는 옛 군의 오래된 행도 제거해야 한다');
console.log('실제 onEdit 경계: 양방향·군 이동·여러 행·동일인·충돌 해결·실패 복구·취소 복구·잠금 대기 통과');

// Google Sheets의 문자 형식으로 남은 체크 값도 false를 취소로 오해하지 않는다.
const normalized=ss.sheets[ctx.EVENT.raw];normalized.getRange(2,14).setValue('true');normalized.getRange(2,15).setValue('false');normalized.getRange(2,22).setValue('false');
const normalizedRow=ctx.eventData_(normalized)[0];assert.equal(normalizedRow[13],true);assert.equal(normalizedRow[14],false);assert.equal(normalizedRow[21],false);

// 실제 단순 명단 열 배치를 통과한다. 등록 쪽에 이름을 적으면 방문 쪽에도 생긴다.
Range.prototype.getNote=function(){return this.sheet.notes?.[`${this.row},${this.col}`]||'';};
Range.prototype.setNote=function(v){this.sheet.notes??={};this.sheet.notes[`${this.row},${this.col}`]=v;return this;};
Range.prototype.clearNote=function(){this.sheet.notes??={};for(let i=0;i<this.nr;i++)for(let j=0;j<this.nc;j++)delete this.sheet.notes[`${this.row+i},${this.col+j}`];return this;};
Range.prototype.getNotes=function(){return Array.from({length:this.nr},(_,i)=>Array.from({length:this.nc},(_,j)=>this.sheet.notes?.[`${this.row+i},${this.col+j}`]||''));};
const plain={sheets:{},getSheetByName(n){return this.sheets[n];},getSheets(){return Object.values(this.sheets);},toast(){}};
ctx.EVENT.groups.concat([ctx.EVENT.visitors,ctx.EVENT.registrations,ctx.EVENT.raw,ctx.EVENT.log,ctx.EVENT.conflicts]).forEach(n=>plain.sheets[n]=new Sheet(plain,n));
plain.namedRanges={};plain.getRangeByName=n=>plain.namedRanges[n];plain.setNamedRange=(n,r)=>{plain.namedRanges[n]=r;};
Sheet.prototype.getParent=function(){return this.ss;};Sheet.prototype.getSheetId=function(){return this.id||310;};
ctx.EVENT.groups.forEach((g,i)=>{const s=plain.sheets[g];s.id=310+i;plain.namedRanges[`_EVENT_${s.id}_VISIT`]=s.getRange(3,1,20,12);plain.namedRanges[`_EVENT_${s.id}_REG`]=s.getRange(27,1,10,13);});
ctx.SpreadsheetApp.getActive=()=>plain;
let ps=plain.sheets['신군'];ps.getRange(27,3,1,4).setValues([['단순등록시험','여',30,'01000000008']]);ctx.onEdit({source:plain,range:ps.getRange(27,3,1,4)});
assert.equal(plain.sheets[ctx.EVENT.registrations].getRange(2,3).getValues()[0][0],'단순등록시험');
assert.equal(plain.sheets[ctx.EVENT.visitors].getRange(2,3).getValues()[0][0],'단순등록시험');
assert.equal(ps.getRange(3,3).getValues()[0][0],'단순등록시험');
assert.equal(ctx.eventData_(plain.sheets[ctx.EVENT.raw])[0][13],true);assert.equal(ctx.eventData_(plain.sheets[ctx.EVENT.raw])[0][14],true);
ps.getRange(27,3).setValue('');ctx.onEdit({source:plain,range:ps.getRange(27,3)});
assert.equal(plain.sheets[ctx.EVENT.registrations].getRange(2,3).getValues()[0][0],'');
assert.equal(plain.sheets[ctx.EVENT.visitors].getRange(2,3).getValues()[0][0],'단순등록시험');
assert.equal(ctx.eventData_(plain.sheets[ctx.EVENT.raw])[0][14],false);
const visitor=plain.sheets[ctx.EVENT.visitors];visitor.getRange(2,3).setValue('');ctx.onEdit({source:plain,range:visitor.getRange(2,3)});
assert.equal(ps.getRange(3,3).getValues()[0][0],'');
assert.ok(!fs.readFileSync(file,'utf8').includes('.createMenu('),'추가 메뉴를 만들지 않는다');
assert.ok(!layout.build().some(r=>r.addTable||r.setDataValidation),'표 버튼·체크박스·드롭다운을 만들지 않는다');
console.log('단순 명단 실제 열 배치: 군 등록 입력→전체 등록·방문, 등록 비우기→방문 유지, 방문 비우기 통과');
// 편집 이벤트가 빠진 이름 비우기도 다시 열 때 등록 해제로 처리한다.
ps.getRange(29,3,1,4).setValues([['다시열기시험','여',31,'01000000005']]);ctx.onEdit({source:plain,range:ps.getRange(29,3,1,4)});
ps.getRange(29,3).setValue('');ctx.eventRepair(true);
assert.equal(ctx.eventData_(plain.sheets[ctx.EVENT.raw]).find(r=>r[5]==='다시열기시험')[14],false,'대기 중인 이름 비우기는 다시 열 때도 처리해야 한다');

// 방문 칸이 차면 등록 구역을 유지하며 다섯 줄을 더한다.
Range.prototype.copyFormatToRange=function(){};
Sheet.prototype.insertRowsBefore=function(at,count){this.data.splice(at-1,0,...Array.from({length:count},()=>[]));for(const r of Object.values(this.ss.namedRanges||{})){if(r.sheet!==this)continue;if(r.row>=at)r.row+=count;else if(r.getLastRow()>=at)r.nr+=count;}this.max+=count;};
const wrapped=ctx.eventPlainWrap_(plain),fullMap=wrapped.getSheetByName('신군::방문');const oldRegRow=plain.getRangeByName('_EVENT_310_REG').getRow();
fullMap.insertRowsAfter(fullMap.getMaxRows(),100);
assert.equal(plain.getRangeByName('_EVENT_310_VISIT').getNumRows(),25);assert.equal(plain.getRangeByName('_EVENT_310_REG').getRow(),oldRegRow+5);
// 군별 마지막 방문 칸 다음 행에 직접 적어도 구역을 먼저 확장한다.
const beforeDirect=plain.getRangeByName('_EVENT_310_VISIT'),nextRow=beforeDirect.getLastRow()+1,regBeforeDirect=plain.getRangeByName('_EVENT_310_REG').getRow();
ps.getRange(nextRow,3,1,4).setValues([['직접초과시험','남',32,'01000000002']]);ctx.onEdit({source:plain,range:ps.getRange(nextRow,3,1,4)});
assert.equal(plain.getRangeByName('_EVENT_310_VISIT').getNumRows(),30,'마지막 칸 다음 직접 입력도 다섯 줄 늘려야 한다');
assert.equal(plain.getRangeByName('_EVENT_310_REG').getRow(),regBeforeDirect+5);
assert.ok(ctx.eventData_(plain.sheets[ctx.EVENT.raw]).some(r=>r[5]==='직접초과시험'));
// 등록 구역 마지막 다음 행에 직접 적어도 방문 자동 추가와 등록 구역 확장이 함께 된다.
const regRange=plain.getRangeByName('_EVENT_310_REG'),regNext=regRange.getLastRow()+1,oldRegSize=regRange.getNumRows();
ps.getRange(regNext,3,1,4).setValues([['등록초과시험','여',33,'01000000001']]);ctx.onEdit({source:plain,range:ps.getRange(regNext,3,1,4)});
assert.equal(plain.getRangeByName('_EVENT_310_REG').getNumRows(),oldRegSize+5);
const regOverflowRecord=ctx.eventData_(plain.sheets[ctx.EVENT.raw]).find(r=>r[5]==='등록초과시험');assert.equal(regOverflowRecord[13],true);assert.equal(regOverflowRecord[14],true);
