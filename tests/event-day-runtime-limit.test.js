// Validates: REQ-EVENTDAYWORKBOOK-004, REQ-EVENTDAYWORKBOOK-007
// 운영에서 반복된 실행 시간 초과(자동 확인 6분, 편집·열기 30초)를 Sheets 호출 지연 모형으로 재현한다.
'use strict';
const assert=require('node:assert/strict');const {createFixture}=require('./helpers/event-day-memory.cjs');

function seed(f,visits,regs){
  const groups=f.groups.filter(g=>g!=='기타'),counts={},registered={};
  for(let i=0;i<visits;i++){const g=groups[i%groups.length];counts[g]=(counts[g]||0)+1;const r=f.book.getRangeByName(`_EVENT_${f.sheets[g].id}_VISIT`);f.input(g,r.row+counts[g]-1,3,[['시간방문'+i,'여',30,'010'+String(20000000+i)]]);}
  for(let i=0;i<regs;i++){const g=groups[i%groups.length];registered[g]=(registered[g]||0)+1;const r=f.book.getRangeByName(`_EVENT_${f.sheets[g].id}_REG`);f.input(g,r.row+registered[g]-1,3,[['시간등록'+i,'남',31,'010'+String(30000000+i)]]);}
  for(let i=0;i<5;i++)f.repair();
  return counts;
}
// Sheets 읽기·쓰기 한 번마다 모의 시계를 진행한다.
function slow(f,ms){f.setHook(e=>{if(e.phase==='after')f.advance(ms);});}
function elapsed(f,fn){const t0=f.ctx.Date.now();fn();return f.ctx.Date.now()-t0;}
function countCalls(f,names){const proto=f.sheets['명군'].constructor.prototype,range=f.sheets['명군'].getRange(1,1).constructor.prototype,count={};
  for(const [p,name] of names){const target=p==='sheet'?proto:range,orig=target[name];target[name]=function(...a){count[name]=(count[name]||0)+1;return orig.apply(this,a);};}
  return count;}

// 1. 열기 단순 트리거는 전체 확인 대신 다음 자동 확인을 요청한다.
{
  const f=createFixture();f.input('명군',3,3,[['열기확인','여',30,'01012340000']]);f.repair();
  let repairs=0;const original=f.ctx.eventRepair;f.ctx.eventRepair=function(...a){repairs++;return original.apply(this,a);};
  const before=f.props.EVENT_SYNC_DIRTY;f.hold('busy');f.ctx.onOpen();f.release();
  assert.equal(repairs,0,'30초 한도의 열기 실행에서 전체 확인을 시작하지 않는다');
  assert.notEqual(f.props.EVENT_SYNC_DIRTY,before,'다음 자동 확인이 명단을 다시 보도록 요청한다');
  f.ctx.eventRepair=original;f.repair();assert.equal(f.props.EVENT_SYNC_DONE,f.props.EVENT_SYNC_DIRTY);
  console.log('통과: 열기 실행은 자동 확인 요청만 남김');
}

// 2. 15분 확인 실행은 이미 맞는 중복 경고 규칙과 등록경로 목록을 다시 설치하지 않는다.
{
  const f=createFixture();f.input('명군',3,3,[['규칙유지','여',30,'01012340001']]);f.input('명군',27,3,[['규칙등록','남',31,'01012340002']]);f.repair();
  const calls=countCalls(f,[['sheet','setConditionalFormatRules'],['range','setDataValidation']]);
  f.advance(16*60*1000);f.repair();
  assert.equal(calls.setConditionalFormatRules||0,0,'같은 중복 경고 규칙은 다시 쓰지 않는다');
  assert.equal(calls.setDataValidation||0,0,'같은 등록경로 목록은 다시 쓰지 않는다');
  // 규칙이 사라지거나 목록이 지워지면 확인 실행이 다시 설치한다.
  f.sheets['명군'].rules=[];const reg=f.book.getRangeByName(`_EVENT_${f.sheets['명군'].id}_REG`);delete f.sheets['명군'].validations[`${reg.row},13`];
  f.advance(16*60*1000);f.repair();
  assert.ok(calls.setConditionalFormatRules>=1,'사라진 중복 경고 규칙은 다시 설치한다');
  assert.ok(calls.setDataValidation>=1,'지워진 등록경로 목록은 다시 설치한다');
  assert.equal(f.sheets['명군'].rules.filter(r=>/EVENT_DUPLICATE_VISIT/.test(r.getBooleanCondition().getCriteriaValues()[0])).length,1);
  console.log('통과: 확인 실행의 서식 규칙·선택 목록 재설치 생략과 손상 복구');
}

