/**
 * 시트 메뉴 3개, 검토 필요 시트, 사용법 시트 (REQ-MENU-001~003).
 * 같은 등록 Apps Script 프로젝트의 설정·잠금·동기화 함수를 쓴다.
 * 파일 실행 순서와 상관없도록 다른 파일의 상수는 함수 안에서만 읽는다.
 */

// 메뉴와 사용법 시트가 함께 쓰는 목록이다. 메뉴를 바꾸면 사용법도 같이 바뀐다.
const REGISTRATION_MENU_ITEMS = Object.freeze([
  Object.freeze({
    label: '지금 반영하기',
    functionName: 'applyRegistrationNowMenu',
    when: '등록 명단이나 방문 명단을 입력한 뒤 월요일 정기 실행을 기다리지 않고 바로 반영할 때',
    changes: '군 현황판을 다시 만들고 방문 명단에 등록자를 추가하거나 등록여부(N열)에 O를 적습니다. 행사 집계 수식과 검토 필요 시트도 새로 씁니다. 등록 보정과 메일은 하지 않습니다.'
  }),
  Object.freeze({
    label: '미리보기·검토 목록',
    functionName: 'previewReviewListMenu',
    when: '무엇이 바뀔지, 어떤 줄을 사람이 확인해야 하는지 먼저 보고 싶을 때',
    changes: '명단·현황판·설정은 바꾸지 않고 검토 필요 시트만 새로 씁니다. 월요일 메일의 매칭 검토도 여기서 미리 볼 수 있습니다.'
  }),
  Object.freeze({
    label: '방문 관리 기간 설정',
    functionName: 'visitorPeriodSettingsMenu',
    when: '하반기 방문 관리를 끝낼 날짜를 정하거나 다시 열 때',
    changes: '날짜(YYYY-MM-DD)를 넣으면 마감일을 저장하고 "해제"를 넣으면 마감일을 지웁니다. 명단은 바꾸지 않습니다.'
  })
]);

const REGISTRATION_REVIEW_SHEET = Object.freeze({
  name: '검토 필요',
  headers: ['구분', '등록 행', '방문 행', '이름', '사유', '해결 방법', '바로가기'],
  alertLimit: 10
});

