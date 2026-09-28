/**
 * 교육 출석 자동화 - 안전한 증분 처리 버전
 *
 * 기본값은 비활성(TEST)입니다. 설치형 트리거는 EDUCATION_AUTOMATION.active가
 * true일 때만 시트를 수정합니다. 테스트 메일은 항상 한 주소로 제한됩니다.
 */
const EDUCATION_AUTOMATION = Object.freeze({
  active: true,
  mode: 'PRODUCTION',
  testRecipient: 'ksj747172@gmail.com',
  productionRecipients: [
    'ksj747172@gmail.com',
    'kimth6805@gmail.com',
    'rnrnwkddn@naver.com',
    'wnehdrms123@naver.com',
    'whduswn94@naver.com'
  ],
  masterSpreadsheetId: '1EEIAL39SgRtO1JTe8zpZ4qDMCf_qF-bfrtxn6jfpLgg',
  masterSheetName: '교육 출석 현황',
  sourceSpreadsheetId: '1PKQY3wVgSpk6SqJa9dCyCAV54CIzZF03d-ePReFGwxs',
  sourceSheetName: '설문지 응답 시트1',
  logSheetName: '자동화 로그',
  cursorProperty: 'EDUCATION_LAST_RESPONSE_ROW',
  serviceCutoffMinutes: 13 * 60 + 30
});

/**
 * 설치형 트리거 진입점.
 * active=false이면 아무 데이터도 수정하지 않습니다.
 */
function processPendingAttendanceTrigger() {
  if (!EDUCATION_AUTOMATION.active) {
    console.log('교육 자동화가 비활성 상태라 실행하지 않았습니다.');
    return;
  }
  return withEducationLock_(function () {
    return processPendingAttendance_({ dryRun: false, sendEmail: true });
  });
}
/**
 * 기존 트리거/수동 실행 호환용 이름.
 */
function main() {
  return processPendingAttendanceTrigger();
}

/**
 * 실행 전 변경 예정 건수만 확인합니다. 시트/속성/메일을 변경하지 않습니다.
 */
function previewPendingAttendance() {
  return withEducationLock_(function () {
    const result = processPendingAttendance_({ dryRun: true, sendEmail: false });
    console.log(JSON.stringify(result));
    return result;
  });
}

/**
 * 사용자 승인 후에만 실행할 테스트 함수입니다.
 * 직전 일요일 응답을 검증하며 메일은 테스트 수신자 한 명에게만 보냅니다.
 */
function runEducationTest() {
  return withEducationLock_(function () {
    return processAttendanceForLastSunday_({ dryRun: false, sendEmail: true });
  });
}

/**
 * 최초 운영 전 현재 응답 마지막 행을 기준점으로 설정합니다.
 * 과거 응답은 다시 처리하지 않습니다.
 */
function initializeEducationCursor() {
  const sourceSheet = getEducationSourceSheet_();
  const lastRow = Math.max(sourceSheet.getLastRow(), 1);
  PropertiesService.getScriptProperties()
    .setProperty(EDUCATION_AUTOMATION.cursorProperty, String(lastRow));
  console.log('교육 응답 기준 행을 ' + lastRow + '행으로 설정했습니다.');
  return lastRow;
}

function processPendingAttendance_(options) {
  const sourceSheet = getEducationSourceSheet_();
  const lastRow = sourceSheet.getLastRow();
  const properties = PropertiesService.getScriptProperties();
  const stored = Number(properties.getProperty(EDUCATION_AUTOMATION.cursorProperty));

  if (!Number.isFinite(stored) || stored < 1) {
    const result = createEducationResult_();
    result.initializationRequired = true;
    result.message = '처리 기준 행이 없습니다. initializeEducationCursor를 먼저 실행하세요.';
    return result;
  }

  if (lastRow <= stored) {
    const result = createEducationResult_();
    result.message = '새 응답이 없습니다.';
    return result;
  }

  const rows = sourceSheet
    .getRange(stored + 1, 1, lastRow - stored, sourceSheet.getLastColumn())
    .getValues()
    .map(function (values, index) {
      return { sourceRow: stored + 1 + index, values: values };
    });

  const result = processAttendanceRows_(rows, options);

  if (!options.dryRun) {
    properties.setProperty(EDUCATION_AUTOMATION.cursorProperty, String(lastRow));
    writeEducationLog_('processPendingAttendanceTrigger', result);
  }
  if (options.sendEmail && shouldSendEducationReport_(result)) {
    sendEducationReport_(result, '새 응답 증분 처리');
  }
  return result;
}

