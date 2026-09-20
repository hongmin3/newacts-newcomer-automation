const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const maintenanceSource = read('registration-project', '등록새가족-군현황 자동 배치.gs');
const completionSource = read('registration-project', '등록 새가족 새가족교육 수료현황 자동화.gs');
const settlementSource = read('registration-project', '제목 없음.gs');

const sent = [];
const context = {
  console,
  MailApp: { sendEmail: (message) => sent.push(message) },
  Utilities: {
    formatDate: (date, timeZone, format) => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: 'numeric', day: 'numeric'
      }).formatToParts(new Date(date));
      const get = (type) => parts.find((part) => part.type === type).value;
      return format === 'M/d'
        ? `${Number(get('month'))}/${Number(get('day'))}`
        : `${get('year')}-${get('month')}-${get('day')}`;
    }
  }
};
vm.createContext(context);
vm.runInContext(
  maintenanceSource + '\n' + completionSource + '\n' + settlementSource,
  context
);

const call = (expression) => vm.runInContext(expression, context);

// --- 메일 수신자 안전장치 -------------------------------------------------
// 운영 모드에서는 요청한 수신자에게 그대로 보냅니다.
call(`sendRegistrationEmail_({
  recipients: REGISTRATION_AUTOMATION.productionAdminRecipients,
  subject: '정기 실행', body: 'b'
});`);
assert.equal(sent.length, 1);
assert.equal(sent[0].to.split(',').length, 5);
assert.doesNotMatch(sent[0].subject, /^\[TEST\]/);

// run*Test 계열은 운영 모드에서도 테스트 수신자 한 명으로 고정됩니다.
call(`sendRegistrationEmail_({
  recipients: REGISTRATION_AUTOMATION.productionAdminRecipients,
  subject: '승인된 테스트', body: 'b', forceTestRecipient: true
});`);
assert.equal(sent[1].to, 'ksj747172@gmail.com');
assert.match(sent[1].subject, /^\[TEST\] /);

// 군 리더 단일 수신자에게도 같은 안전장치가 적용됩니다.
call(`sendRegistrationEmail_({
  recipients: [REGISTRATION_AUTOMATION.groupRecipients['신']],
  subject: '신군 통계', body: 'b', forceTestRecipient: true
});`);
assert.equal(sent[2].to, 'ksj747172@gmail.com');

// 테스트 함수들이 실제로 안전장치를 켜는지 소스에서 확인합니다.
assert.match(maintenanceSource, /forceTestRecipient: true/);
assert.match(completionSource, /forceTestRecipient: true/);
assert.doesNotMatch(
  completionSource,
  /label: '승인된 테스트'[\s\S]{0,80}dryRun: false/
);

// --- 'M/d' 연도 추정 ------------------------------------------------------
// 연도를 하드코딩하면 해가 바뀔 때 모든 등록일이 어긋납니다.
call('globalThis.__year = (month, date) => resolveRegistrationYear_(month, date);');
const yearOn = (year, month, forMonth) =>
  context.__year(forMonth, new Date(year, month - 1, 15));

assert.equal(yearOn(2026, 9, 12), 2025, '회기 시작 전 12월은 전년도');
assert.equal(yearOn(2026, 9, 3), 2026, '3월은 당해 연도');
assert.equal(yearOn(2026, 12, 12), 2026, '12월 실행 중의 12월은 당해 연도');
assert.equal(yearOn(2027, 6, 12), 2026, '해가 바뀌어도 같은 규칙이 적용됨');
assert.equal(yearOn(2027, 6, 3), 2027);
assert.doesNotMatch(maintenanceSource, /month === 12 \? 2025 : 2026/);

// --- 숨김 로그 시트 -------------------------------------------------------
// 로그 시트는 만들어진 뒤에도 항상 숨김 상태여야 합니다.
function createFakeSheet(name, { hidden = false } = {}) {
  return {
    name,
    hidden,
    values: [],
    getSheetId: () => name,
    getName: () => name,
    isSheetHidden() { return this.hidden; },
    hideSheet() { this.hidden = true; },
    setFrozenRows() { return this; },
    getLastRow() { return this.values.length; },
    insertRowAfter() { return this; },
    getRange() {
      const sheet = this;
      return {
        setValues(values) { sheet.values.push(...values); return this; },
        setFontWeight() { return this; },
        setNumberFormat() { return this; }
      };
    }
  };
}