// 사유 문구의 앞부분으로 해결 방법을 찾는다. 사용법 시트의 검토 사유 표도 이 목록을 쓴다.
const REGISTRATION_REVIEW_ADVICE = Object.freeze([
  {match: '방문 명단의 이름·전화번호가 불일치', label: '방문 명단과 이름·전화번호가 다름',
    fix: '방문 행의 이름(끝 영문자·대소문자 포함)과 전화번호를 등록 명단과 똑같이 맞춥니다. 같은 사람이 방문 명단에 두 줄이면 이미 O가 있는 줄이 있는지 확인합니다.'},
  {match: '관리 기간 안 등록 명단에 같은 이름', label: '등록 명단에 같은 이름·전화번호가 여러 줄',
    fix: '같은 사람이 두 번 등록됐으면 한 줄만 남깁니다. 다른 사람이면 이름 끝에 영문 대문자를 붙여 구분합니다.'},
  {match: '이름 또는 휴대전화번호 확인 필요', label: '이름이나 휴대전화번호 없음',
    fix: '등록 명단에 이름과 010으로 시작하는 휴대전화번호를 채웁니다.'},
  {match: '등록일을', label: '등록일을 읽을 수 없음',
    fix: '등록 명단 B열에 날짜를 M/d 또는 YYYY-MM-DD로 적습니다.'},
  {match: '등록여부 셀에 수식', label: '방문 명단 등록여부에 수식',
    fix: '방문 행 N열의 수식을 지우고 O를 직접 적거나, 수식을 유지하려면 그대로 둡니다.'},
  {match: '기존 등록여부 표시를 보존함', label: '방문 명단 등록여부에 다른 표시',
    fix: '방문 행 N열의 기존 표시를 확인하고, 등록했으면 O로 바꿉니다.'},
  {match: '방문 동기화 실패', label: '방문 동기화 실패',
    fix: '하반기 방문 새가족의 1행 머리글과 Q열 군 목록·합계 행을 확인한 뒤 지금 반영하기를 다시 실행합니다.'},
  {match: '스스로 등록인데 예배 구분', label: '스스로 등록인데 예배 구분 없음',
    fix: '등록 명단 C열(예배)에 4 또는 5를 적고 지금 반영하기를 다시 실행합니다.'},
  {match: '군을 확인할 수 없어', label: '군을 알 수 없어 미배정',
    fix: '등록 명단 D열(군)에 신·조·명·총·영·석·전·슬·임 가운데 하나를 적습니다.'},
  {match: '인원 불일치', label: '현황판 인원 불일치',
    fix: '등록 명단의 날짜·이름 칸을 확인하고 지금 반영하기를 다시 실행합니다. 계속되면 담당자에게 알립니다.'},
  {match: '스스로 등록', label: '스스로 등록(군 배정 필요)',
    fix: '군을 정해 등록 명단 D열(군)에 적습니다. 정하기 전까지는 현황판 스스로 열에 표시됩니다.'},
  {match: '행사 군별 집계에서 빠진 방문 기록', label: '방문 기록의 군이 비었거나 다른 표기',
    fix: '방문 명단 D열(군)에 9개 군 가운데 하나를 적어야 행사 군별 집계에 들어갑니다.'},
  {match: '동명이인이 있어', label: '동명이인인데 교육 출석 전화번호가 다름',
    fix: '교육 출석 응답의 전화번호와 등록 명단 J열 전화번호가 같은지 확인하고 맞춥니다.'},
  {match: '전화번호는 같지만 이름이 달라', label: '전화번호는 같은데 이름이 다름',
    fix: '등록 명단과 교육 출석 응답 가운데 틀린 쪽 이름을 고칩니다.'},
  {match: '등록 명단 이름이 교육 출석 이름', label: '교육 출석 이름과 다름',
    fix: '등록 명단과 교육 출석 응답 가운데 틀린 쪽 이름을 고칩니다.'},
  {match: '이름·등록일이 없거나 같은 식별값', label: '같은 이름·등록일이 여러 줄',
    fix: '같은 사람이 두 줄이면 한 줄만 남기고, 다른 사람이면 이름 끝에 영문 대문자를 붙입니다.'},
  {match: '자동 보정 상태의 소유자 확인 필요', label: '이전 자동 보정 기록과 맞지 않음',
    fix: '이름이나 등록일을 고친 적이 있는지 확인합니다. 그대로면 담당자가 Apps Script 편집기에서 확인합니다.'},
  {match: '교육 출석 대조 실패', label: '교육 출석 시트를 읽지 못함',
    fix: '교육 출석 응답 파일의 공유 권한과 시트 이름을 확인한 뒤 다시 실행합니다.'}
].map(Object.freeze));

const REGISTRATION_DEFAULT_ADVICE = '사유를 확인하고 해당 행을 고친 뒤 미리보기·검토 목록으로 다시 확인합니다.';

function onOpen() {
  const menu = SpreadsheetApp.getUi().createMenu('⛪ 새가족 자동화 시스템');
  // 예전 메뉴 함수(군 현황판만 업데이트 등)는 편집기에서 쓸 수 있게 남겨 둔다.
  REGISTRATION_MENU_ITEMS.forEach(function (item) {
    menu.addItem(item.label, item.functionName);
  });
  menu.addToUi();
}

function ensureRegistrationActive_() {
  if (!REGISTRATION_AUTOMATION.active && REGISTRATION_AUTOMATION.mode === 'PRODUCTION') {
    throw new Error('등록 자동화가 비활성 상태입니다.');
  }
}

/** 지금 반영하기: 군 현황판과 방문 명단을 실제 반영한다. 등록 보정·메일은 하지 않는다. */
function applyRegistrationNowMenu() {
  ensureRegistrationActive_();
  const outcome = withRegistrationLock_(function () {
    const dashboard = updateNewFamilyStatus_({ dryRun: false });
    let visitors;
    let visitorError = '';
    try {
      visitors = syncRegisteredToVisited_({ dryRun: false });
    } catch (error) {
      visitorError = String(error.message || error);
      visitors = error.visitorResult || { added: 0, updated: 0, review: [] };
    }
    const result = { dashboard: dashboard, visitors: visitors, visitorError: visitorError };
    const rows = collectRegistrationReviewRows_(result, registrationSheetIds_());
    writeRegistrationReviewSheet_(rows, '지금 반영하기');
    return { result: result, rows: rows };
  });
  SpreadsheetApp.getUi().alert(registrationMenuAlertText_('지금 반영하기 완료', outcome.result, outcome.rows));
  return outcome.result;
}