function processAttendanceForLastSunday_(options) {
  const sourceSheet = getEducationSourceSheet_();
  const data = sourceSheet.getDataRange().getValues();
  const sunday = getMostRecentSunday_(new Date());
  const target = formatEducationDate_(sunday);

  const rows = [];
  for (let index = 1; index < data.length; index++) {
    const timestamp = parseEducationDate_(data[index][0]);
    if (timestamp && formatEducationDate_(timestamp) === target) {
      rows.push({ sourceRow: index + 1, values: data[index] });
    }
  }

  const result = processAttendanceRows_(rows, options);
  result.targetSunday = target;
  if (!options.dryRun) writeEducationLog_('runEducationTest', result);
  if (options.sendEmail) sendEducationReport_(result, '승인된 테스트 실행');
  return result;
}

function processAttendanceRows_(sourceRows, options) {
  const result = createEducationResult_();
  result.scanned = sourceRows.length;

  const masterSheet = getEducationMasterSheet_();
  const masterLastRow = masterSheet.getLastRow();
  const width = 11;
  const masterRows = masterLastRow > 1
    ? masterSheet.getRange(2, 1, masterLastRow - 1, width).getValues()
    : [];

  const phoneIndex = new Map();
  const nameIndex = new Map();
  let maxNo = 0;

  masterRows.forEach(function (row, index) {
    const no = Number(row[0]);
    if (Number.isFinite(no)) maxNo = Math.max(maxNo, no);
    addIndexValue_(phoneIndex, normalizeEducationPhone_(row[6]), index);
    addIndexValue_(nameIndex, normalizeEducationName_(row[4]), index);
  });

  sourceRows.forEach(function (source) {
    const row = source.values;
    if (!row || !row[0]) return;

    const timestamp = parseEducationDate_(row[0]);
    const week = parseInt(String(row[2] || '').replace(/[^0-9]/g, ''), 10);
    const name = String(row[4] || '').trim();
    const phoneDisplay = formatEducationPhone_(row[5]);
    const phoneKey = normalizeEducationPhone_(row[5]);
    const gender = transformEducationGender_(row[6]);
    const group = transformEducationGroup_(row[8]);
    const team = transformEducationTeam_(row[9]);

    const issueBase = {
      sourceRow: source.sourceRow,
      name: name,
      phone: maskEducationPhone_(phoneDisplay),
      week: week || ''
    };

    if (!timestamp || !name || !phoneKey) {
      result.review.push(Object.assign({}, issueBase, {
        reason: '필수값(타임스탬프/이름/전화번호) 누락'
      }));
      return;
    }
    if (![1, 2, 3, 4].includes(week)) {
      result.review.push(Object.assign({}, issueBase, {
        reason: '허용되지 않은 주차: ' + week
      }));
      return;
    }

    const phoneMatches = phoneIndex.get(phoneKey) || [];
    if (phoneMatches.length > 1) {
      result.review.push(Object.assign({}, issueBase, {
        reason: '교육 시트에 같은 전화번호가 여러 행 존재'
      }));
      return;
    }

    let masterIndex = phoneMatches.length === 1 ? phoneMatches[0] : -1;

    if (masterIndex < 0 && week > 1) {
      const nameMatches = nameIndex.get(normalizeEducationName_(name)) || [];
      result.review.push(Object.assign({}, issueBase, {
        reason: nameMatches.length === 1
          ? '이름은 일치하지만 전화번호가 달라 자동 반영하지 않음'
          : '이전 주차 교육 대상자를 전화번호로 찾지 못함'
      }));
      return;
    }

    const sessionSunday = getMostRecentSunday_(timestamp);
    const attendanceDate = formatEducationDate_(sessionSunday);

    if (masterIndex < 0) {
      if (timestamp.getDay() !== 0) {
        result.review.push(Object.assign({}, issueBase, {
          reason: '늦은 1주차 제출은 예배 구분을 알 수 없어 자동 추가하지 않음'
        }));
        return;
      }

      maxNo += 1;
      const service = getEducationServiceFromTimestamp_(timestamp);
      const newRow = [
        maxNo, service, isValidEducationGroup_(group) ? group : '',
        isValidEducationTeam_(team) ? team : '', name, gender, phoneDisplay,
        attendanceDate, '', '', ''
      ];
      masterRows.push(newRow);
      masterIndex = masterRows.length - 1;
      addIndexValue_(phoneIndex, phoneKey, masterIndex);
      addIndexValue_(nameIndex, normalizeEducationName_(name), masterIndex);
      result.added += 1;
    } else {
      const target = masterRows[masterIndex];

      if (isValidEducationGroup_(group) && target[2] !== group) {
        result.infoChanges.push({
          name: name,
          field: '군',
          before: String(target[2] || ''),
          after: group
        });
        target[2] = group;
      }
      if (isValidEducationTeam_(team) && target[3] !== team) {
        result.infoChanges.push({
          name: name,
          field: '팀',
          before: String(target[3] || ''),
          after: team
        });
        target[3] = team;
      }

      const targetColumnIndex = 7 + (week - 1);
      if (String(target[targetColumnIndex] || '').trim() !== '') {
        result.duplicates.push(Object.assign({}, issueBase, {
          existing: formatEducationCell_(target[targetColumnIndex])
        }));
        return;
      }
      target[targetColumnIndex] = attendanceDate;
      result.updated += 1;
    }
  });

  if (!options.dryRun && (result.added > 0 || result.updated > 0 || result.infoChanges.length > 0)) {
    ensureEducationRows_(masterSheet, masterRows.length + 1);
    if (masterRows.length > 0) {
      masterSheet.getRange(2, 1, masterRows.length, width).setValues(masterRows);
    }
  }

  result.dryRun = Boolean(options.dryRun);
  return result;
}