function createFakeSpreadsheet(sheets) {
  return {
    sheets,
    active: sheets[0],
    getSheets() { return this.sheets; },
    getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; },
    setActiveSheet(sheet) { this.active = sheet; },
    insertSheet(name) {
      const sheet = createFakeSheet(name);
      this.sheets.push(sheet);
      this.active = sheet;
      return sheet;
    }
  };
}

call('globalThis.__hiddenLogSheet = getHiddenLogSheet_;');

const fresh = createFakeSpreadsheet([createFakeSheet('등록 새가족')]);
const created = context.__hiddenLogSheet(fresh, '자동화 로그', ['실행시각']);
assert.equal(created.isSheetHidden(), true, '새로 만든 로그 시트는 숨겨져야 합니다');
assert.notEqual(fresh.active.getName(), '자동화 로그', '활성 시트는 운영 시트로 남아야 합니다');

// 이미 있는데 보이는 상태라면 다시 숨깁니다.
const visibleLog = createFakeSheet('자동화 로그');
const existing = createFakeSpreadsheet([createFakeSheet('등록 새가족'), visibleLog]);
context.__hiddenLogSheet(existing, '자동화 로그', ['실행시각']);
assert.equal(visibleLog.isSheetHidden(), true, '보이는 기존 로그 시트도 숨겨야 합니다');

// 로그 기록이 다시 살아 있는지 확인합니다.
assert.doesNotMatch(maintenanceSource, /function writeRegistrationLog_[\s\S]{0,60}disabled: true/);
assert.doesNotMatch(completionSource, /function writeCompletionLog_[\s\S]{0,60}disabled: true/);
assert.match(maintenanceSource, /writeRegistrationLog_\('runRegistrationMaintenance', result\)/);
assert.match(completionSource, /if \(!options\.dryRun\) writeCompletionLog_\(result\)/);

// --- 등록 정보 자동 보정 상태 저장 ---------------------------------------
// 등록자 수만큼 PropertiesService를 호출하지 않아야 합니다.
assert.doesNotMatch(maintenanceSource, /properties\.getProperty\(stateKey\)/);
assert.match(maintenanceSource, /properties\.getProperties\(\)/);
assert.match(maintenanceSource, /properties\.setProperties\(pendingStates\)/);

// --- 이름은 자동 보정하지 않는다 (TEST-REG-002) ---------------------------
// Validates: REQ-REG-001
call('globalThis.__correctionKeys = (row, match) => ' +
  'registrationCorrectionFields_(row, match).map((field) => field.key);');
const correctionKeys = Array.from(context.__correctionKeys(
  { 3: '신', 4: '1팀', 9: '010-1234-5678' },
  { group: '신', team: '1팀', phone: '010-1234-5678', name: '홍길동' }
));
assert.deepEqual(correctionKeys, ['group', 'team', 'phone'],
  '자동 보정 대상은 군·팀·전화번호뿐이어야 합니다');
assert.doesNotMatch(maintenanceSource, /key: 'name'/,
  '이름을 자동 보정 항목에 넣으면 안 됩니다');
assert.match(maintenanceSource, /등록 명단 이름이 교육 출석 이름/,
  '이름이 다르면 검토 내역으로 보고해야 합니다');
// 이름이 같은 행은 검토 내역이 생기지 않아야 하므로 비교는 정규화 후에 합니다.
assert.match(
  maintenanceSource,
  /normalizeRegistrationName_\(currentName\) !==\s*\n\s*normalizeRegistrationName_\(match\.name\)/
);
// 정기 실행 메일도 테스트 수신자 한 명에게만 갑니다.
assert.match(
  maintenanceSource,
  /recipients: \[REGISTRATION_AUTOMATION\.testRecipient\]/
);

// --- 군 현황판 열 배치 (TEST-REG-003) -------------------------------------
// Validates: REQ-REG-002
call('globalThis.__place = (group, introducer, service) => ' +
  'resolveDashboardGroupColumn_(group, introducer, service);');
