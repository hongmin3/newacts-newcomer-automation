// Validates: REQ-MENU-001, REQ-MENU-002, REQ-MENU-003
// 실제 등록 프로젝트 파일을 읽어 메뉴·검토 필요 시트·사용법 시트를 메모리 시트로 실행한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'registration-project');
const files = ['등록새가족-군현황 자동 배치.gs', '등록 새가족 새가족교육 수료현황 자동화.gs',
  '하반기 방문 관리.gs', '메뉴·검토·사용법.gs'];
const sources = files.map(name => fs.readFileSync(path.join(dir, name), 'utf8'));

const visitHeader = ['', '날짜', '부', '군', '팀', '방문자 이름', '성별', '나이', '주소', '핸드폰', '인도자', '문화행축', '중복', '등록여부', '구분/비고'];
const regHeader = ['No.', '날짜', '예배', '군', '팀', '새신자', '성별', '생년월일', '주소', '핸드폰', '인도자', '순', '기등록', '등록경로', '비고'];
const reg = (name, phone, date = '2026-10-04') => [1, date, '4', '신', '팀', name, '여', '20000102', '주소', phone, '인도자', '', '', '관계', ''];
const visit = (name, phone, date = '2026-10-04', group = '조') => [1, date, '5', group, '팀', name, '여', 24, '주소', phone, '인도자', '', '', '', ''];

function memorySheet(name, id, rows = []) {
  const data = rows.map(r => r.slice()); const writes = [];
  const sheet = {
    data, writes, name, getName: () => name, getSheetId: () => id,
    getLastRow: () => { for (let i = data.length - 1; i >= 0; i--) if ((data[i] || []).some(v => v !== '' && v !== undefined && v !== null)) return i + 1; return 0; },
    getMaxRows: () => Math.max(data.length, 200), getMaxColumns: () => 26,
    getLastColumn: () => Math.max(1, ...data.map(r => (r || []).length)),
    insertRowsAfter() {}, setFrozenRows() {}, setColumnWidth() {}, setColumnWidths() {},
    getRange(r, c, h = 1, w = 1) {
      const cells = formulas => Array.from({length: h}, (_, i) => Array.from({length: w}, (_, j) => {
        const v = (data[r - 1 + i] || [])[c - 1 + j]; const value = v === undefined ? '' : v;
        const isFormula = typeof value === 'string' && value.startsWith('=');
        return formulas ? (isFormula ? value : '') : (isFormula ? '' : value);
      }));
      const range = {
        getValues: () => cells(false), getFormulas: () => cells(true),
        setValues(values) { writes.push({r, c, h: values.length, w: values[0].length});
          values.forEach((row, i) => row.forEach((v, j) => { data[r - 1 + i] = data[r - 1 + i] || []; data[r - 1 + i][c - 1 + j] = v; })); return range; },
        setValue(v) { return range.setValues([[v]]); },
        clearContent() { writes.push({r, c, h, w, clear: true});
          for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) if (data[r - 1 + i]) data[r - 1 + i][c - 1 + j] = ''; return range; },
        setNumberFormat: () => range, setFontWeight: () => range, setBackground: () => range,
        setWrap: () => range, setVerticalAlignment: () => range, setHorizontalAlignment: () => range
      };
      return range;
    }
  };
  return sheet;
}

