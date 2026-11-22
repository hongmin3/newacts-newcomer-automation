const ATTENDANCE_APP = Object.freeze({
  sheetName: '설문지 응답 시트1',
  educationSheetName: '교육 출석 현황',
  timeZone: 'Asia/Seoul',
  consentText: '위와 같이 개인정보를 수집·이용하는 것에 동의합니다.',
  validWeeks: [1, 2, 3, 4],
  validGenders: ['남자', '여자'],
  unknownGroup: '군을 잘 모르겠어요',
  unknownTeam: '팀을 잘모르겠어요(새가족부원에게 문의주세요)',
  legacyTeams: {
    신군: ['가예', '하임', '아가', '예하'],
    조군: ['보배'],
    명군: ['예슈아', '에덴', '열매', '주전', '하이'],
    총군: ['예비', '주품', '서사', '여신', '진리', '동행'],
    영군: ['진토', '힐러', '하나', '주인', '새빛', '그날', '존귀'],
    석군: ['두유', '퓨어', '여기', '구름', '솔라', '기회'],
    임군: ['주하', '푸릇', '나무'],
    전군: ['샤인', '나라', '로뎀', '여름', '이음'],
    슬군: ['오예', '샘물', '보라', '하루']
  }
});

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('새가족 교육 출석체크')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function searchUser_(name, phone) {
  const normalizedName = normalizeAttendanceName_(name);
  const normalizedPhone = normalizeAttendancePhone_(phone);
  if (!normalizedName || !isValidAttendancePhone_(normalizedPhone)) {
    throw new Error('이름과 휴대폰 번호를 정확히 입력해 주세요.');
  }

  return findAttendanceRecord_(getAttendanceSheet_(), normalizedName, normalizedPhone).record;
}

function loadAttendanceForm(name, phone) {
  const record = searchUser_(name, phone);
  const organization = getAttendanceOrganization_(new Date());
  return {
    record: record ? attendanceFormRecord_(record, organization) : null,
    organization: publicAttendanceOrganization_(organization)
  };
}

function submitAttendance(formData) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error('다른 출석 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
  }

  try {
    const clean = validateAttendanceSubmission_(formData);
    const now = new Date();
    const organization = getAttendanceOrganization_(now);
    if (clean.orgConfigId !== organization.id) {
      return { configurationChanged: true, organization: publicAttendanceOrganization_(organization) };
    }
    validateAttendanceAffiliation_(clean, organization);

    const sheet = getAttendanceSheet_();
    const existing = findAttendanceRecord_(sheet, clean.name, clean.phone, now.getTime());

    if (existing.weeks.includes(clean.week)) {
      return { week: clean.week, duplicate: true };
    }
    if (clean.week !== existing.maxWeek + 1) {
      throw new Error(
        '현재 출석 이력과 요청 주차가 일치하지 않습니다. 화면을 새로고침한 뒤 다시 조회해 주세요.'
      );
    }

    const newRow = [
      now,
      ATTENDANCE_APP.consentText,
      clean.week + '주차',
      clean.week === 1 ? clean.route : '',
      clean.name,
      formatAttendancePhone_(clean.phone),
      clean.week === 1 ? clean.gender : existing.record.gender,
      clean.week === 1 ? clean.age : existing.record.age,
      clean.gun,
      clean.team
    ];

    insertAttendanceNewestFirst_(sheet, newRow);
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
    team: String(formData.team || '').trim(),
    orgConfigId: String(formData.orgConfigId || '')
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
  if (clean.week === 1) {
    if (!clean.route || !ATTENDANCE_APP.validGenders.includes(clean.gender) || !clean.age) {
      throw new Error('유입 경로, 성별, 나이를 모두 선택해 주세요.');
    }
  }
  return clean;
}