call('globalThis.__layout = DASHBOARD_LAYOUT;');
call('globalThis.__header = () => buildNewFamilyStatusHeader_();');

const layout = context.__layout;
const place = context.__place;

// 열 구성 자체가 겹치거나 비지 않아야 합니다.
const usedColumns = layout.groupOrder
  .map((group, index) => layout.groupStartColumn + index)
  .concat([
    layout.dateColumn, layout.selfColumns['4'], layout.selfColumns['5'],
    layout.unassignedColumn, layout.totalColumn
  ]);
assert.equal(new Set(usedColumns).size, usedColumns.length,
  '현황판 열 번호가 겹치면 안 됩니다');
assert.equal(usedColumns.length, layout.columns,
  '선언한 열 수와 실제 쓰는 열 수가 같아야 합니다');

// 군 목록은 설정 한 곳에서만 정의되고, 나머지는 거기서 파생돼야 합니다.
call('globalThis.__groups = REGISTRATION_AUTOMATION.groups;');
call('globalThis.__recipients = REGISTRATION_AUTOMATION.groupRecipients;');
assert.deepEqual(Array.from(layout.groupOrder), Array.from(context.__groups),
  '현황판 열 순서는 REGISTRATION_AUTOMATION.groups에서 와야 합니다');
assert.deepEqual(
  Object.keys(context.__recipients).slice().sort(),
  Array.from(context.__groups).sort(),
  '군 담당자 목록의 키가 군 목록과 어긋났습니다 - 회기 변경 시 함께 고쳐야 합니다'
);
assert.equal(layout.columns, context.__groups.length + 5,
  '군을 더하거나 빼면 열 수가 따라와야 합니다 (날짜+군+스스로2+미배정+합계)');
assert.doesNotMatch(
  maintenanceSource,
  /\['석', '총', '신', '슬', '명', '전', '조', '영', '임'\]/,
  '군 목록이 정규화 함수에 다시 박혀 있으면 회기 변경 때 한쪽만 바뀝니다'
);
// 군 목록에 없는 군으로 등록하면 미배정으로 떨어져야 합니다(누락되지 않습니다).
Array.from(context.__groups).forEach((group) => {
  assert.equal(place(group, '', 4).assigned, true,
    `군 목록의 군은 모두 배정돼야 합니다: ${group}`);
});

// 같은 군은 예배 구분과 무관하게 같은 열입니다 — 4부·5부로 군을 나누지 않습니다.
assert.equal(place('신', '', 4).column, place('신', '', 5).column,
  '같은 군은 4부·5부가 같은 열이어야 합니다');
assert.equal(place('임', '', 4).assigned, true,
  '임군이 4부로 등록돼도 배정돼야 합니다');
assert.equal(place('조', '', 5).assigned, true,
  '조군이 5부로 등록돼도 배정돼야 합니다');

// "스스로"만 4부·5부를 나눕니다.
assert.notEqual(place('스스로', '', 4).column, place('스스로', '', 5).column,
  '스스로는 4부와 5부가 다른 열이어야 합니다');
assert.equal(place('', '스스로', 4).column, layout.selfColumns['4']);
assert.equal(place('군배정필요', '', 5).column, layout.selfColumns['5']);

// 예배 구분을 몰라도 군을 알면 그대로 배정합니다.
const noService = place('석', '', Number(''));
assert.equal(noService.assigned, true, '군을 알면 예배 구분 없이도 배정됩니다');
assert.equal(noService.column, place('석', '', 4).column);

// 군 표기 흔들림은 첫 글자로 정규화해 살려냅니다.
assert.equal(place('신군', '', 4).column, place('신', '', 4).column);
assert.equal(place('신1팀', '', 4).column, place('신', '', 4).column);

