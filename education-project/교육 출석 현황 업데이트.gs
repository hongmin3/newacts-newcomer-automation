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
  cursorProperty: 'EDUCATION_LAST_RESPONSE_AT',
  legacyCursorProperty: 'EDUCATION_LAST_RESPONSE_ROW',
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
    return processAttendanceForLastSunday_({ dryRun: true, sendEmail: true });
  });
}


/**
 * 직전 일요일 응답을 기준으로 상세 메일 내용을 만들되,
 * 시트·속성·메일은 변경하지 않습니다.
 */
function previewEducationDetailedReport() {
  return withEducationLock_(function () {
    const result = processAttendanceForLastSunday_({
      dryRun: true, sendEmail: false
    });
    const message = createEducationReportMessage_(
      result, '상세 메일 미리보기'
    );
    console.log(JSON.stringify({
      subject: message.subject,
      scanned: result.scanned,
      added: result.added,
      updated: result.updated,
      duplicates: result.duplicates.length,
      infoChanges: result.infoChanges.length,
      review: result.review.length,
      body: message.body
    }));
    return { result: result, message: message };
  });
}

/**
 * 최초 운영 전 현재 응답 마지막 행을 기준점으로 설정합니다.
 * 과거 응답은 다시 처리하지 않습니다.
 */
function initializeEducationCursor() {
  const sourceSheet = getEducationSourceSheet_();
  const latestTimestamp = getLatestEducationTimestamp_(sourceSheet);
  const properties = PropertiesService.getScriptProperties();

  properties.setProperty(
    EDUCATION_AUTOMATION.cursorProperty,
    String(latestTimestamp)
  );
  properties.deleteProperty(EDUCATION_AUTOMATION.legacyCursorProperty);
  console.log('교육 응답 기준 시각을 ' + latestTimestamp + '으로 설정했습니다.');
  return latestTimestamp;
}

/**
 * 기존 행 번호 커서를 시각 커서로 이전하면서 미처리 응답을 메일 없이 반영합니다.
 */
function migrateEducationCursorAndProcessPending() {
  return withEducationLock_(function () {
    return processPendingAttendance_({ dryRun: false, sendEmail: false });
  });
}