function findAttendanceRecord_(sheet, name, phone, at = Date.now()) {
  const normalizedName = normalizeAttendanceName_(name);
  const normalizedPhone = normalizeAttendancePhone_(phone);
  const responses = attendanceRows_(sheet, 10).filter(function (row) {
    return normalizeAttendancePhone_(row[5]) === normalizedPhone &&
      ATTENDANCE_APP.validWeeks.includes(parseAttendanceWeek_(row[2]));
  });
  if (responses.some(row => normalizeAttendanceName_(row[4]) !== normalizedName)) {
    throw new Error('출석 정보가 서로 달라 확인이 필요합니다. 교육 담당자에게 문의해 주세요.');
  }
  responses.sort((a, b) => (parseAttendanceDate_(b[0]) || 0) - (parseAttendanceDate_(a[0]) || 0));

  const properties = PropertiesService.getScriptProperties();
  const currentId = properties.getProperty('ORG_EDUCATION_SPREADSHEET_ID');
  const previousId = properties.getProperty('ORG_PREVIOUS_EDUCATION_SPREADSHEET_ID');
  const current = readAttendanceMasterHistory_(currentId, normalizedName, normalizedPhone);
  const previous = previousId === currentId ? null :
    readAttendanceMasterHistory_(previousId, normalizedName, normalizedPhone, at);
  const carryOver = previous && !previous.weeks.includes(4) ? previous : null;

  const weeks = Array.from(new Set([
    ...responses.map(row => parseAttendanceWeek_(row[2])),
    ...(current ? current.weeks : []),
    ...(carryOver ? carryOver.weeks : [])
  ]));
  const maxWeek = weeks.length ? Math.max(...weeks) : 0;
  if (!maxWeek) return { weeks: weeks, maxWeek: maxWeek, record: null };

  const latestResponse = responses[0];
  const master = current || carryOver;
  const gender = responses.map(row => attendanceGender_(row[6])).find(Boolean) ||
    (current ? attendanceGender_(current.row[5]) : '') ||
    (carryOver ? attendanceGender_(carryOver.row[5]) : '');
  const age = responses.map(row => String(row[7] || '').trim()).find(Boolean) || '';
  return {
    weeks: weeks,
    maxWeek: maxWeek,
    record: {
      name: String(latestResponse ? latestResponse[4] : master.row[4]).trim(),
      phone: formatAttendancePhone_(normalizedPhone),
      gender: gender,
      age: age,
      gun: String((latestResponse ? latestResponse[8] : master.row[2]) || '').trim(),
      team: String((latestResponse ? latestResponse[9] : master.row[3]) || '').trim(),
      week: maxWeek
    }
  };
}

function attendanceRows_(sheet, width) {
  const lastRow = sheet.getLastRow();
  return lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
}

function readAttendanceMasterHistory_(spreadsheetId, name, phone, cutoff = Infinity) {
  if (!spreadsheetId) return null;
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(ATTENDANCE_APP.educationSheetName);
  if (!sheet) throw new Error('교육 출석 현황 시트를 확인할 수 없습니다. 교육 담당자에게 문의해 주세요.');

  const matches = attendanceRows_(sheet, 11).filter(row => normalizeAttendancePhone_(row[6]) === phone);
  if (matches.length === 0) return null;
  const row = matches[0];
  if (matches.length !== 1 || normalizeAttendanceName_(row[4]) !== name) {
    throw new Error('교육 출석 현황에서 같은 사람인지 확인이 필요합니다. 교육 담당자에게 문의해 주세요.');
  }

  const completion = String(row[10] || '').trim();
  const intensive = /^(?:[1-4]분기\s*)?집중\s*교육$/.test(completion);
  const weeks = intensive ? ATTENDANCE_APP.validWeeks : ATTENDANCE_APP.validWeeks.filter(function (week) {
    // 기존 수료 보고와 같이 4주차 칸의 수동 수료 표시도 인정합니다.
    if (week === 4) return Boolean(completion);
    const date = parseAttendanceDate_(row[6 + week]);
    return date !== null && date <= cutoff;
  });
  return weeks.length ? { row: row, weeks: weeks } : null;
}

function parseAttendanceDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }
  const match = String(value || '').trim()
    .match(/^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?(?:[ T](\d{1,2}):(\d{2}):(\d{2}))?$/);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(part => Number(part || 0));
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day ||
      hour >= 24 || minute >= 60 || second >= 60) return null;
  // 시트에 문자열로 남은 날짜와 시각도 한국 시간입니다.
  return date.getTime() - 9 * 60 * 60 * 1000;
}

function attendanceGender_(value) {
  const text = String(value || '').trim();
  if (text === '남') return '남자';
  if (text === '여') return '여자';
  return ATTENDANCE_APP.validGenders.includes(text) ? text : '';
}

function getAttendanceOrganization_(at) {
  const config = typeof readOrgConfiguration_ === 'function' ? readOrgConfiguration_(at) : null;
  if (config) return config;
  const groups = Object.entries(ATTENDANCE_APP.legacyTeams).map(([label, teams]) => ({
    key: label.slice(0, -1), label: label, teams: teams
  }));
  return { id: '', groups: groups };
}

function publicAttendanceOrganization_(organization) {
  return {
    id: organization.id,
    unknownGroup: ATTENDANCE_APP.unknownGroup,
    unknownTeam: ATTENDANCE_APP.unknownTeam,
    groups: organization.groups.map(group => ({ label: group.label, teams: group.teams }))
  };
}

function attendanceTeamValue_(team, groupLabel) {
  return team + '(' + groupLabel + ')';
}

function validateAttendanceAffiliation_(clean, organization) {
  const group = organization.groups.find(item => item.label === clean.gun);
  if (!group && clean.gun !== ATTENDANCE_APP.unknownGroup) {
    throw new Error('소속 군을 다시 선택해 주세요.');
  }
  if (clean.team === ATTENDANCE_APP.unknownTeam ||
      (group && group.teams.some(team => attendanceTeamValue_(team, group.label) === clean.team))) return;
  throw new Error('소속 팀을 다시 선택해 주세요.');
}

function attendanceFormRecord_(record, organization) {
  const week = record.week;
  if (record.gun === ATTENDANCE_APP.unknownGroup) {
    return { week: week, gun: ATTENDANCE_APP.unknownGroup, team: ATTENDANCE_APP.unknownTeam };
  }
  const group = organization.groups.find(item => item.label === record.gun || item.key === record.gun ||
    (item.aliases || []).includes(record.gun));
  if (!group) return { week: week, gun: '', team: '' };
  const team = group.teams.find(item => item === record.team || attendanceTeamValue_(item, group.label) === record.team);
  const teamValue = record.team === ATTENDANCE_APP.unknownTeam ? record.team :
    (team ? attendanceTeamValue_(team, group.label) : '');
  return { week: week, gun: group.label, team: teamValue };
}

function getAttendanceSheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('ORG_ATTENDANCE_RESPONSE_SPREADSHEET_ID');
  const spreadsheet = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet && spreadsheet.getSheetByName(ATTENDANCE_APP.sheetName);
  if (!sheet) throw new Error('출석 응답 시트를 찾을 수 없습니다.');
  return sheet;
}

function parseAttendanceWeek_(value) {
  return parseInt(String(value || '').replace(/[^0-9]/g, ''), 10) || 0;
}

function normalizeAttendanceName_(value) {
  return String(value || '').normalize('NFC').replace(/\s+/g, '');
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


/**
 * 기존 응답도 타임스탬프 기준 최신순으로 정렬하는 1회성 마이그레이션 함수입니다.
 */
function sortAttendanceSourceNewestFirst() {
  const sheet = getAttendanceSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 2) return 0;

  sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn())
    .sort({ column: 1, ascending: false });
  SpreadsheetApp.flush();
  return lastRow - 1;
}

/**
 * 신규 출석을 헤더 바로 아래에 삽입합니다.
 */
function insertAttendanceNewestFirst_(sheet, newRow) {
  sheet.insertRowBefore(2);
  sheet.getRange(2, 1, 1, newRow.length).setValues([newRow]);
  sheet.getRange(2, 1).setNumberFormat('yyyy. MM. dd HH:mm:ss');
}