// 확정하지 못한 값도 열을 잃지 않고 미배정 열로 갑니다.
[
  ['', '', 4],
  ['1군', '', 4],
  ['군을 잘 모르겠어요', '', 5],
  ['스스로', '', 0],
  ['', '스스로', Number('')]
].forEach((args) => {
  const placed = place(args[0], args[1], args[2]);
  assert.equal(placed.assigned, false,
    `확정 불가 입력은 검토 대상이어야 합니다: ${JSON.stringify(args)}`);
  assert.equal(placed.column, layout.unassignedColumn,
    `확정 불가 입력은 미배정 열로 가야 합니다: ${JSON.stringify(args)}`);
  assert.ok(placed.reason.length > 0, '미배정 사유가 있어야 합니다');
});

// 어떤 입력에서도 열 번호 없는 결과는 나오지 않습니다.
[undefined, null, '', ' ', 0, '스스로', '신', '없는군'].forEach((value) => {
  const placed = place(value, value, value);
  assert.ok(Number.isInteger(placed.column) && placed.column >= 0 &&
    placed.column < layout.columns,
    `열 번호가 유효 범위를 벗어났습니다: ${String(value)}`);
});

// 머리글은 열 구성 상수와 같은 자리에 놓입니다.
const header = context.__header();
assert.equal(header.length, layout.headerRows);
assert.equal(header[0].length, layout.columns);
layout.groupOrder.forEach((group, index) => {
  assert.equal(header[1][layout.groupStartColumn + index], group,
    `머리글 2행의 군 위치가 열 구성과 달라졌습니다: ${group}`);
});
assert.equal(header[1][layout.selfColumns['4']], '4부');
assert.equal(header[1][layout.selfColumns['5']], '5부');
assert.equal(header[0][layout.unassignedColumn], '미배정');
assert.equal(header[0][layout.totalColumn], '합계');

// --- 등록자 누락 없음 (TEST-REG-003) --------------------------------------
// Validates: REQ-REG-002
// 가짜 시트는 실제 Google Sheets가 **거부하는 조건**까지 흉내내야 의미가 있습니다.
// 2026-09-20: merge()를 항상 성공하는 빈 함수로 둔 탓에, 필터가 걸린 운영 시트에서
// 세로 병합이 거부되는 사고를 테스트가 통과시켰습니다.
// options.filterHeaderRow: 그 행이 필터 머리글이면 그 행을 포함한 세로 병합을 거부합니다.
function createGridSheet(name, values, options) {
  const opts = options || {};
  const grid = values.map((row) => row.slice());
  const sheet = {
    name,
    grid,
    filterHeaderRow: opts.filterHeaderRow || null,
    mergeCalls: [],
    failHeaderValues: Boolean(opts.failHeaderValues),
    maxColumns: opts.maxColumns || 20,
    getName: () => name,
    getDataRange: () => ({ getValues: () => grid.map((row) => row.slice()) }),
    getLastRow: () => grid.length,
    getMaxRows: () => Math.max(grid.length, 1),
    getMaxColumns: () => sheet.maxColumns,
    insertRowsAfter(after, count) {
      for (let i = 0; i < count; i += 1) grid.push([]);
      return sheet;
    },
    insertColumnsAfter(after, count) {
      sheet.maxColumns += count;
      return sheet;
    },
    getRange(row, column, numRows, numColumns) {
      const api = {
        setValues(block) {
          if (sheet.failHeaderValues && row === 1) {
            throw new Error('머리글 쓰기 실패(모의)');
          }
          block.forEach((line, r) => {
            const target = row - 1 + r;
            while (grid.length <= target) grid.push([]);
            line.forEach((value, c) => { grid[target][column - 1 + c] = value; });
          });
          return api;
        },
        clearContent() {
          for (let r = 0; r < numRows; r += 1) {
            const target = row - 1 + r;
            if (!grid[target]) continue;
            for (let c = 0; c < numColumns; c += 1) grid[target][column - 1 + c] = '';
          }
          return api;
        },
        setBackgrounds: () => api,
        setBackground: () => api,
        setHorizontalAlignment: () => api,
        setVerticalAlignment: () => api,
        setFontWeight: () => api,
        merge() {
          sheet.mergeCalls.push({ row, column, numRows, numColumns });
          const filterRow = sheet.filterHeaderRow;
          const coversFilterHeader = filterRow !== null &&
            row <= filterRow && row + numRows - 1 >= filterRow;
          if (numRows > 1 && coversFilterHeader) {
            // 실제 Google Sheets가 내는 메시지와 같은 문구입니다.
            throw new Error('필터 헤더 위에는 수직 병합을 만들 수 없습니다.');
          }
          return api;
        },
        breakApart: () => api
      };
      return api;
    }
  };
  return sheet;
}

