// Validates: REQ-VISITOR-001, REQ-VISITOR-002, REQ-VISITOR-003
// 실제 Apps Script 함수·메뉴·메일을 실행하고 외부 Sheets/속성/메일만 메모리로 대체한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'registration-project/등록새가족-군현황 자동 배치.gs'), 'utf8');
const visitorPath = path.join(root, 'registration-project/하반기 방문 관리.gs');
const completion = fs.readFileSync(path.join(root, 'registration-project/등록 새가족 새가족교육 수료현황 자동화.gs'), 'utf8');
const extra = fs.existsSync(visitorPath) ? fs.readFileSync(visitorPath, 'utf8') : '';
const header = ['', '날짜', '부', '군', '팀', '방문자 이름', '성별', '나이', '주소', '핸드폰', '인도자', '문화행축', '중복', '등록여부', '구분/비고'];
const regHeader = ['No.', '날짜', '예배', '군', '팀', '새신자', '성별', '생년월일', '주소', '핸드폰', '인도자', '순', '기등록', '등록경로', '비고'];
function reg(name, phone, date = '2026-10-04') {
  return [1, date, '4', '신', '시험팀', name, '여', '20000102', '시험주소', phone, '시험인도자', '', '', '관계', '등록비고'];
}
function visit(name, phone, date = '2026-10-01', status = '') {
  return [1, date, '5', '조', '기존팀', name, '여', 24, '기존주소', phone, '기존인도자', 'O', '', status, '수동비고'];
}
function sheet(rows, name) {
  const data = rows.map(r => r.slice()); const writes = [];
  const obj = { data, writes, name, getName: () => name, getSheetId: () => 1113837712,
    getLastRow: () => data.length, getMaxRows: () => 1500,
    getLastColumn: () => Math.max(...data.map(r => r.length)),
    insertRowsAfter: () => { throw Error('fixture 안에는 빈 행이 충분하다'); },
    getRange(r, c, h = 1, w = 1) {
      const values = formulas => Array.from({length: h}, (_, i) => Array.from({length: w}, (_, j) => {
        const v = data[r - 1 + i]?.[c - 1 + j] ?? '';
        const f = typeof v === 'string' && v.startsWith('=');
        return formulas ? (f ? v : '') : (f ? '' : v);
      }));
      const range = { getValues: () => values(false), getFormulas: () => values(true),
        setValues(v) { writes.push({r,c,h,w}); v.forEach((row,i) => row.forEach((x,j) => {
          data[r-1+i] ||= []; data[r-1+i][c-1+j] = x;
        })); return range; },
        setValue(v) { return range.setValues([[v]]); },
        setNumberFormat() { return range; }
      }; return range;
    }
  }; return obj;
}
function setup(regs, visitors = [], {end = '', now = '2026-10-05T03:00:00Z'} = {}) {
  const registration = sheet([regHeader, ...regs], '등록 새가족');
  const target = sheet([header, ...visitors], '하반기 방문 새가족');
  // 오른쪽 집계 때문에 마지막 사용 줄이 명단보다 길다.
  while (target.data.length < 12) target.data.push([]);
  ['신','조','명','총','석','전','영','슬','임','합계'].forEach((g,i) => {target.data[i+1][16]=g; target.data[i+1][20]=53;});
  target.data[0][17]='선방문'; target.data[0][18]='문화행축'; target.data[0][19]='행축당일방문';
  target.data[1][17] = '=COUNTIFS(D2:D,Q2)'; target.data[10][20] = '=SUM(U2:U10)';
  const props = new Map(end ? [['REGISTRATION_VISITOR_END_DATE', end]] : []);
  const sent = []; const alerts = []; let prompt = ''; let confirmed = true;
  const ui = { ButtonSet: {OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO'}, Button: {OK:'OK', CANCEL:'CANCEL', YES:'YES', NO:'NO'},
    prompt: () => ({getSelectedButton: () => confirmed ? 'OK':'CANCEL', getResponseText: () => prompt}),
    alert: (...args) => { alerts.push(args); return confirmed ? 'YES':'NO'; },
    createMenu: () => ({ addItem() { return this; }, addToUi() {} })
  };
  const store = {getProperty: k => props.get(k) || null, setProperty: (k,v) => props.set(k,v), deleteProperty: k => props.delete(k)};
  const RealDate = Date;
  class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } }
  const ss = {getSheetByName: name => name === registration.name ? registration : name === target.name ? target : null};
  const context = { console, Date: FixedDate,
    SpreadsheetApp: {openById: () => ss, getUi: () => ui},
    PropertiesService: {getScriptProperties: () => store},
    LockService: {getScriptLock: () => ({tryLock: () => true, waitLock(){}, releaseLock(){}})},
    MailApp: {sendEmail: x => sent.push(x)},
    Utilities: {formatDate(date, zone, format) {
      const p = new Intl.DateTimeFormat('en-CA', {timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(date);
      const get = type => p.find(x => x.type === type).value;
      return format === 'M/d' ? `${+get('month')}/${+get('day')}` : `${get('year')}-${get('month')}-${get('day')}`;
    }}
  };
  vm.createContext(context); vm.runInContext(source + '\n' + completion + '\n' + extra, context);
  const run = expression => vm.runInContext(expression, context);
  return {run, context, target, registration, props, sent, alerts,
    setPrompt: (text, ok = true) => {prompt=text; confirmed=ok;}};
}

// 기존 stub에서는 added=0으로 실패한다. 대상 기간과 수신자 변경 없이 실제 입력을 옮겨야 한다.
let f = setup([reg('시험가', '01011112222'), reg('기간밖', '01011113333', '2026-10-03'), reg('미래', '01011114444', '2026-10-06')]);
let result = f.run('syncRegisteredToVisited_({dryRun:false})');
assert.equal(result.added, 1, '10월 4일 등록자는 방문 명단에 추가되어야 한다');
assert.equal(f.target.data[1][5], '시험가');
assert.equal(f.target.data[1][7], 26, '생년월일 대신 등록일 기준 나이');
assert.equal(f.target.data[1][13], 'O');
assert.equal(f.target.data[1][11], '');
assert.ok(f.target.data[1][17].startsWith('='), '집계 수식이 있어야 함');
assert.equal(f.target.data[1][20],53,'기존 목표 보존');
assert.ok(f.target.writes.every(w => w.c + w.w - 1 <= 15 || (w.c === 18 && w.w === 3)));
result = f.run('syncRegisteredToVisited_({dryRun:false})');
assert.equal(result.added, 0); assert.equal(result.updated, 0, '재실행 중복 없음');

// 기존 방문 내역은 빈 등록여부만 바꾼다. 날짜와 비고·행사 표시는 보존한다.
f = setup([reg('시험가', '010-1111-2222')], [visit('시험가', '01011112222')]);
const original = f.target.data[1].slice();
result = f.run('syncRegisteredToVisited_({dryRun:false})');
assert.equal(result.added, 0); assert.equal(result.updated, 1);
const wanted = original.slice(); wanted[13] = 'O';
assert.deepEqual(f.target.data[1].slice(0,15), wanted.slice(0,15));

// 기간 경계 포함 + 마감 이후 제외 + 날짜 오류 검토 + 미리보기 무변경.
f = setup([reg('시작', '01011112222'), reg('끝', '01011113333', '2026-10-05'), reg('이후', '01011114444', '2026-10-06'), reg('오류', '01011115555', '2026-02-30')], [], {end:'2026-10-05', now:'2026-10-08T03:00:00Z'});
const snapshot = JSON.stringify(f.target.data); const propertySnapshot = JSON.stringify([...f.props]);
result = f.run('syncRegisteredToVisited_({dryRun:true})');
assert.equal(result.added, 2); assert.equal(result.review.length, 1);
assert.equal(JSON.stringify(f.target.data), snapshot); assert.equal(JSON.stringify([...f.props]), propertySnapshot); assert.equal(f.sent.length, 0);

// 중복 번호, 한쪽만 일치, 잘못된 번호, 동명이인 영문 구분자: 추측 반영 금지.
for (const [regs, visitors] of [
  [[reg('시험가','01011112222'), reg('시험가','01011112222')], []],
  [[reg('시험가','01011112222')], [visit('시험가','01011112222'), visit('시험가','01011112222')]],
  [[reg('시험가','01011112222')], [visit('다른이름','01011112222')]],
  [[reg('시험가','01011112222')], [visit('시험가','01011113333')]],
  [[reg('시험가A','01011112222')], [visit('시험가B','01011112222')]],
  [[reg('시험가','123')], []],
  [[reg('시험가','')], []],
  [[reg('','01011112222')], []],
  [[reg('시험가','01011112222')], [visit('시험가','01011112222','2026-10-01','확인중')]],
  [[reg('시험가','01011112222')], [visit('시험가','01011112222','2026-10-01','=IF(A2,"O","")')]]
]) {
  f = setup(regs, visitors); const before = JSON.stringify(f.target.data.map(r=>r.slice(0,15)));
  result = f.run('syncRegisteredToVisited_({dryRun:false})');
  assert.equal(result.added + result.updated, 0); assert.ok(result.review.length > 0);
  assert.equal(JSON.stringify(f.target.data.map(r=>r.slice(0,15))), before);
}

// 이름이 같은 서로 다른 등록 전화번호도 검토한다.
f = setup([reg('동명이인','01011112222'),reg('동명이인','01011113333')]);
result = f.run('syncRegisteredToVisited_({dryRun:false})');
assert.equal(result.added, 0); assert.equal(result.review.length, 2);

// 이름 없는 메모 줄·빈 결과 수식도 사용 줄로 보존한다.
f = setup([reg('추가','01011112222')]); f.target.data[4][14]='수동 메모'; f.target.data[5][13]='=""';
result = f.run('syncRegisteredToVisited_({dryRun:false})');
assert.equal(f.target.data[6][5], '추가'); assert.equal(f.target.data[5][13], '=""');

// 머리글이 달라지면 쓰기 전에 실패해야 한다.
f = setup([reg('시험','01011112222')]); f.target.data[0][13]='다른열';
assert.throws(() => f.run('syncRegisteredToVisited_({dryRun:false})'), /머리글/); assert.equal(f.target.writes.length, 0);

// 잘못된 속성 값을 무시하면 마감 밖 등록자가 들어가는 회귀를 잡는다.
f = setup([reg('시험','01011112222')], [], {end:'2026-02-30'});
assert.throws(() => f.run('syncRegisteredToVisited_({dryRun:false})'), /마감/);

// 메뉴를 통한 마감 지정·해제. 취소와 잘못된 입력은 속성 그대로.
f = setup([]); f.setPrompt('2026-10-05'); f.run('closeVisitorManagementMenu()');
assert.equal(f.props.get('REGISTRATION_VISITOR_END_DATE'), '2026-10-05');
f.setPrompt('2026-10-03'); f.run('closeVisitorManagementMenu()'); assert.equal(f.props.get('REGISTRATION_VISITOR_END_DATE'), '2026-10-05');
f.setPrompt('2026-02-30'); f.run('closeVisitorManagementMenu()'); assert.equal(f.props.get('REGISTRATION_VISITOR_END_DATE'), '2026-10-05');
f.setPrompt('2026-10-07',false); f.run('closeVisitorManagementMenu()'); assert.equal(f.props.get('REGISTRATION_VISITOR_END_DATE'), '2026-10-05');
f.run('reopenVisitorManagementMenu()'); assert.equal(f.props.get('REGISTRATION_VISITOR_END_DATE'), '2026-10-05');
f.setPrompt('',true); f.run('reopenVisitorManagementMenu()'); assert.equal(f.props.has('REGISTRATION_VISITOR_END_DATE'), false);

// 운영 진입점이 실제 동기화와 텍스트/HTML 메일에 연결되는지 확인한다.
f = setup([reg('<추가>','01011112222')]);
f.run(`reconcileRegistrationWithLatestAttendance_ = () => ({registrations:1,matched:0,unmatched:1,changes:[],protected:[],review:[]});
updateNewFamilyStatus_ = () => ({processed:1,outputRows:1,unassigned:0,review:[],attention:[],verification:{matched:true,message:'인원 일치',registrationPeople:1,renderedNames:1}});
writeRegistrationLog_ = () => ({logged:true});`);
result = f.run('runAllAutomationTrigger()'); assert.equal(result.visitors.added,1);
assert.equal(f.sent.length,1); assert.equal(f.sent[0].to.split(',').length,1);
assert.match(f.sent[0].subject,/방문 추가 1/); assert.match(f.sent[0].body,/하반기 방문/);
assert.match(f.sent[0].body,/<추가>/); assert.match(f.sent[0].htmlBody,/&lt;추가&gt;/);
assert.match(f.sent[0].body,/2026-10-04/); assert.match(f.sent[0].body,/종료일 미정/);
assert.equal(result.visitors.summary.records,1); assert.equal(result.visitors.summary.registered,1);
assert.equal(result.visitors.summary.unregistered,0);
f = setup([reg('메뉴','01011112222')]); result=f.run('syncRegisteredToVisitedMenu()');
assert.equal(result.added,1); assert.equal(f.sent.length,0); assert.ok(f.alerts.length);
// 행사 기준을 손으로 센 기대값: 선방문 2, 문화행축 2, 행사 당일 2. 중복은 모두 제외.
f = setup([], [visit('앞','01011112222','2026-10-04'), visit('문화','01011113333','2026-10-30'), visit('토','01011114444','2026-10-31'), visit('일','01011115555','2026-11-01'), visit('전','01011116666','2026-10-03'), visit('후','01011117777','2026-11-02'), visit('중복','01011118888','2026-10-31')], {now:'2026-11-03T03:00:00Z'});
f.target.data[3][11]=''; f.target.data[4][11]=''; f.target.data[6][11]=''; f.target.data[7][12]='O';
result=f.run('syncRegisteredToVisited_({dryRun:false})');
assert.equal(result.campaign.previsit,2); assert.equal(result.campaign.culture,2); assert.equal(result.campaign.event,2);
assert.ok(f.target.data[1][19].includes('DATE(2026,10,31)')); assert.ok(f.target.data[1][19].includes('DATE(2026,11,1)'));
assert.equal(f.target.data[10][19],'=SUM(T2:T10)'); assert.equal(f.target.data[1][20],53);
// 마감일이 행사 전이면 행사 기록은 제외한다.
f.props.set('REGISTRATION_VISITOR_END_DATE','2026-10-30'); result=f.run('syncRegisteredToVisited_({dryRun:true})');
assert.equal(result.campaign.event,0); assert.equal(result.campaign.previsit,2);
// 집계 쓰기 실패는 이미 저장한 등록자를 0건으로 숨기지 않고 다음 재시도가 안전해야 한다.
f = setup([reg('부분실패','01011112222')]);
f.run(`reconcileRegistrationWithLatestAttendance_ = () => ({registrations:1,matched:0,unmatched:1,changes:[],protected:[],review:[]});
updateNewFamilyStatus_ = () => ({processed:1,outputRows:1,review:[],attention:[],verification:{matched:true,message:'일치'}});
writeRegistrationLog_ = () => ({logged:true});`);
const baseRange=f.target.getRange;
f.target.getRange=function(r,c,h,w) { const range=baseRange(r,c,h,w); if(c===18) range.setValues=()=>{throw Error('집계 쓰기 실패');}; return range; };
assert.throws(()=>f.run('runAllAutomationTrigger()'),/방문/);
assert.equal(f.target.data[1][5],'부분실패'); assert.match(f.sent[0].subject,/방문 추가 1/);
assert.match(f.sent[0].body,/부분실패/); assert.match(f.sent[0].body,/집계 쓰기 실패/);
f.target.getRange=baseRange; result=f.run('syncRegisteredToVisited_({dryRun:false})'); assert.equal(result.added,0);

// 시트에 표시된 군 범위만 행사 합계에 넣고, 군 확인 필요 기록은 별도로 드러낸다.
f=setup([], [visit('무군','01011112222','2026-10-04'),visit('정상','01011113333','2026-10-04'),visit('   ','01011114444','2026-10-04')]);
f.target.data[1][3]=''; result=f.run('syncRegisteredToVisited_({dryRun:true})');
assert.equal(result.campaign.previsit,1); assert.equal(result.campaign.culture,1);
assert.equal(result.campaign.unassigned,1);
// Q열 군 이름을 보존하되 비교할 때 앞뒤 공백을 제거한다.
f=setup([], [visit('군공백','01011112222','2026-10-04')]); f.target.data[1][16]=' 신 ';
f.run('updateVisitorCampaignSummaryMenu()'); assert.equal(f.target.data[1][16],' 신 ');
assert.match(f.target.data[1][17],/=TRIM\(\$Q2\)/);
console.log('하반기 방문 반영·중복 보호·기간 마감·메뉴·메일 검증 통과');