function createEducationResult_() {
  return {
    scanned: 0,
    added: 0,
    updated: 0,
    duplicates: [],
    infoChanges: [],
    review: [],
    dryRun: false
  };
}

function shouldSendEducationReport_(result) {
  return result.added > 0 ||
    result.updated > 0 ||
    result.duplicates.length > 0 ||
    result.infoChanges.length > 0 ||
    result.review.length > 0;
}

function sendEducationReport_(result, label) {
  const subject = '[새가족교육 자동화] ' + label + ' 결과';
  let body = '';
  body += '실행 구분: ' + label + '\n';
  body += '확인 응답: ' + result.scanned + '건\n';
  body += '신규 추가: ' + result.added + '건\n';
  body += '출석 반영: ' + result.updated + '건\n';
  body += '기입済/중복: ' + result.duplicates.length + '건\n';
  body += '군·팀 변경: ' + result.infoChanges.length + '건\n';
  body += '수동 확인 필요: ' + result.review.length + '건\n\n';

  if (result.review.length) {
    body += '[수동 확인 필요]\n';
    result.review.slice(0, 50).forEach(function (item) {
      body += '- 응답 ' + item.sourceRow + '행 / ' + item.name +
        ' / ' + item.phone + ' / ' + item.reason + '\n';
    });
  }

  sendEducationEmail_({
    subject: subject,
    body: body,
    htmlBody: '<pre style="font-family:monospace;white-space:pre-wrap;">' +
      escapeEducationHtml_(body) + '</pre>'
  });
}

