const ATTENDANCE_APP = Object.freeze({
  sheetName: '설문지 응답 시트1',
  timeZone: 'Asia/Seoul',
  consentText: '위와 같이 개인정보를 수집·이용하는 것에 동의합니다.',
  validWeeks: [1, 2, 3, 4],
  validGenders: ['남자', '여자'],
  validGroups: [
    '신군', '조군', '명군', '총군', '영군',
    '석군', '임군', '전군', '슬군', '군을 잘 모르겠어요'
  ]
});

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('새가족 교육 출석체크')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function searchUser(name, phone) {
  const normalizedName = normalizeAttendanceName_(name);
  const normalizedPhone = normalizeAttendancePhone_(phone);
  if (!normalizedName || !isValidAttendancePhone_(normalizedPhone)) {
    throw new Error('이름과 휴대폰 번호를 정확히 입력해 주세요.');
  }

  const sheet = getAttendanceSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  let latestRecord = null;
  let maxWeek = 0;

  for (let i = 0; i < data.length; i++) {
    const rowName = normalizeAttendanceName_(data[i][4]);
    const rowPhone = normalizeAttendancePhone_(data[i][5]);
    if (rowName !== normalizedName || rowPhone !== normalizedPhone) continue;

    const week = parseAttendanceWeek_(data[i][2]);
    if (!ATTENDANCE_APP.validWeeks.includes(week) || week <= maxWeek) continue;

    maxWeek = week;
    latestRecord = {
      name: String(data[i][4] || '').trim(),
      phone: formatAttendancePhone_(data[i][5]),
      gender: String(data[i][6] || '').trim(),
      age: String(data[i][7] || '').trim(),
      gun: String(data[i][8] || '').trim(),
      team: String(data[i][9] || '').trim(),
      week: week
    };
  }
  return latestRecord;
}

function submitAttendance(formData) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error('다른 출석 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
  }

  try {
    const clean = validateAttendanceSubmission_(formData);
    const sheet = getAttendanceSheet_();
    const existing = findAttendanceRecord_(sheet, clean.name, clean.phone);

    if (existing.weeks.includes(clean.week)) {
      return { week: clean.week, duplicate: true };
    }
    if (clean.week !== existing.maxWeek + 1) {
      throw new Error(
        '현재 출석 이력과 요청 주차가 일치하지 않습니다. 화면을 새로고침한 뒤 다시 조회해 주세요.'
      );
    }

    const now = new Date();
    const newRow = [
      now,
      ATTENDANCE_APP.consentText,
      clean.week + '주차',
      clean.week === 1 ? clean.route : '',
      clean.name,
      formatAttendancePhone_(clean.phone),
      clean.gender,
      clean.age,
      clean.gun,
      clean.team
    ];

    // 교육관리 자동화는 마지막 처리 행 이후를 읽으므로 신규 응답은 반드시 끝에 추가합니다.
    sheet.appendRow(newRow);
    sheet.getRange(sheet.getLastRow(), 1).setNumberFormat('yyyy. MM. dd HH:mm:ss');
    SpreadsheetApp.flush();

    return { week: clean.week, duplicate: false };
  } finally {
    lock.releaseLock();
  }
}

function validateAttendanceSubmission_(formData) {
  if (!formData || typeof formData !== 'object') {
    throw new Error('제출 데이터가 올바르지 않습니다.');
  }

  const clean = {
    name: String(formData.name || '').trim(),
    phone: normalizeAttendancePhone_(formData.phone),
    week: Number(formData.week),
    route: String(formData.route || '').trim(),
    gender: String(formData.gender || '').trim(),
    age: String(formData.age || '').trim(),
    gun: String(formData.gun || '').trim(),
    team: String(formData.team || '').trim()
  };

  if (!normalizeAttendanceName_(clean.name) || clean.name.length > 30) {
    throw new Error('이름을 정확히 입력해 주세요.');
  }
  if (!isValidAttendancePhone_(clean.phone)) {
    throw new Error('휴대폰 번호 10~11자리를 정확히 입력해 주세요.');
  }
  if (!ATTENDANCE_APP.validWeeks.includes(clean.week)) {
    throw new Error('허용되지 않은 교육 주차입니다.');
  }
  if (!ATTENDANCE_APP.validGroups.includes(clean.gun)) {
    throw new Error('소속 군을 다시 선택해 주세요.');
  }
  if (!clean.team || clean.team.length > 80) {
    throw new Error('소속 팀을 다시 선택해 주세요.');
  }
  if (clean.week === 1) {
    if (!clean.route || !ATTENDANCE_APP.validGenders.includes(clean.gender) || !clean.age) {
      throw new Error('유입 경로, 성별, 나이를 모두 선택해 주세요.');
    }
  } else {
    const existing = searchUser(clean.name, clean.phone);
    if (!existing) throw new Error('이전 주차 출석 정보를 찾을 수 없습니다.');
    clean.gender = existing.gender;
    clean.age = existing.age;
  }
  return clean;
}

function findAttendanceRecord_(sheet, name, phone) {
  const normalizedName = normalizeAttendanceName_(name);
  const normalizedPhone = normalizeAttendancePhone_(phone);
  const lastRow = sheet.getLastRow();
  const weeks = [];

  if (lastRow > 1) {
    const rows = sheet.getRange(2, 3, lastRow - 1, 4).getValues();
    rows.forEach(function (row) {
      if (normalizeAttendanceName_(row[2]) !== normalizedName) return;
      if (normalizeAttendancePhone_(row[3]) !== normalizedPhone) return;
      const week = parseAttendanceWeek_(row[0]);
      if (ATTENDANCE_APP.validWeeks.includes(week)) weeks.push(week);
    });
  }

  return {
    weeks: Array.from(new Set(weeks)),
    maxWeek: weeks.length ? Math.max.apply(null, weeks) : 0
  };
}

function getAttendanceSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(ATTENDANCE_APP.sheetName);
  if (!sheet) throw new Error('출석 응답 시트를 찾을 수 없습니다.');
  return sheet;
}

function parseAttendanceWeek_(value) {
  return parseInt(String(value || '').replace(/[^0-9]/g, ''), 10) || 0;
}

function normalizeAttendanceName_(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function normalizeAttendancePhone_(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function isValidAttendancePhone_(value) {
  return /^01\d{8,9}$/.test(String(value || ''));
}

function formatAttendancePhone_(value) {
  const phone = normalizeAttendancePhone_(value);
  if (phone.length === 11) {
    return phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  }
  if (phone.length === 10) {
    return phone.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  }
  return String(value || '').trim();
}