function setup({regs = [], visitors = [], end = '', prompt = '', ok = true} = {}) {
  const registration = memorySheet('등록 새가족', 0, [regHeader, ...regs]);
  const target = memorySheet('하반기 방문 새가족', 1113837712, [visitHeader, ...visitors]);
  while (target.data.length < 12) target.data.push([]);
  ['신', '조', '명', '총', '영', '석', '전', '슬', '임', '합계'].forEach((g, i) => { target.data[i + 1][16] = g; target.data[i + 1][20] = 10; });
  target.data[0][17] = '선방문'; target.data[0][18] = '문화행축'; target.data[0][19] = '행축당일방문';
  const sheets = [registration, target]; let nextId = 500;
  const ss = {
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    getSheets: () => sheets.slice(),
    insertSheet(n, index) { const s = memorySheet(n, nextId++); sheets.splice(index === undefined ? sheets.length : index, 0, s); return s; }
  };
  const props = new Map(end ? [['REGISTRATION_VISITOR_END_DATE', end]] : []);
  const alerts = []; const menu = []; const sent = [];
  const ui = {
    ButtonSet: {OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO'}, Button: {OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO'},
    prompt: (...args) => { alerts.push(args); return {getSelectedButton: () => ok ? 'OK' : 'CANCEL', getResponseText: () => prompt}; },
    alert: (...args) => { alerts.push(args); return 'YES'; },
    createMenu: title => { menu.push({title}); const m = {addItem(label, fn) { menu.push({label, fn}); return m; }, addSeparator() { return m; }, addToUi() {}}; return m; }
  };
  const store = {getProperty: k => props.get(k) || null, setProperty: (k, v) => props.set(k, v), deleteProperty: k => props.delete(k)};
  const RealDate = Date;
  class FixedDate extends RealDate { constructor(...a) { super(...(a.length ? a : ['2026-11-02T03:00:00Z'])); } static now() { return new RealDate('2026-11-02T03:00:00Z').getTime(); } }
  const context = {
    console: {log() {}}, Date: FixedDate,
    SpreadsheetApp: {openById: () => ss, getActiveSpreadsheet: () => ss, getUi: () => ui, flush() {}},
    PropertiesService: {getScriptProperties: () => store},
    LockService: {getScriptLock: () => ({tryLock: () => true, releaseLock() {}})},
    MailApp: {sendEmail: x => sent.push(x)},
    Utilities: {formatDate(date, zone, format) {
      const p = new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(date);
      const g = t => p.find(x => x.type === t).value;
      if (format === 'M/d') return `${+g('month')}/${+g('day')}`;
      if (format === 'yyyy-MM-dd HH:mm') return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
      return `${g('year')}-${g('month')}-${g('day')}`;
    }}
  };
  vm.createContext(context);
  vm.runInContext(sources.join('\n'), context);
  const run = code => vm.runInContext(code, context);
  // 군 현황판과 교육 출석 대조는 다른 테스트가 검증한다. 여기서는 고정 결과로 대신한다.
  run(`updateNewFamilyStatus_ = function (o) { dashboardCalls.push(o.dryRun); return {processed: 3, unassigned: 1, outputRows: 2,
    review: [{row: 7, name: '미배정자', reason: '스스로 등록인데 예배 구분(4/5)이 없어 미배정 열로 배치: 빈값'}],
    attention: [{kind: '스스로', row: 8, name: '스스로자'}, {kind: '미배정', row: 7, name: '미배정자'}],
    verification: {matched: true, message: '인원 일치'}}; };
    reconcileRegistrationWithLatestAttendance_ = function (o) { reconcileCalls.push(o.dryRun); return {registrations: 1, matched: 0, unmatched: 1,
      changes: [], protected: [], review: [{registrationRow: 9, name: '보정자', reason: '전화번호는 같지만 이름이 달라 자동 수정하지 않음: 다른이름'}]}; };`
    .replace(/dashboardCalls/g, 'globalThis.__dash').replace(/reconcileCalls/g, 'globalThis.__rec'));
  context.__dash = []; context.__rec = [];
  return {run, context, ss, registration, target, props, alerts, menu, sent, sheets};
}
const sheetRows = s => s.data.slice(1).filter(r => r && r.slice(0, 7).some(v => v !== '' && v !== undefined));
const snapshot = s => JSON.stringify(s.data.map(r => (r || []).slice(0, 21)));

