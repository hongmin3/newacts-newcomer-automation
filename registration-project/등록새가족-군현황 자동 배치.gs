/**
 * 등록/군 현황/방문자 자동화 - 안전한 배치 처리 버전
 */
const REGISTRATION_AUTOMATION = Object.freeze({
  active: true,
  mode: 'PRODUCTION',
  testRecipient: 'ksj747172@gmail.com',
  productionAdminRecipients: [
    'ksj747172@gmail.com',
    'rayo072@naver.com',
    'rnrnwkddn@naver.com',
    'wnehdrms123@naver.com',
    'whduswn94@naver.com'
  ],
  groupRecipients: {
    '신': 'smk941129@gmail.com',
    '조': 'kmc7758@naver.com',
    '총': 'eomchong@icloud.com',
    '석': 'hwoneeeeee@gmail.com',
    '전': 'jbr0196@naver.com',
    '명': 'jun607@naver.com',
    '임': 'dkssud2521@naver.com',
    '슬': 'l__seul@naver.com',
    '영': 'revlee0956@gmail.com'
  },
  registrationSpreadsheetId: '1dBO4rhCCadxO-KVBX_Jmg4aDcV9zim_sqM95JKd4Snk',
  educationSpreadsheetId: '1EEIAL39SgRtO1JTe8zpZ4qDMCf_qF-bfrtxn6jfpLgg',
  registrationSheetName: '등록 새가족',
  dashboardSheetName: '등록 새가족 군 현황',
  visitedSheetName: '상반기 방문 새가족',
  completionSheetName: '새가족교육 수료현황',
  educationSheetName: '교육 출석 현황',
  logSheetName: '자동화 로그',
  visitorStartDate: '2026-03-29'
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⛪ 새가족 자동화 시스템')
    .addItem('변경 예정 미리보기', 'previewRegistrationMaintenance')
    .addItem('승인된 테스트 실행', 'runRegistrationMaintenanceTest')
    .addSeparator()
    .addItem('군 현황판만 업데이트', 'updateNewFamilyStatusMenu')
    .addItem('방문자 명단만 동기화', 'syncRegisteredToVisitedMenu')
    .addToUi();
}
function runRegistrationMaintenanceTrigger() {
  if (!REGISTRATION_AUTOMATION.active) {
    console.log('등록 자동화가 비활성 상태라 실행하지 않았습니다.');
    return;
  }
  return withRegistrationLock_(function () {
    return runRegistrationMaintenance_({
      dryRun: false,
      sendEmail: true,
      label: '정기 실행'
    });
  });
}

/**
 * 기존 설치형 트리거 함수명 호환용.
 */
function runAllAutomationTrigger() {
  return runRegistrationMaintenanceTrigger();
}

function previewRegistrationMaintenance() {
  return withRegistrationLock_(function () {
    const result = runRegistrationMaintenance_({
      dryRun: true,
      sendEmail: false,
      label: '미리보기'
    });
    console.log(JSON.stringify(result));
    return result;
  });
}

/**
 * 사용자 승인 후에만 실행합니다. 메일은 테스트 수신자 한 명에게만 갑니다.
 */
function runRegistrationMaintenanceTest() {
  return withRegistrationLock_(function () {
    return runRegistrationMaintenance_({
      dryRun: false,
      sendEmail: true,
      label: '승인된 테스트'
    });
  });
}

function runRegistrationMaintenance_(options) {
  const dashboard = updateNewFamilyStatus_({ dryRun: options.dryRun });
  const visitors = syncRegisteredToVisited_({ dryRun: options.dryRun });
  const result = {
    dryRun: Boolean(options.dryRun),
    dashboard: dashboard,
    visitors: visitors
  };

  if (!options.dryRun) {
    writeRegistrationLog_('runRegistrationMaintenance', result);
  }
  if (options.sendEmail) {
    sendRegistrationEmail_({
      recipients: REGISTRATION_AUTOMATION.productionAdminRecipients,
      subject: '[새가족 자동화] ' + options.label + ' 결과',
      body: createRegistrationMaintenanceText_(result)
    });
  }
  return result;
}

function updateNewFamilyStatusMenu() {
  if (!REGISTRATION_AUTOMATION.active &&
      REGISTRATION_AUTOMATION.mode === 'PRODUCTION') {
    throw new Error('등록 자동화가 비활성 상태입니다.');
  }
  const result = withRegistrationLock_(function () {
    return updateNewFamilyStatus_({ dryRun: false });
  });
  SpreadsheetApp.getUi().alert(
    '군 현황판 업데이트 완료\n처리: ' + result.processed +
    '명\n검토 필요: ' + result.review.length + '건'
  );
  return result;
}

function syncRegisteredToVisitedMenu() {
  if (!REGISTRATION_AUTOMATION.active &&
      REGISTRATION_AUTOMATION.mode === 'PRODUCTION') {
    throw new Error('등록 자동화가 비활성 상태입니다.');
  }
  const result = withRegistrationLock_(function () {
    return syncRegisteredToVisited_({ dryRun: false });
  });
  SpreadsheetApp.getUi().alert(
    '방문자 동기화 완료\n추가: ' + result.added +
    '명\n등록 표시: ' + result.updated +
    '건\n검토 필요: ' + result.review.length + '건'
  );
  return result;
}

function updateNewFamilyStatus_(options) {
  const ss = getRegistrationSpreadsheet_();
  const sourceSheet = ss.getSheetByName(
    REGISTRATION_AUTOMATION.registrationSheetName
  );
  const targetSheet = ss.getSheetByName(
    REGISTRATION_AUTOMATION.dashboardSheetName
  );
  if (!sourceSheet || !targetSheet) {
    throw new Error('등록 새가족 또는 군 현황 시트를 찾을 수 없습니다.');
  }

  const data = sourceSheet.getDataRange().getValues().slice(1);
  const groups4 = {
    '신': 1, '조': 2, '명': 3, '총': 4, '영': 5,
    '석': 6, '전': 7, '슬': 8, '스스로': 9
  };
  const groups5 = {
    '명': 10, '총': 11, '영': 12, '석': 13,
    '임': 14, '전': 15, '슬': 16, '스스로': 17
  };

  const grouped = new Map();
  const review = [];
  let processed = 0;

  data.forEach(function (row, index) {
    const date = parseRegistrationDate_(row[1]);
    const service = Number(row[2]);
    let group = String(row[3] || '').trim();
    const name = String(row[5] || '').trim();
    const introducer = String(row[10] || '').trim();

    if (!date || !name) return;
    if (![4, 5].includes(service)) {
      review.push({
        row: index + 2,
        name: name,
        reason: '예배 구분이 4/5가 아님'
      });
      return;
    }

    if (group === '군배정필요' || (!group && introducer === '스스로')) {
      group = '스스로';
    }

    const columnMap = service === 4 ? groups4 : groups5;
    if (!columnMap[group]) {
      review.push({
        row: index + 2,
        name: name,
        reason: '현황판에 매핑되지 않은 군: ' + (group || '빈값')
      });
      return;
    }

    const key = Utilities.formatDate(date, 'Asia/Seoul', 'yyyy-MM-dd');
    if (!grouped.has(key)) {
      grouped.set(key, {
        date: date,
        display: Utilities.formatDate(date, 'Asia/Seoul', 'M/d'),
        services: { 4: {}, 5: {} }
      });
    }
    const serviceGroups = grouped.get(key).services[service];
    if (!serviceGroups[group]) serviceGroups[group] = [];
    serviceGroups[group].push(name);
    processed += 1;
  });

  const days = Array.from(grouped.values()).sort(function (a, b) {
    return a.date.getTime() - b.date.getTime();
  });
  const output = [];
  const backgrounds = [];

  days.forEach(function (day, dayIndex) {
    let rowsForDay = 1;
    [4, 5].forEach(function (service) {
      Object.keys(day.services[service]).forEach(function (group) {
        rowsForDay = Math.max(
          rowsForDay,
          day.services[service][group].length
        );
      });
    });

    const color = dayIndex % 2 === 0 ? '#FFF2CC' : '#FFFFFF';
    const start = output.length;
    for (let offset = 0; offset < rowsForDay; offset++) {
      output.push(new Array(20).fill(''));
      backgrounds.push(new Array(20).fill(color));
    }

    output[start][0] = day.display;
    let dayTotal = 0;

    [4, 5].forEach(function (service) {
      const map = service === 4 ? groups4 : groups5;
      Object.keys(day.services[service]).forEach(function (group) {
        const names = day.services[service][group].slice().sort();
        dayTotal += names.length;
        names.forEach(function (name, offset) {
          output[start + offset][map[group]] = name;
        });
      });
    });
    output[start][18] = dayTotal;
  });

  if (!options.dryRun) {
    const startRow = 3;
    const oldRows = Math.max(targetSheet.getLastRow() - startRow + 1, 0);
    if (oldRows > 0) {
      targetSheet.getRange(startRow, 1, oldRows, 20).clearContent();
    }
    ensureRegistrationRows_(targetSheet, startRow + output.length - 1);
    if (output.length > 0) {
      targetSheet.getRange(startRow, 1, output.length, 20)
        .setValues(output)
        .setBackgrounds(backgrounds)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
    }
  }

  return {
    processed: processed,
    outputRows: output.length,
    review: review
  };
}

function syncRegisteredToVisited_(options) {
  const ss = getRegistrationSpreadsheet_();
  const registrationSheet = ss.getSheetByName(
    REGISTRATION_AUTOMATION.registrationSheetName
  );
  const visitedSheet = ss.getSheetByName(
    REGISTRATION_AUTOMATION.visitedSheetName
  );
  if (!registrationSheet || !visitedSheet) {
    throw new Error('등록 새가족 또는 방문자 시트를 찾을 수 없습니다.');
  }

  const registrationRows = registrationSheet.getLastRow() > 1
    ? registrationSheet
      .getRange(2, 1, registrationSheet.getLastRow() - 1, 11)
      .getValues()
    : [];
  const visitedRows = visitedSheet.getLastRow() > 1
    ? visitedSheet
      .getRange(2, 1, visitedSheet.getLastRow() - 1, 14)
      .getValues()
    : [];

  const phoneIndex = new Map();
  let maxNo = 0;

  visitedRows.forEach(function (row, index) {
    const no = Number(row[0]);
    if (Number.isFinite(no)) maxNo = Math.max(maxNo, no);
    addRegistrationIndex_(phoneIndex, normalizeRegistrationPhone_(row[9]), index);
  });

  const cutoff = new Date(
    REGISTRATION_AUTOMATION.visitorStartDate + 'T00:00:00+09:00'
  );
  const rowsToMark = [];
  const newRows = [];
  const review = [];

  registrationRows.forEach(function (row, index) {
    const registrationDate = parseRegistrationDate_(row[1]);
    const name = String(row[5] || '').trim();
    const phoneKey = normalizeRegistrationPhone_(row[9]);
    if (!registrationDate || registrationDate < cutoff || !name) return;

    if (!phoneKey) {
      review.push({
        row: index + 2,
        name: name,
        reason: '전화번호가 없어 방문자 자동 매칭 제외'
      });
      return;
    }

    const matches = phoneIndex.get(phoneKey) || [];
    if (matches.length > 1) {
      review.push({
        row: index + 2,
        name: name,
        reason: '방문자 시트에 같은 전화번호가 여러 행 존재'
      });
      return;
    }

    if (matches.length === 1) {
      const visitIndex = matches[0];
      if (String(visitedRows[visitIndex][13] || '').trim().toUpperCase() !== 'O') {
        rowsToMark.push(visitIndex + 2);
      }
      return;
    }

    maxNo += 1;
    const newRow = new Array(14).fill('');
    newRow[0] = maxNo;
    for (let column = 1; column <= 10; column++) {
      newRow[column] = row[column];
    }
    newRow[13] = 'O';
    newRows.push(newRow);
    phoneIndex.set(phoneKey, [visitedRows.length + newRows.length - 1]);
  });

  if (!options.dryRun) {
    if (rowsToMark.length) {
      visitedSheet
        .getRangeList(rowsToMark.map(function (row) { return 'N' + row; }))
        .setValue('O');
    }
    if (newRows.length) {
      const startRow = visitedSheet.getLastRow() + 1;
      ensureRegistrationRows_(
        visitedSheet,
        startRow + newRows.length - 1
      );
      visitedSheet
        .getRange(startRow, 1, newRows.length, 14)
        .setValues(newRows);
    }
  }

  return {
    added: newRows.length,
    updated: rowsToMark.length,
    review: review
  };
}

function createRegistrationMaintenanceText_(result) {
  let text = '';
  text += '군 현황 처리: ' + result.dashboard.processed + '명\n';
  text += '군 현황 출력: ' + result.dashboard.outputRows + '행\n';
  text += '방문자 신규 추가: ' + result.visitors.added + '명\n';
  text += '방문자 등록 표시: ' + result.visitors.updated + '건\n';
  text += '검토 필요: ' +
    (result.dashboard.review.length + result.visitors.review.length) +
    '건\n';
  return text;
}

function sendRegistrationEmail_(message) {
  const requested = message.recipients || [];
  const recipients = REGISTRATION_AUTOMATION.mode === 'PRODUCTION'
    ? requested
    : [REGISTRATION_AUTOMATION.testRecipient];

  const unique = Array.from(new Set(recipients.map(String).map(function (value) {
    return value.trim();
  }).filter(Boolean)));

  if (REGISTRATION_AUTOMATION.mode !== 'PRODUCTION') {
    if (unique.length !== 1 ||
        unique[0] !== REGISTRATION_AUTOMATION.testRecipient) {
      throw new Error('테스트 메일 수신자 안전장치 위반');
    }
  }

  MailApp.sendEmail({
    to: unique.join(','),
    subject: (REGISTRATION_AUTOMATION.mode === 'PRODUCTION'
      ? ''
      : '[TEST] ') + message.subject,
    body: message.body || 'HTML 메일입니다.',
    htmlBody: message.htmlBody || undefined
  });
}

function withRegistrationLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('다른 등록 자동화가 실행 중입니다.');
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function getRegistrationSpreadsheet_() {
  return SpreadsheetApp.openById(
    REGISTRATION_AUTOMATION.registrationSpreadsheetId
  );
}

function writeRegistrationLog_(functionName, result) {
  const ss = getRegistrationSpreadsheet_();
  let sheet = ss.getSheetByName(REGISTRATION_AUTOMATION.logSheetName);
  if (!sheet) {
    sheet = ss.insertSheet(REGISTRATION_AUTOMATION.logSheetName);
    sheet.appendRow([
      '실행시각', '함수', '모드', '현황인원', '현황검토',
      '방문추가', '방문표시', '방문검토'
    ]);
  }
  sheet.appendRow([
    new Date(), functionName, REGISTRATION_AUTOMATION.mode,
    result.dashboard.processed, result.dashboard.review.length,
    result.visitors.added, result.visitors.updated,
    result.visitors.review.length
  ]);
}

function ensureRegistrationRows_(sheet, requiredLastRow) {
  const missing = requiredLastRow - sheet.getMaxRows();
  if (missing > 0) sheet.insertRowsAfter(sheet.getMaxRows(), missing);
}

function addRegistrationIndex_(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function normalizeRegistrationPhone_(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function normalizeRegistrationName_(value) {
  return String(value || '')
    .trim()
    .replace(/[A-Z]$/, '')
    .replace(/\s+/g, '');
}

function parseRegistrationDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (!value || String(value).trim() === '') return null;

  const text = String(value).trim();
  const short = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (short) {
    const month = Number(short[1]);
    const day = Number(short[2]);
    const year = month === 12 ? 2025 : 2026;
    return new Date(year, month - 1, day);
  }

  const date = new Date(text);
  return isNaN(date.getTime()) ? null : date;
}

function escapeRegistrationHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