// 실제 인적사항이 아닌 합성 데이터입니다.
const registrationHeader = ['번호', '등록일', '예배', '군', '팀', '이름',
  '', '', '', '전화', '소개자'];
const registrationRows = [
  ['1', '3/29', 4, '신', '가예', '가나다', '', '', '', '', ''],
  ['2', '3/29', 5, '신', '', '라마바', '', '', '', '', ''],
  ['3', '3/29', 4, '임', '', '사아자', '', '', '', '', ''],
  ['4', '3/29', 5, '조', '', '차카타', '', '', '', '', ''],
  ['5', '3/29', 4, '', '', '파하가', '', '', '', '', '스스로'],
  ['6', '3/29', 5, '군배정필요', '', '나다라', '', '', '', '', ''],
  ['7', '3/29', '', '', '', '마바사', '', '', '', '', '스스로'],
  ['8', '3/29', '', '석', '', '아자차', '', '', '', '', ''],
  ['9', '3/29', 4, '1군', '', '카타파', '', '', '', '', ''],
  ['10', '4/5', 4, '신군', '', '하가나', '', '', '', '', '']
];
const sourceSheet = createGridSheet('등록 새가족',
  [registrationHeader].concat(registrationRows));
const dashboardSheet = createGridSheet('등록 새가족 군 현황',
  [new Array(20).fill('옛머리글'), new Array(20).fill('옛머리글'),
    ['3/22'].concat(new Array(19).fill('옛값'))]);

context.SpreadsheetApp = {
  openById: () => ({
    getSheetByName: (wanted) => [sourceSheet, dashboardSheet]
      .find((sheet) => sheet.name === wanted) || null
  })
};
call('globalThis.__dashboard = (opts) => updateNewFamilyStatus_(opts);');

const dashboardResult = context.__dashboard({ dryRun: false });
assert.equal(dashboardResult.processed, registrationRows.length,
  '등록자 전원이 현황판에 배치돼야 합니다');
assert.equal(dashboardResult.unassigned, 2,
  '군을 확정할 수 없는 2명만 미배정이어야 합니다');

const written = dashboardSheet.grid.slice(layout.startRow - 1)
  .map((row) => row.map((cell) => String(cell || '')));
const placedNames = new Set();
written.forEach((row) => row.forEach((cell) => {
  if (cell) placedNames.add(cell);
}));
registrationRows.forEach((row) => {
  assert.ok(placedNames.has(row[5]),
    `현황판에서 누락된 등록자가 있습니다: ${row[5]}`);
});
assert.ok(!placedNames.has('옛값'), '이전 20열 배치의 잔여 내용이 남아 있습니다');

// 1~2행 머리글도 이전 20열 배치의 흔적이 남으면 안 됩니다.
const headerCells = dashboardSheet.grid.slice(0, layout.headerRows)
  .flatMap((row) => row.map((cell) => String(cell || '')));
assert.ok(!headerCells.includes('옛머리글'),
  '이전 배치의 머리글이 오른쪽 열에 남아 있습니다');

// 4부 "신"과 5부 "신"이 같은 열에 쌓여야 합니다.
const shinColumn = layout.groupStartColumn + layout.groupOrder.indexOf('신');
const shinNames = written.map((row) => String(row[shinColumn] || ''))
  .filter((value) => value);
assert.deepEqual(shinNames.slice().sort(), ['가나다', '라마바', '하가나'].sort(),
  '같은 군은 4부·5부 구분 없이 한 열에 모여야 합니다');

// 미배정 열에는 확정하지 못한 2명만 있습니다.
const unassignedNames = written
  .map((row) => String(row[layout.unassignedColumn] || ''))
  .filter((value) => value);
assert.deepEqual(unassignedNames.slice().sort(), ['마바사', '카타파'].sort());