// 3. Sheets 호출이 느려도 자동 확인 한 번은 6분 안에 끝나고 여러 번에 나눠 완료한다.
{
  const f=createFixture();const counts=seed(f,150,20);
  f.hold('busy');for(let i=0;i<20;i++)f.input('총 방문 새가족',2+i*7,7,'대기주소'+i);
  for(let i=0;i<4;i++)f.input('영군',3+counts['영군']+i,3,[['느린신규'+i,'남',30,'0105555000'+i]]);f.release();
  slow(f,1000);
  let runs=0,longest=0;
  while(f.props.EVENT_SYNC_DONE!==f.props.EVENT_SYNC_DIRTY&&runs<60){longest=Math.max(longest,elapsed(f,()=>f.repair()));runs++;f.advance(60000);}
  assert.ok(longest<=300000,'자동 확인 한 번이 6분 한도 전에 끝난다: '+Math.round(longest/1000)+'초');
  assert.equal(f.props.EVENT_SYNC_DONE,f.props.EVENT_SYNC_DIRTY,'나눠 처리한 자동 확인이 결국 완료된다: '+runs+'회');
  f.setHook(null);
  const active=f.raw().filter(r=>!r[21]);
  assert.equal(active.length,174);
  assert.equal(f.visible('총 방문 새가족').length,154);assert.equal(f.visible('총 등록 새가족').length,20);
  for(let i=0;i<20;i++){const row=f.sheets['총 방문 새가족'].getRange(2+i*7,1,1,29).getValues()[0];assert.equal(active.find(r=>r[0]===row[28])[10],'대기주소'+i,'느린 환경에서도 대기 주소를 저장');}
  assert.ok(f.visible('영군').filter(x=>/^느린신규/.test(x.values[2])).length===4,'느린 환경에서도 신규 입력을 저장');
  console.log('통과: 느린 Sheets에서 자동 확인 '+runs+'회 분할, 최장 '+Math.round(longest/1000)+'초');
}

// 4. 같은 명단에 대기 행이 많아도 편집 실행은 30초 안에 이번 편집을 저장하고 나머지를 자동 확인에 넘긴다.
{
  const f=createFixture();const counts=seed(f,45,5);
  f.hold('busy');for(let i=0;i<20;i++)f.input('명군',3+i%counts['명군'],7,'편집대기'+i);f.release();
  slow(f,500);
  // 이번 편집 행이 대기 행들보다 아래에 있어도 먼저 저장한다.
  const last=2+counts['명군'];const took=elapsed(f,()=>f.input('명군',last,8,'인도자확인'));
  assert.ok(took<=26000,'편집 실행이 30초 한도 전에 끝난다: '+Math.round(took/1000)+'초');
  f.setHook(null);
  const id=f.sheets['명군'].getRange(last,29).getValues()[0][0];
  assert.equal(f.raw().find(r=>r[0]===id)[11],'인도자확인','이번 편집은 바로 저장한다');
  for(let i=0;i<10&&f.props.EVENT_SYNC_DONE!==f.props.EVENT_SYNC_DIRTY;i++)f.repair();
  const expected={};for(let i=0;i<20;i++)expected[3+i%counts['명군']]='편집대기'+i;
  for(const [row,value] of Object.entries(expected)){const rid=f.sheets['명군'].getRange(Number(row),29).getValues()[0][0];assert.equal(f.raw().find(r=>r[0]===rid)[10],value,'남긴 대기 행은 자동 확인이 저장한다');}
  console.log('통과: 편집 실행 '+Math.round(took/1000)+'초, 남은 대기 행은 자동 확인에서 저장');
}
console.log('실행 시간 한도 재현 4개 시나리오 통과');