function processPendingAttendance_(options) {
  const sourceSheet = getEducationSourceSheet_();
  const properties = PropertiesService.getScriptProperties();
  const cursorTime = getEducationCursorTime_(sourceSheet, properties);

  if (cursorTime === null) {
    const result = createEducationResult_();
    result.initializationRequired = true;
    result.dryRun = Boolean(options.dryRun);
    result.message = '처리 기준 시각이 없습니다. initializeEducationCursor를 먼저 실행하세요.';
    return result;
  }

  const data = sourceSheet.getDataRange().getValues();
  const rows = [];
  let latestTimestamp = cursorTime;

  for (let index = 1; index < data.length; index++) {
    const timestamp = parseEducationDate_(data[index][0]);
    if (!timestamp) continue;

    const timestampMs = timestamp.getTime();
    latestTimestamp = Math.max(latestTimestamp, timestampMs);
    if (timestampMs <= cursorTime) continue;

    rows.push({
      sourceRow: index + 1,
      timestampMs: timestampMs,
      values: data[index]
    });
  }

  if (!rows.length) {
    const result = createEducationResult_();
    result.dryRun = Boolean(options.dryRun);
    result.message = '새 응답이 없습니다.';
    return result;
  }

  // 원본 시트가 최신순이어도 1주차부터 차례대로 처리합니다.
  rows.sort(function (a, b) {
    return a.timestampMs - b.timestampMs || a.sourceRow - b.sourceRow;
  });

  const result = processAttendanceRows_(rows, options);

  if (!options.dryRun) {
    properties.setProperty(
      EDUCATION_AUTOMATION.cursorProperty,
      String(latestTimestamp)
    );
    properties.deleteProperty(EDUCATION_AUTOMATION.legacyCursorProperty);
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
  if (options.sendEmail) sendEducationReport_(result, '승인된 테스트 실행');
  return result;
}

function processAttendanceRows_(sourceRows, options) {
  const result = createEducationResult_();
  result.scanned = sourceRows.length;

  const masterSheet = getEducationMasterSheet_();
  const masterLastRow = masterSheet.getLastRow();
  const width = Math.max(masterSheet.getLastColumn(), 13);
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
      const newRow = new Array(width).fill('');
      newRow[0] = maxNo;
      newRow[1] = service;
      newRow[2] = isValidEducationGroup_(group) ? group : '';
      newRow[3] = isValidEducationTeam_(team) ? team : '';
      newRow[4] = name;
      newRow[5] = gender;
      newRow[6] = phoneDisplay;
      newRow[7] = attendanceDate;
      masterRows.push(newRow);
      masterIndex = masterRows.length - 1;
      addIndexValue_(phoneIndex, phoneKey, masterIndex);
      addIndexValue_(nameIndex, normalizeEducationName_(name), masterIndex);
      result.added += 1;
      result.addedDetails.push({
        sourceRow: source.sourceRow,
        name: name,
        phone: issueBase.phone,
        week: week,
        service: service,
        group: newRow[2] || '(미확인)',
        team: newRow[3] || '(미확인)',
        attendanceDate: attendanceDate
      });
    } else {
      const target = masterRows[masterIndex];

      if (isValidEducationGroup_(group) && target[2] !== group) {
        result.infoChanges.push({
          sourceRow: source.sourceRow,
          name: name,
          phone: issueBase.phone,
          week: week,
          field: '군',
          before: String(target[2] || '(빈값)'),
          after: group
        });
        target[2] = group;
      }
      if (isValidEducationTeam_(team) && target[3] !== team) {
        result.infoChanges.push({
          sourceRow: source.sourceRow,
          name: name,
          phone: issueBase.phone,
          week: week,
          field: '팀',
          before: String(target[3] || '(빈값)'),
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
      result.updatedDetails.push({
        sourceRow: source.sourceRow,
        name: name,
        phone: issueBase.phone,
        week: week,
        attendanceDate: attendanceDate
      });
    }
  });

  if (!options.dryRun && (result.added > 0 || result.updated > 0 || result.infoChanges.length > 0)) {
    sortEducationMasterRows_(masterRows);
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
    addedDetails: [],
    updatedDetails: [],
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
  sendEducationEmail_(createEducationReportMessage_(result, label));
}

function createEducationReportMessage_(result, label) {
  const subject = '[새가족교육 자동화] ' + label + ' | 신규 ' +
    result.added + '명 · 출석 ' + result.updated + '건 · 중복 ' +
    result.duplicates.length + '건 · 검토 ' + result.review.length + '건';
  const modeText = result.dryRun
    ? '미리보기(시트 변경 없음)'
    : '실제 반영';

  let body = '';
  body += '[이 메일이 정리하는 내용]\n';
  body += '새가족교육 출석 웹페이지의 새 응답을 교육 출석 현황 시트에 반영한 결과입니다.\n';
  body += '- 1주차 신규 응답: 교육 대상자 행을 새로 만듭니다.\n';
  body += '- 2~4주차 응답: 해당 주차 출석일을 기록합니다.\n';
  body += '- 이미 출석일이 있는 응답: 중복으로 분류하며 덮어쓰지 않습니다.\n';
  body += '- 군·팀이 달라진 응답: 최신 응답 기준으로 갱신합니다.\n\n';

  body += '[실행 요약]\n';
  body += '실행 구분: ' + label + '\n';
  body += '반영 방식: ' + modeText + '\n';
  body += '확인한 새 응답: ' + result.scanned + '건\n';
  body += '신규 대상자 추가: ' + result.added + '명\n';
  body += '기존 대상자 출석 반영: ' + result.updated + '건\n';
  body += '이미 기록된 중복: ' + result.duplicates.length + '건\n';
  body += '군·팀 최신화: ' + result.infoChanges.length + '건\n';
  body += '수동 확인 필요: ' + result.review.length + '건\n\n';

  body = buildEducationTextBody_(body, result);

  let html = '<div style="max-width:980px;margin:0 auto;' +
    'font-family:Malgun Gothic,Arial,sans-serif;color:#1f2937">';
  html += '<h2 style="margin-bottom:8px">새가족교육 출석 자동화 상세 결과</h2>';
  html += '<p style="margin-top:0;color:#6b7280">' +
    escapeEducationHtml_(label) + ' · ' + escapeEducationHtml_(modeText) +
    '</p>';
  html += '<div style="padding:14px 16px;background:#eff6ff;' +
    'border-left:4px solid #2563eb;margin:16px 0">';
  html += '<b>무엇을 정리했나요?</b><br>';
  html += '출석 웹페이지의 새 응답을 교육 출석 현황 시트에 연결했습니다. ' +
    '1주차는 대상자를 추가하고, 2~4주차는 해당 주차 출석일을 기록합니다. ' +
    '이미 기록된 응답은 덮어쓰지 않고 중복으로 분류하며, 군·팀은 최신 응답으로 갱신합니다.';
  html += '</div>';
  html += createEducationSummaryTable_([
    ['확인 응답', result.scanned + '건'],
    ['신규 추가', result.added + '명'],
    ['출석 반영', result.updated + '건'],
    ['중복', result.duplicates.length + '건'],
    ['군·팀 변경', result.infoChanges.length + '건'],
    ['검토 필요', result.review.length + '건']
  ]);
  html += createEducationDetailHtml_(result);
  html += '<p style="margin-top:24px"><a href="https://docs.google.com/spreadsheets/d/' +
    EDUCATION_AUTOMATION.masterSpreadsheetId +
    '/edit#gid=0">교육 출석 현황 시트 열기</a> · ' +
    '<a href="https://docs.google.com/spreadsheets/d/' +
    EDUCATION_AUTOMATION.sourceSpreadsheetId +
    '/edit#gid=679249123">원본 출석 응답 열기</a></p>';
  html += '<p style="color:#6b7280;font-size:12px">이 메일은 ' +
    escapeEducationHtml_(EDUCATION_AUTOMATION.testRecipient) +
    ' 한 명에게만 발송됩니다.</p></div>';

  return { subject: subject, body: body, htmlBody: html };
}

function buildEducationTextBody_(body, result) {
  if (result.addedDetails.length) {
    body += '[신규 대상자 추가 상세]\n';
    result.addedDetails.slice(0, 100).forEach(function (item) {
      body += '- 응답 ' + item.sourceRow + '행 / ' + item.name +
        ' / ' + item.phone + ' / ' + item.week + '주차 / ' +
        item.service + ' / ' + item.group + ' ' + item.team +
        ' / 출석일 ' + item.attendanceDate + '\n';
    });
    body += '\n';
  }
  if (result.updatedDetails.length) {
    body += '[기존 대상자 출석 반영 상세]\n';
    result.updatedDetails.slice(0, 100).forEach(function (item) {
      body += '- 응답 ' + item.sourceRow + '행 / ' + item.name +
        ' / ' + item.phone + ' / ' + item.week +
        '주차 / 출석일 ' + item.attendanceDate + '\n';
    });
    body += '\n';
  }
  if (result.duplicates.length) {
    body += '[이미 기록된 중복 상세 - 시트 변경 없음]\n';
    result.duplicates.slice(0, 100).forEach(function (item) {
      body += '- 응답 ' + item.sourceRow + '행 / ' + item.name +
        ' / ' + item.phone + ' / ' + item.week +
        '주차 / 기존 기록 ' + item.existing + '\n';
    });
    body += '\n';
  }
  if (result.infoChanges.length) {
    body += '[군·팀 최신화 상세]\n';
    result.infoChanges.slice(0, 100).forEach(function (item) {
      body += '- 응답 ' + item.sourceRow + '행 / ' + item.name +
        ' / ' + item.field + ': ' + item.before + ' → ' +
        item.after + ' / ' + item.week + '주차 응답 기준\n';
    });
    body += '\n';
  }
  if (result.review.length) {
    body += '[수동 확인 필요 상세]\n';
    result.review.slice(0, 100).forEach(function (item) {
      body += '- 응답 ' + item.sourceRow + '행 / ' +
        (item.name || '이름 없음') + ' / ' + item.phone +
        ' / ' + item.week + '주차 / ' + item.reason + '\n';
    });
  }
  return body;
}

function createEducationDetailHtml_(result) {
  let html = '';
  if (result.addedDetails.length) {
    html += '<h3>1. 신규 대상자 추가</h3>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
      '<tr style="background:#ecfdf5"><th>응답 행</th><th>이름</th>' +
      '<th>전화번호</th><th>주차</th><th>예배</th><th>군·팀</th><th>출석일</th></tr>';
    result.addedDetails.slice(0, 100).forEach(function (item) {
      html += '<tr>' + createEducationTableCell_(item.sourceRow) +
        createEducationTableCell_(item.name) +
        createEducationTableCell_(item.phone) +
        createEducationTableCell_(item.week + '주차') +
        createEducationTableCell_(item.service) +
        createEducationTableCell_(item.group + ' ' + item.team) +
        createEducationTableCell_(item.attendanceDate) + '</tr>';
    });
    html += '</table>';
  }
  if (result.updatedDetails.length) {
    html += '<h3>2. 기존 대상자 출석 반영</h3>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
      '<tr style="background:#eff6ff"><th>응답 행</th><th>이름</th>' +
      '<th>전화번호</th><th>주차</th><th>출석일</th></tr>';
    result.updatedDetails.slice(0, 100).forEach(function (item) {
      html += '<tr>' + createEducationTableCell_(item.sourceRow) +
        createEducationTableCell_(item.name) +
        createEducationTableCell_(item.phone) +
        createEducationTableCell_(item.week + '주차') +
        createEducationTableCell_(item.attendanceDate) + '</tr>';
    });
    html += '</table>';
  }
  if (result.duplicates.length) {
    html += '<h3>3. 이미 기록된 중복 <span style="font-size:12px;color:#6b7280">(변경 없음)</span></h3>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
      '<tr style="background:#f9fafb"><th>응답 행</th><th>이름</th>' +
      '<th>전화번호</th><th>주차</th><th>기존 기록</th></tr>';
    result.duplicates.slice(0, 100).forEach(function (item) {
      html += '<tr>' + createEducationTableCell_(item.sourceRow) +
        createEducationTableCell_(item.name) +
        createEducationTableCell_(item.phone) +
        createEducationTableCell_(item.week + '주차') +
        createEducationTableCell_(item.existing) + '</tr>';
    });
    html += '</table>';
  }
  if (result.infoChanges.length) {
    html += '<h3>4. 군·팀 최신화</h3>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
      '<tr style="background:#fefce8"><th>응답 행</th><th>이름</th>' +
      '<th>항목</th><th>기존 값</th><th>최신 값</th><th>근거</th></tr>';
    result.infoChanges.slice(0, 100).forEach(function (item) {
      html += '<tr>' + createEducationTableCell_(item.sourceRow) +
        createEducationTableCell_(item.name) +
        createEducationTableCell_(item.field) +
        createEducationTableCell_(item.before) +
        createEducationTableCell_(item.after) +
        createEducationTableCell_(item.week + '주차 응답') + '</tr>';
    });
    html += '</table>';
  }
  if (result.review.length) {
    html += '<h3>5. 수동 확인 필요</h3>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
      '<tr style="background:#fff7ed"><th>응답 행</th><th>이름</th>' +
      '<th>전화번호</th><th>주차</th><th>사유</th></tr>';
    result.review.slice(0, 100).forEach(function (item) {
      html += '<tr>' + createEducationTableCell_(item.sourceRow) +
        createEducationTableCell_(item.name || '이름 없음') +
        createEducationTableCell_(item.phone) +
        createEducationTableCell_(item.week + '주차') +
        createEducationTableCell_(item.reason) + '</tr>';
    });
    html += '</table>';
  }
  return html;
}

function createEducationSummaryTable_(items) {
  let html = '<table style="width:100%;border-collapse:collapse;margin:8px 0 18px"><tr>';
  items.forEach(function (item) {
    html += '<td style="padding:12px 8px;border:1px solid #dbeafe;' +
      'background:#f8fafc;text-align:center"><div style="font-size:12px;' +
      'color:#64748b">' + escapeEducationHtml_(item[0]) +
      '</div><b style="font-size:17px">' +
      escapeEducationHtml_(item[1]) + '</b></td>';
  });
  return html + '</tr></table>';
}

function createEducationTableCell_(value) {
  return '<td style="padding:8px;border:1px solid #e5e7eb">' +
    escapeEducationHtml_(value) + '</td>';
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
  return { disabled: true };
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

function getEducationCursorTime_(sourceSheet, properties) {
  const storedValue = properties.getProperty(
    EDUCATION_AUTOMATION.cursorProperty
  );
  if (storedValue !== null) {
    const storedTime = Number(storedValue);
    if (Number.isFinite(storedTime) && storedTime >= 0) return storedTime;
  }

  const legacyRow = Number(
    properties.getProperty(EDUCATION_AUTOMATION.legacyCursorProperty)
  );
  if (!Number.isFinite(legacyRow) || legacyRow < 2 ||
      legacyRow > sourceSheet.getLastRow()) {
    return null;
  }

  const legacyTimestamp = parseEducationDate_(
    sourceSheet.getRange(legacyRow, 1).getValue()
  );
  return legacyTimestamp ? legacyTimestamp.getTime() : null;
}

function getLatestEducationTimestamp_(sourceSheet) {
  const lastRow = sourceSheet.getLastRow();
  if (lastRow <= 1) return 0;

  return sourceSheet.getRange(2, 1, lastRow - 1, 1)
    .getValues()
    .reduce(function (latest, row) {
      const timestamp = parseEducationDate_(row[0]);
      return timestamp ? Math.max(latest, timestamp.getTime()) : latest;
    }, 0);
}

function sortEducationMasterRows_(rows) {
  rows.sort(function (a, b) {
    return getEducationLatestActivityTime_(b) -
      getEducationLatestActivityTime_(a) ||
      Number(b[0] || 0) - Number(a[0] || 0);
  });
  return rows;
}

function getEducationLatestActivityTime_(row) {
  let latest = 0;
  for (let column = 7; column <= 10; column++) {
    const date = parseEducationDate_(row[column]);
    if (date) latest = Math.max(latest, date.getTime());
  }
  return latest;
}

/**
 * 교육 현황과 자동화 로그의 기존 데이터도 최신순으로 정렬합니다.
 */
function sortEducationManagementNewestFirst() {
  const masterSheet = getEducationMasterSheet_();
  const lastRow = masterSheet.getLastRow();
  const width = Math.max(masterSheet.getLastColumn(), 13);

  if (lastRow > 2) {
    const rows = masterSheet.getRange(2, 1, lastRow - 1, width).getValues();
    sortEducationMasterRows_(rows);
    masterSheet.getRange(2, 1, rows.length, width).setValues(rows);
  }

  const ss = SpreadsheetApp.openById(EDUCATION_AUTOMATION.masterSpreadsheetId);
  const logSheet = ss.getSheetByName(EDUCATION_AUTOMATION.logSheetName);
  if (logSheet && logSheet.getLastRow() > 2) {
    logSheet.getRange(
      2, 1, logSheet.getLastRow() - 1, logSheet.getLastColumn()
    ).sort({ column: 1, ascending: false });
  }
  SpreadsheetApp.flush();
  return Math.max(lastRow - 1, 0);
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