/** 미리보기·검토 목록: 계산만 하고 검토 필요 시트만 다시 쓴다. */
function previewReviewListMenu() {
  const outcome = withRegistrationLock_(function () {
    let reconciliation;
    try {
      reconciliation = reconcileRegistrationWithLatestAttendance_({ dryRun: true });
    } catch (error) {
      reconciliation = { changes: [], protected: [],
        review: [{ reason: '교육 출석 대조 실패: ' + String(error.message || error) }] };
    }
    const dashboard = updateNewFamilyStatus_({ dryRun: true });
    let visitors;
    let visitorError = '';
    try {
      visitors = syncRegisteredToVisited_({ dryRun: true });
    } catch (error) {
      visitorError = String(error.message || error);
      visitors = { added: 0, updated: 0, review: [] };
    }
    const result = { reconciliation: reconciliation, dashboard: dashboard,
      visitors: visitors, visitorError: visitorError, dryRun: true };
    const rows = collectRegistrationReviewRows_(result, registrationSheetIds_());
    writeRegistrationReviewSheet_(rows, '미리보기·검토 목록');
    return { result: result, rows: rows };
  });
  SpreadsheetApp.getUi().alert(registrationMenuAlertText_('미리보기 (명단·현황판은 바꾸지 않았습니다)', outcome.result, outcome.rows));
  return outcome.result;
}

/** 방문 관리 기간 설정: 날짜를 넣으면 마감, "해제"를 넣으면 마감 해제. */
function visitorPeriodSettingsMenu() {
  const ui = SpreadsheetApp.getUi();
  const start = REGISTRATION_AUTOMATION.visitorStartDate;
  const current = PropertiesService.getScriptProperties()
    .getProperty(VISITOR_MANAGEMENT.endDateProperty) || '';
  const answer = ui.prompt('방문 관리 기간 설정',
    '현재 기간: ' + start + ' ~ ' + (current || '종료일 미정') + '\n\n' +
    '마감일을 YYYY-MM-DD로 입력하세요. 그날까지 등록한 사람을 포함합니다.\n' +
    '마감을 해제하려면 "해제"라고 입력하세요. 빈칸이면 바꾸지 않습니다.',
    ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return { cancelled: true };
  const text = answer.getResponseText().trim();
  if (!text) {
    ui.alert('바꾸지 않았습니다. 현재 기간: ' + start + ' ~ ' + (current || '종료일 미정'));
    return { unchanged: true };
  }
  if (text === '해제') {
    // prompt는 잠금 밖에서 받고, 저장할 때만 잠근다.
    withRegistrationLock_(function () {
      PropertiesService.getScriptProperties().deleteProperty(VISITOR_MANAGEMENT.endDateProperty);
    });
    ui.alert('마감을 해제했습니다. 기간: ' + start + ' ~ 종료일 미정\n기존 명단은 그대로 보관합니다.');
    return { end: '' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || visitorDateKey_(text) !== text || text < start) {
    ui.alert('바꾸지 않았습니다. 마감일은 ' + start + ' 이후의 실제 날짜를 YYYY-MM-DD로 입력하세요.');
    return { invalid: true };
  }
  withRegistrationLock_(function () {
    PropertiesService.getScriptProperties().setProperty(VISITOR_MANAGEMENT.endDateProperty, text);
  });
  ui.alert('방문 관리 마감일: ' + text + '\n기존 명단은 보관하며 이 날짜까지의 등록자만 반영합니다.');
  return { end: text };
}

function registrationSheetIds_() {
  const ss = getRegistrationSpreadsheet_();
  const id = function (name) {
    const sheet = ss.getSheetByName(name);
    return sheet ? sheet.getSheetId() : null;
  };
  return {
    registration: id(REGISTRATION_AUTOMATION.registrationSheetName),
    visitor: id(REGISTRATION_AUTOMATION.visitedSheetName)
  };
}

function reviewAdvice_(reason) {
  const text = String(reason || '');
  for (let i = 0; i < REGISTRATION_REVIEW_ADVICE.length; i++) {
    if (text.indexOf(REGISTRATION_REVIEW_ADVICE[i].match) >= 0) return REGISTRATION_REVIEW_ADVICE[i].fix;
  }
  return REGISTRATION_DEFAULT_ADVICE;
}

function reviewSheetText_(value) {
  const text = String(value === undefined || value === null ? '' : value);
  return /^[=+@]/.test(text) ? "'" + text : text;
}

function reviewLink_(gid, row, label) {
  if (gid === null || gid === undefined || !Number(row)) return '';
  return '=HYPERLINK("#gid=' + gid + '&range=A' + Number(row) + '","' + label + ' ' + Number(row) + '행")';
}

/**
 * 실행 결과를 검토 필요 시트의 행으로 바꾼다. 시트를 건드리지 않는 순수 함수다.
 * 미배정자는 군 현황판 검토에 이미 나오므로 군 배정 필요에는 스스로 등록자만 넣는다.
 */
function collectRegistrationReviewRows_(result, ids) {
  const rows = [];
  const add = function (kind, regRow, visitorRows, name, reason, link) {
    rows.push([kind, Number(regRow) || '', (visitorRows || []).join(', '),
      reviewSheetText_(name), String(reason || ''), reviewAdvice_(reason), link || '']);
  };
  ((result.reconciliation || {}).review || []).forEach(function (item) {
    add('등록 보정', item.registrationRow, [], item.name, item.reason,
      reviewLink_(ids.registration, item.registrationRow, '등록'));
  });
  const dashboard = result.dashboard || {};
  (dashboard.review || []).forEach(function (item) {
    add('군 현황판', item.row, [], item.name, item.reason, reviewLink_(ids.registration, item.row, '등록'));
  });
  (dashboard.attention || []).forEach(function (item) {
    if (item.kind !== '스스로') return;
    add('군 배정 필요', item.row, [], item.name, '스스로 등록 - 군 배정 필요',
      reviewLink_(ids.registration, item.row, '등록'));
  });
  const visitors = result.visitors || {};
  (visitors.review || []).forEach(function (item) {
    add('방문 동기화', item.registrationRow, item.visitorRows, item.name, item.reason,
      reviewLink_(ids.registration, item.registrationRow, '등록'));
  });
  if (result.visitorError) {
    add('방문 동기화', '', [], '', '방문 동기화 실패: ' + result.visitorError, '');
  }
  ((visitors.campaign || {}).unassignedRows || []).forEach(function (item) {
    add('방문 군 확인', '', [item.row], item.name,
      '행사 군별 집계에서 빠진 방문 기록: 군 ' + (item.group || '빈칸'),
      reviewLink_(ids.visitor, item.row, '방문'));
  });
  return rows;
}

function writeRegistrationReviewSheet_(rows, label) {
  const ss = getRegistrationSpreadsheet_();
  const name = REGISTRATION_REVIEW_SHEET.name;
  const width = REGISTRATION_REVIEW_SHEET.headers.length;
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name, ss.getSheets().length);
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, width).clearContent();
  sheet.getRange(1, 1, 1, width).setValues([REGISTRATION_REVIEW_SHEET.headers]).setFontWeight('bold');
  sheet.getRange(1, width + 2).setValue('마지막 갱신: ' +
    Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm') + ' · ' + label +
    ' · ' + rows.length + '건');
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, width).setValues(rows).setWrap(true).setVerticalAlignment('top');
  }
  sheet.setFrozenRows(1);
  return { written: rows.length };
}