// 검토 내역에도 같은 인원이 보고됩니다.
assert.equal(dashboardResult.review.length, 2);
dashboardResult.review.forEach((item) => {
  assert.match(item.reason, /미배정 열로 배치/);
});

// --- 필터가 걸린 운영 시트 (TEST-REG-005) --------------------------------
// Validates: REQ-REG-002
// 2026-09-20 운영 사고 재현: 1행에 필터가 걸린 시트에서 머리글 세로 병합이
// "필터 헤더 위에는 수직 병합을 만들 수 없습니다"로 거부되고, 그 예외가
// 명단 기록 전에 터져 머리글만 새 배치 / 데이터는 옛 배치로 남았다.
function runDashboardOnFilteredSheet(sheetOptions) {
  const src = createGridSheet('등록 새가족',
    [registrationHeader].concat(registrationRows));
  const dash = createGridSheet('등록 새가족 군 현황',
    [new Array(20).fill('옛머리글'), new Array(20).fill('옛머리글'),
      ['3/22'].concat(new Array(19).fill('옛값'))],
    Object.assign({ filterHeaderRow: 1 }, sheetOptions || {}));
  context.SpreadsheetApp = {
    openById: () => ({
      getSheetByName: (wanted) => [src, dash].find((s2) => s2.name === wanted) || null
    })
  };
  return { dash, run: () => context.__dashboard({ dryRun: false }) };
}

const filtered = runDashboardOnFilteredSheet();
const filteredResult = filtered.run();   // 예외 없이 끝나야 합니다
assert.equal(filteredResult.processed, registrationRows.length,
  '필터가 걸린 시트에서도 등록자 전원이 배치돼야 합니다');

const filteredNames = new Set();
filtered.dash.grid.slice(layout.startRow - 1).forEach((row) =>
  row.forEach((cell) => { if (cell) filteredNames.add(String(cell)); }));
registrationRows.forEach((row) => {
  assert.ok(filteredNames.has(row[5]),
    `필터가 걸린 시트에서 누락된 등록자가 있습니다: ${row[5]}`);
});
assert.ok(!filteredNames.has('옛값'), '이전 배치의 데이터가 남아 있습니다');

// 세로 병합은 아예 시도하지 않습니다 — 필터가 걸리면 항상 거부되기 때문입니다.
const verticalMerges = filtered.dash.mergeCalls.filter((call) => call.numRows > 1);
assert.equal(verticalMerges.length, 0,
  `세로 병합을 시도하면 필터가 걸린 시트에서 실패합니다: ${JSON.stringify(verticalMerges)}`);

// 병합이 없어도 모든 열에 제목이 있어야 사람이 읽을 수 있습니다.
const filteredHeader = filtered.dash.grid.slice(0, layout.headerRows)
  .map((row) => row.map((cell) => String(cell || '')));
assert.equal(filteredHeader[1][layout.dateColumn], '날짜',
  '병합을 못 하면 2행에도 제목이 있어야 합니다');
assert.equal(filteredHeader[1][layout.unassignedColumn], '미배정');
assert.equal(filteredHeader[1][layout.totalColumn], '합계');
layout.groupOrder.forEach((group, index) => {
  assert.equal(filteredHeader[1][layout.groupStartColumn + index], group);
});
assert.ok(!filteredHeader.some((row) => row.includes('옛머리글')),
  '이전 배치의 머리글이 남아 있습니다');

// 머리글 쪽이 어떤 이유로든 실패해도 명단은 이미 기록돼 있어야 합니다.
// 머리글은 꾸미기이고 명단이 본체이므로 기록 순서가 이 성질을 보장해야 합니다.
const broken = runDashboardOnFilteredSheet({ failHeaderValues: true });
assert.throws(() => broken.run(), /머리글 쓰기 실패/,
  '머리글 실패는 감추지 않고 드러나야 합니다');
const brokenNames = new Set();
broken.dash.grid.slice(layout.startRow - 1).forEach((row) =>
  row.forEach((cell) => { if (cell) brokenNames.add(String(cell)); }));
registrationRows.forEach((row) => {
  assert.ok(brokenNames.has(row[5]),
    `머리글이 실패했다고 명단이 빠지면 안 됩니다: ${row[5]}`);
});