// REQ-MENU-001: 메뉴는 세 항목이고 모두 실제 함수에 연결된다.
let f = setup();
f.run('onOpen()');
const items = f.menu.filter(x => x.label);
assert.equal(f.menu[0].title, '⛪ 새가족 자동화 시스템');
assert.deepEqual(items.map(x => x.label), ['지금 반영하기', '미리보기·검토 목록', '방문 관리 기간 설정']);
items.forEach(x => assert.equal(f.run(`typeof ${x.fn}`), 'function', x.fn));
['updateNewFamilyStatusMenu', 'syncRegisteredToVisitedMenu', 'updateVisitorCampaignSummaryMenu',
  'visitorManagementStatusMenu', 'closeVisitorManagementMenu', 'reopenVisitorManagementMenu']
  .forEach(fn => assert.equal(f.run(`typeof ${fn}`), 'function', '편집기용 함수는 남긴다: ' + fn));

// REQ-MENU-001/002: 미리보기는 원본을 바꾸지 않고 검토 필요 시트만 쓴다.
f = setup({regs: [reg('새등록', '01011112222'), reg('불일치', '01033334444')],
  visitors: [visit('불일치', '01099998888'), visit('군없음', '01055556666', '2026-10-11', '')]});
let regBefore = snapshot(f.registration), visBefore = snapshot(f.target), propsBefore = JSON.stringify([...f.props]);
f.run('previewReviewListMenu()');
assert.equal(snapshot(f.registration), regBefore); assert.equal(snapshot(f.target), visBefore);
assert.equal(JSON.stringify([...f.props]), propsBefore); assert.equal(f.sent.length, 0);
assert.deepEqual(f.context.__dash, [true]); assert.deepEqual(f.context.__rec, [true]);
let review = f.ss.getSheetByName('검토 필요');
assert.ok(review, '검토 필요 시트를 만든다');
assert.equal(f.sheets[f.sheets.length - 1], review, '맨 뒤에 만든다');
assert.deepEqual(review.data[0].slice(0, 7), ['구분', '등록 행', '방문 행', '이름', '사유', '해결 방법', '바로가기']);
assert.match(String(review.data[0][8]), /미리보기·검토 목록/);
let rows = sheetRows(review);
const kinds = rows.map(r => r[0]);
['등록 보정', '군 현황판', '군 배정 필요', '방문 동기화', '방문 군 확인'].forEach(k => assert.ok(kinds.includes(k), k));
assert.ok(!rows.some(r => r[0] === '군 배정 필요' && r[1] === 7), '미배정자는 군 현황판 검토와 겹쳐 적지 않는다');
const visitorRow = rows.find(r => r[0] === '방문 동기화');
assert.equal(visitorRow[1], 3); assert.equal(String(visitorRow[2]), '2', '이름이 걸린 방문 명단 행');
assert.match(visitorRow[5], /전화번호/); assert.doesNotMatch(visitorRow[5], /^사유를 확인/);
const groupRow = rows.find(r => r[0] === '방문 군 확인');
assert.equal(groupRow[1], ''); assert.equal(String(groupRow[2]), '3');
assert.match(groupRow[6], /^=HYPERLINK\("#gid=1113837712&range=A3"/);
assert.match(rows.find(r => r[0] === '등록 보정')[6], /^=HYPERLINK\("#gid=0&range=A9"/);
rows.forEach(r => assert.ok(r[5], '모든 행에 해결 방법'));
assert.ok(f.alerts.some(a => /검토 \d+건/.test(a.join(' '))), '결과창에 검토 건수');

// 다시 실행하면 이전 행을 지우고 새로 쓴다(남은 줄 없음).
review.data[40] = ['낡은 행', 1, '', '', '', '', ''];
f.run('previewReviewListMenu()');
assert.equal(sheetRows(review).length, rows.length, '이전 검토 줄을 남기지 않는다');

// 이름이 수식처럼 시작하면 글자로 적는다.
f = setup({regs: [reg('+위험', '')]});
f.run('previewReviewListMenu()');
assert.ok(sheetRows(f.ss.getSheetByName('검토 필요')).some(r => r[3] === "'+위험"));

// REQ-MENU-001: 지금 반영하기는 현황판·방문 명단을 실제 반영하고 등록 보정·메일은 하지 않는다.
f = setup({regs: [reg('새등록', '01011112222')]});
f.run('applyRegistrationNowMenu()');
assert.deepEqual(f.context.__dash, [false]); assert.deepEqual(f.context.__rec, [], '등록 보정은 하지 않는다');
assert.equal(f.sent.length, 0);
assert.equal(f.target.data[1][5], '새등록', '방문 명단에 추가');
assert.match(String(f.ss.getSheetByName('검토 필요').data[0][8]), /지금 반영하기/);
const nowAlert = f.alerts[f.alerts.length - 1].join(' ');
assert.match(nowAlert, /방문 추가 1건/); assert.match(nowAlert, /검토 필요/);

// 방문 반영이 실패해도 현황판 결과는 두고 실패를 검토 행과 결과창에 남긴다.
f = setup({regs: [reg('새등록', '01011112222')]}); f.target.data[0][13] = '다른열';
assert.doesNotThrow(() => f.run('applyRegistrationNowMenu()'));
assert.deepEqual(f.context.__dash, [false]);
rows = sheetRows(f.ss.getSheetByName('검토 필요'));
assert.ok(rows.some(r => r[0] === '방문 동기화' && /방문 동기화 실패/.test(r[4])));
assert.match(f.alerts[f.alerts.length - 1].join(' '), /실패/);

// REQ-MENU-001: 기간 설정은 날짜와 '해제'만 반영한다.
for (const [input, okButton, start, expected] of [
  ['2026-11-30', true, '', '2026-11-30'], ['해제', true, '2026-11-30', null], ['', true, '2026-11-30', '2026-11-30'],
  ['2026-11-30', false, '', null], ['2026-02-30', true, '', null], ['2026-10-03', true, '', null]
]) {
  f = setup({end: start, prompt: input, ok: okButton});
  f.run('visitorPeriodSettingsMenu()');
  assert.equal(f.props.get('REGISTRATION_VISITOR_END_DATE') || null, expected, `${input}/${okButton}`);
  assert.match(f.alerts[0].join(' '), /2026-10-04/, '시작일을 보여 준다');
}

// REQ-MENU-003: 사용법 시트는 맨 앞에 만들고 메뉴·검토 사유 목록을 그대로 쓴다.
f = setup(); const before = f.sheets.map(s => snapshot(s));
f.run('rebuildUsageGuideSheet()');
const guide = f.ss.getSheetByName('사용법');
assert.equal(f.sheets[0], guide);
assert.deepEqual(f.sheets.slice(1).map(s => snapshot(s)), before, '다른 시트는 바꾸지 않는다');
const sections = []; guide.data.forEach(r => { if (r && r[0] && !sections.includes(r[0])) sections.push(r[0]); });
assert.deepEqual(sections.slice(1), ['이 파일 안내', '탭별 역할', '자동 실행', '메뉴', '입력 규칙', '검토 사유와 해결 방법', '휴대폰에서']);
const text = JSON.stringify(guide.data);
f.run('REGISTRATION_MENU_ITEMS').forEach(item => assert.ok(text.includes(item.label)));
f.run('REGISTRATION_REVIEW_ADVICE').forEach(item => assert.ok(text.includes(item.fix)));
guide.data.push(['낡은 절', '', '']); f.run('rebuildUsageGuideSheet()');
assert.ok(!JSON.stringify(guide.data).includes('낡은 절'), '다시 만들면 이전 내용을 지운다');
assert.equal(f.sheets.filter(s => s.name === '사용법').length, 1);

console.log('메뉴 3개·검토 필요 시트·사용법 시트 검증 통과');