function registrationMenuAlertText_(title, result, rows) {
  const dashboard = result.dashboard || {};
  const visitors = result.visitors || {};
  let text = title + '\n\n';
  if (result.reconciliation) {
    text += '등록 보정 예정: ' + (result.reconciliation.changes || []).length + '건\n';
  }
  text += '군 현황판: 배치 ' + (dashboard.processed || 0) + '명 (미배정 열 ' +
    (dashboard.unassigned || 0) + '명)' +
    (dashboard.verification ? ' · ' + dashboard.verification.message : '') + '\n';
  text += '방문 명단: ' + (result.visitorError
    ? '반영 실패 - ' + result.visitorError + ' (실패 전 추가 ' + (visitors.added || 0) +
      '건 / 등록 표시 ' + (visitors.updated || 0) + '건)'
    : (result.dryRun ? '반영 예정 ' : '') + '방문 추가 ' + (visitors.added || 0) +
      '건 / 등록 표시 ' + (visitors.updated || 0) + '건') + '\n';
  text += '검토 ' + rows.length + '건 → "' + REGISTRATION_REVIEW_SHEET.name + '" 시트에 정리했습니다.\n';
  rows.slice(0, REGISTRATION_REVIEW_SHEET.alertLimit).forEach(function (row) {
    const where = row[1] ? '등록 ' + row[1] + '행' : (row[2] ? '방문 ' + row[2] + '행' : '');
    text += '- [' + row[0] + '] ' + (where ? where + ' · ' : '') + row[4] + '\n';
  });
  if (rows.length > REGISTRATION_REVIEW_SHEET.alertLimit) {
    text += '... 나머지 ' + (rows.length - REGISTRATION_REVIEW_SHEET.alertLimit) + '건은 시트에서 확인하세요.\n';
  }
  return text;
}