// --- 스스로·미배정 명단 메일 (TEST-REG-004) ------------------------------
// Validates: REQ-REG-003
const attention = dashboardResult.attention;
assert.ok(Array.isArray(attention), '스스로·미배정 명단이 있어야 합니다');
const attentionNames = (kind) => Array.from(attention)
  .filter((item) => !kind || item.kind === kind)
  .map((item) => item.name)
  .sort();
assert.deepEqual(attentionNames(),
  ['파하가', '나다라', '마바사', '카타파'].sort(),
  '스스로 등록자와 미배정자가 모두 명단에 들어가야 합니다');
assert.deepEqual(attentionNames('스스로'), ['파하가', '나다라'].sort());
assert.deepEqual(attentionNames('미배정'), ['마바사', '카타파'].sort());
Array.from(attention).forEach((item) => {
  assert.ok(item.row > 1, '등록 시트 행 번호가 있어야 합니다');
  assert.ok(String(item.date).length > 0, '등록일이 있어야 합니다');
});

// 명단이 실제 메일 본문에 들어가는지 확인합니다. 집계만 되고 안 보내면 소용없습니다.
call('globalThis.__mailText = (result, label) => ' +
  'createDetailedRegistrationMaintenanceText_(result, label);');
call('globalThis.__mailHtml = (result, label) => ' +
  'createDetailedRegistrationMaintenanceHtml_(result, label);');
const mailResult = {
  dryRun: false,
  autoCorrectionEnabled: true,
  dashboard: dashboardResult,
  reconciliation: {
    registrations: 10, matched: 8, unmatched: 2,
    changes: [], protected: [], review: []
  }
};
const mailText = context.__mailText(mailResult, '정기 실행');
const mailHtml = context.__mailHtml(mailResult, '정기 실행');
assert.match(mailText, /\[스스로 등록·군 미배정 명단\]/);
assert.match(mailHtml, /스스로 등록·군 미배정 명단/);
Array.from(attention).forEach((item) => {
  assert.ok(mailText.includes(item.name),
    `메일 본문에 빠진 사람이 있습니다: ${item.name}`);
  assert.ok(mailHtml.includes(item.name),
    `HTML 메일에 빠진 사람이 있습니다: ${item.name}`);
});
// 이 메일은 테스트 수신자 한 명에게만 갑니다(주소 자체는 위 수신자 안전장치 검사에서 고정).
assert.match(
  maintenanceSource,
  /recipients: \[REGISTRATION_AUTOMATION\.testRecipient\]/,
  '정기 실행 메일은 테스트 수신자 한 명에게만 가야 합니다'
);

// --- 상반기 결산 (TEST-SETTLE-001) ---------------------------------------
// Validates: REQ-SETTLE-001
call('globalThis.__settleDate = (value) => normalizeSettlementDate_(value);');
call('globalThis.__beforeCampaign = (value) => isBeforeCampaignStart_(value);');
assert.equal(context.__settleDate('5/12'), '5/12');
assert.equal(context.__settleDate('2026-05-12'), '5/12');
assert.equal(context.__settleDate(''), '');
assert.equal(context.__beforeCampaign('3/7'), true, '3/8 이전은 행축 대상이 아닙니다');
assert.equal(context.__beforeCampaign('3/8'), false, '3/8부터 행축 대상입니다');
assert.equal(context.__beforeCampaign('5/12'), false);
assert.equal(context.__beforeCampaign('12/25'), true, '12월은 행축 대상이 아닙니다');
assert.equal(context.__beforeCampaign(''), true);
// 목표값 열(4번째·7번째 열)은 다시 계산해도 덮어쓰지 않습니다.
assert.doesNotMatch(settlementSource, /settlement\[row\]\[3\] = /);
assert.doesNotMatch(settlementSource, /settlement\[row\]\[6\] = /);
assert.match(settlementSource, /settlement\[11\]\[column\] = total/);
assert.match(settlementSource, /setNumberFormat\('0\.00%'\)/);
assert.match(settlementSource, /review\.push\(\{/);

console.log('registration automation checks passed');