function sendEducationEmail_(message) {
  const recipients = EDUCATION_AUTOMATION.mode === 'PRODUCTION'
    ? (message.recipients || EDUCATION_AUTOMATION.productionRecipients)
    : [EDUCATION_AUTOMATION.testRecipient];

  const uniqueRecipients = Array.from(new Set(recipients.map(String).map(function (v) {
    return v.trim();
  }).filter(Boolean)));

  if (EDUCATION_AUTOMATION.mode !== 'PRODUCTION') {
    if (uniqueRecipients.length !== 1 ||
        uniqueRecipients[0] !== EDUCATION_AUTOMATION.testRecipient) {
      throw new Error('테스트 메일 수신자 안전장치 위반');
    }
  }

  MailApp.sendEmail({
    to: uniqueRecipients.join(','),
    subject: (EDUCATION_AUTOMATION.mode === 'PRODUCTION' ? '' : '[TEST] ') + message.subject,
    body: message.body || 'HTML 메일입니다.',
    htmlBody: message.htmlBody || undefined
  });
}

function writeEducationLog_(functionName, result) {
  const ss = SpreadsheetApp.openById(EDUCATION_AUTOMATION.masterSpreadsheetId);
  let sheet = ss.getSheetByName(EDUCATION_AUTOMATION.logSheetName);
  if (!sheet) {
    sheet = ss.insertSheet(EDUCATION_AUTOMATION.logSheetName);
    sheet.appendRow([
      '실행시각', '함수', '모드', '확인', '추가', '갱신',
      '중복', '정보변경', '검토필요'
    ]);
  }
  sheet.appendRow([
    new Date(), functionName, EDUCATION_AUTOMATION.mode,
    result.scanned, result.added, result.updated,
    result.duplicates.length, result.infoChanges.length, result.review.length
  ]);
}

function withEducationLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('다른 교육 자동화가 실행 중입니다.');
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function getEducationMasterSheet_() {
  const sheet = SpreadsheetApp
    .openById(EDUCATION_AUTOMATION.masterSpreadsheetId)
    .getSheetByName(EDUCATION_AUTOMATION.masterSheetName);
  if (!sheet) throw new Error('교육 출석 현황 시트를 찾을 수 없습니다.');
  return sheet;
}

function getEducationSourceSheet_() {
  const sheet = SpreadsheetApp
    .openById(EDUCATION_AUTOMATION.sourceSpreadsheetId)
    .getSheetByName(EDUCATION_AUTOMATION.sourceSheetName);
  if (!sheet) throw new Error('설문지 응답 시트를 찾을 수 없습니다.');
  return sheet;
}

function ensureEducationRows_(sheet, requiredRows) {
  const missing = requiredRows - sheet.getMaxRows();
  if (missing > 0) sheet.insertRowsAfter(sheet.getMaxRows(), missing);
}

function addIndexValue_(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function normalizeEducationPhone_(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function formatEducationPhone_(value) {
  const phone = normalizeEducationPhone_(value);
  if (phone.length === 11) {
    return phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  }
  if (phone.length === 10) {
    return phone.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  }
  return String(value || '').trim();
}

function maskEducationPhone_(value) {
  const phone = normalizeEducationPhone_(value);
  if (phone.length < 7) return '번호확인필요';
  return phone.slice(0, 3) + '-****-' + phone.slice(-4);
}

function normalizeEducationName_(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function transformEducationGender_(value) {
  const text = String(value || '');
  if (text.includes('남')) return '남';
  if (text.includes('여')) return '여';
  return '';
}

function transformEducationGroup_(value) {
  const text = String(value || '').trim();
  if (!text || text.includes('모르겠')) return '';
  return text.charAt(0);
}

function transformEducationTeam_(value) {
  const text = String(value || '').trim();
  if (!text || text.includes('모르겠')) return '';
  return text.split('(')[0].trim();
}

function isValidEducationGroup_(value) {
  return ['석', '총', '신', '슬', '명', '전', '조', '영', '임'].includes(value);
}

function isValidEducationTeam_(value) {
  return Boolean(value && value !== '미정');
}

function getEducationServiceFromTimestamp_(date) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes < EDUCATION_AUTOMATION.serviceCutoffMinutes ? 4 : 5;
}

function getMostRecentSunday_(dateValue) {
  const date = new Date(dateValue);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function parseEducationDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function formatEducationDate_(value) {
  return Utilities.formatDate(new Date(value), 'Asia/Seoul', 'yyyy-MM-dd');
}

function formatEducationCell_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return formatEducationDate_(value);
  }
  return String(value || '');
}

function escapeEducationHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