/** 사용법 시트를 코드의 안내 목록으로 다시 만든다. 편집기에서 실행한다(메뉴에 넣지 않음). */
function rebuildUsageGuideSheet() {
  const ss = getRegistrationSpreadsheet_();
  const name = '사용법';
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name, 0);
  const rows = buildUsageGuideRows_();
  const last = sheet.getLastRow();
  if (last > 0) sheet.getRange(1, 1, last, 3).clearContent();
  sheet.getRange(1, 1, rows.length, 3).setValues(rows).setWrap(true).setVerticalAlignment('top');
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 220);
  sheet.setColumnWidth(3, 620);
  return { rows: rows.length };
}

function buildUsageGuideRows_() {
  const settings = REGISTRATION_AUTOMATION;
  const rows = [['절', '항목', '설명']];
  const section = function (title, entries) {
    entries.forEach(function (entry) { rows.push([title, entry[0], entry[1]]); });
  };
  section('이 파일 안내', [
    ['무엇을 하나', '새가족 등록 명단을 바탕으로 군 현황판, 하반기 방문 명단, 수료현황을 자동으로 맞추고 매주 결과 메일을 보냅니다.'],
    ['먼저 할 일', '명단은 직접 입력하고, 반영과 확인은 상단 "⛪ 새가족 자동화 시스템" 메뉴를 씁니다.'],
    ['이 시트', '자동으로 만든 안내입니다. 직접 고치면 다음에 다시 만들 때 지워집니다.']
  ]);
  section('탭별 역할', [
    [settings.registrationSheetName, '직접 입력합니다. 모든 자동화의 원본입니다.'],
    [settings.visitedSheetName, 'A:O는 직접 입력하고, 등록자는 자동으로 추가되거나 등록여부(N열)에 O가 적힙니다. R:T 행사 집계는 자동입니다.'],
    [settings.dashboardSheetName, '자동으로 다시 만듭니다. 직접 고치지 않습니다.'],
    [settings.completionSheetName, '매주 금요일 자동으로 갱신합니다. 문자 제외·비고 칸만 직접 씁니다.'],
    [REGISTRATION_REVIEW_SHEET.name, '메뉴를 실행할 때마다 다시 씁니다. 사람이 확인할 줄을 모아 둡니다.'],
    ['사용법', '이 안내입니다.'],
    [settings.logSheetName + ' · 수료 자동화 로그', '실행 기록입니다. 숨김 상태로 둡니다.'],
    ['상반기 결산 · 정착률 · 상반기 방문 새가족', '보관용 또는 별도 작업용 시트입니다.']
  ]);
  section('자동 실행', [
    ['매주 월요일 08~09시', '교육 출석 기준 등록 정보 보정, 군 현황판, 방문 명단 반영을 하고 관리자에게 결과 메일을 보냅니다.'],
    ['매주 금요일 11~12시', '새가족교육 수료현황을 갱신하고 주간 보고 메일을 보냅니다.'],
    ['결과 확인', '메일의 "검토 필요" 건수가 있으면 미리보기·검토 목록 메뉴로 검토 필요 시트를 새로 만들어 봅니다.']
  ]);
  section('메뉴', REGISTRATION_MENU_ITEMS.map(function (item) {
    return [item.label, '언제: ' + item.when + '\n바뀌는 것: ' + item.changes];
  }));
  section('입력 규칙', [
    ['날짜', 'M/d(예: 11/2) 또는 YYYY-MM-DD로 적습니다.'],
    ['예배', '4 또는 5를 적습니다. 군이 "스스로"·"군배정필요"이면 꼭 적어야 현황판 스스로 열에 들어갑니다.'],
    ['군', settings.groups.join('·') + ' 가운데 하나를 적습니다. 정하지 못했으면 "군배정필요"로 적습니다.'],
    ['동명이인', '이름 끝에 영문 대문자(예: 홍길동A)를 붙이고, 등록 명단과 방문 명단에 똑같이 적습니다.'],
    ['전화번호', '010으로 시작하는 휴대전화번호를 적습니다. 등록 명단과 방문 명단의 번호가 같아야 자동으로 연결됩니다.']
  ]);
  section('검토 사유와 해결 방법', REGISTRATION_REVIEW_ADVICE.map(function (item) {
    return [item.label, item.fix];
  }));
  section('휴대폰에서', [
    ['메뉴', '휴대폰 Sheets 앱에는 사용자 메뉴가 보이지 않습니다. 반영과 미리보기는 PC에서 실행합니다.'],
    ['입력', '명단 입력과 이 안내 읽기는 휴대폰에서도 할 수 있습니다.']
  ]);
  return rows;
}
