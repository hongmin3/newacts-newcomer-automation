/**
 * 교육 진행/미진행 문자 대상 명단 알림.
 * 메일 발송은 교육 출석 파일의 sendEducationEmail_ 안전 관문을 사용합니다.
 */
const NOTIFICATION_CONFIG = Object.freeze({
  registrationSpreadsheetId: '1dBO4rhCCadxO-KVBX_Jmg4aDcV9zim_sqM95JKd4Snk',
  registrationSheetName: '새가족교육 수료현황',
  fixedStartDate: '2025-11-02',
  weeksLimit: 15,
  executivePhones: [
    '010-7413-7693',
    '010-4155-4469',
    '010-3621-1131',
    '010-3190-5073'
  ]
});

function sendNewcomerNotificationsTrigger() {
  if (!EDUCATION_AUTOMATION.active) {
    console.log('교육 자동화가 비활성 상태라 문자 명단을 발송하지 않았습니다.');
    return;
  }
  return withEducationLock_(function () {
    return sendNewcomerNotifications_();
  });
}
/**
 * 기존 함수명 호환. 트리거는 sendNewcomerNotificationsTrigger를 사용합니다.
 */
function sendNewcomerNotifications() {
  return sendNewcomerNotificationsTrigger();
}

/**
 * 사용자 승인 후 테스트 메일을 본인 한 명에게 발송합니다.
 */
function runNewcomerNotificationTest() {
  return withEducationLock_(function () {
    return sendNewcomerNotifications_();
  });
}

function sendNewcomerNotifications_() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const limitDate = new Date(today);
  limitDate.setDate(limitDate.getDate() - NOTIFICATION_CONFIG.weeksLimit * 7);

  const fixedStart = new Date(NOTIFICATION_CONFIG.fixedStartDate);
  fixedStart.setHours(0, 0, 0, 0);
  const effectiveStart = limitDate < fixedStart ? fixedStart : limitDate;

  const educationList = getEducationInProgressList_(effectiveStart);
  const notStartedList = getNotStartedList_(effectiveStart);
  const dateRange = formatNotificationDate_(effectiveStart) + ' ~ ' +
    formatNotificationDate_(today);

  const html = createNotificationHtml_(
    educationList,
    notStartedList,
    dateRange
  );

  sendEducationEmail_({
    subject: '[뉴액츠 새가족부] 금주 새가족 교육 문자공지 명단 (' +
      formatNotificationDate_(today) + ')',
    body: 'HTML 형식의 문자공지 대상자 명단입니다.',
    htmlBody: html
  });

  const result = {
    educationInProgress: educationList.length,
    notStarted: notStartedList.length
  };
  console.log(JSON.stringify(result));
  return result;
}

function getEducationInProgressList_(cutoffDate) {
  const sheet = getEducationMasterSheet_();
  const data = sheet.getDataRange().getValues();
  const result = [];

  for (let index = 1; index < data.length; index++) {
    const row = data[index];
    const name = String(row[4] || '').trim();
    const phone = formatEducationPhone_(row[6]);
    const weekDates = [row[7], row[8], row[9], row[10]];
    const optOut = String(row[11] || '').trim().toUpperCase();

    if (!name || !phone || optOut === 'O') continue;
    if (String(weekDates[3] || '').trim() !== '') continue;

    let lastDate = null;
    let completedWeeks = 0;
    weekDates.slice(0, 3).forEach(function (value) {
      const date = parseNotificationDate_(value);
      if (date) {
        lastDate = date;
        completedWeeks += 1;
      }
    });

    if (lastDate && lastDate < cutoffDate) continue;

    result.push({
      group: String(row[2] || '').trim(),
      team: String(row[3] || '').trim(),
      name: name,
      phone: phone,
      status: completedWeeks ? completedWeeks + '주차 완료' : '교육 시작 전',
      date: lastDate ? formatNotificationDate_(lastDate) : ''
    });
  }
  return dedupeNotificationPeople_(result);
}

function getNotStartedList_(cutoffDate) {
  const ss = SpreadsheetApp.openById(
    NOTIFICATION_CONFIG.registrationSpreadsheetId
  );
  const sheet = ss.getSheetByName(
    NOTIFICATION_CONFIG.registrationSheetName
  );
  if (!sheet) throw new Error('등록 수료현황 시트를 찾을 수 없습니다.');

  const data = sheet.getDataRange().getValues();
  const result = [];

  for (let index = 1; index < data.length; index++) {
    const row = data[index];
    const name = String(row[4] || '').trim();
    const phone = formatEducationPhone_(row[6]);
    const registrationDate = parseNotificationDate_(row[7]);
    const firstWeek = String(row[8] || '').trim();
    const optOut = String(row[12] || '').trim().toUpperCase();

    if (!name || !phone || firstWeek || optOut === 'O') continue;
    if (registrationDate && registrationDate < cutoffDate) continue;

    result.push({
      group: String(row[1] || '').trim(),
      team: String(row[2] || '').trim(),
      name: name,
      phone: phone,
      date: registrationDate
        ? formatNotificationDate_(registrationDate)
        : String(row[7] || '').trim()
    });
  }
  return dedupeNotificationPeople_(result);
}

function dedupeNotificationPeople_(list) {
  const seen = new Set();
  return list.filter(function (person) {
    const key = normalizeEducationPhone_(person.phone);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createNotificationHtml_(educationList, notStartedList, dateRange) {
  const executiveList = NOTIFICATION_CONFIG.executivePhones.map(function (phone) {
    return { phone: formatEducationPhone_(phone) };
  });

  const educationPhones = dedupeNotificationPeople_(
    educationList.concat(executiveList)
  );
  const notStartedPhones = dedupeNotificationPeople_(
    notStartedList.concat(executiveList)
  );

  let html = '';
  html += '<div style="font-family:Malgun Gothic,sans-serif;color:#333">';
  html += '<h2>[뉴액츠] 새가족 교육 문자공지 대상자</h2>';
  html += '<p><b>조회 기간:</b> ' + escapeEducationHtml_(dateRange) + '</p>';
  html += createNotificationTable_('교육 진행 중', educationList, true);
  html += createNotificationTable_('등록 후 교육 미진행', notStartedList, false);
  html += '<h3>문자 발송용 번호</h3>';
  html += '<p>20명 단위 구분선을 기준으로 나누어 복사하세요.</p>';
  html += '<h4>교육 진행 중</h4>' +
    createPhoneCopyBlock_(educationPhones);
  html += '<h4>교육 미진행</h4>' +
    createPhoneCopyBlock_(notStartedPhones);
  html += '</div>';
  return html;
}

function createNotificationTable_(title, list, showStatus) {
  let html = '<h3>' + escapeEducationHtml_(title) + ' (' + list.length + '명)</h3>';
  if (!list.length) return html + '<p>대상자 없음</p>';

  html += '<table border="1" cellpadding="6" cellspacing="0" ' +
    'style="border-collapse:collapse;text-align:center">';
  html += '<tr><th>군</th><th>팀</th><th>이름</th><th>전화번호</th>';
  if (showStatus) html += '<th>상태</th>';
  html += '<th>기준일</th></tr>';

  list.forEach(function (person) {
    html += '<tr>';
    html += '<td>' + escapeEducationHtml_(person.group) + '</td>';
    html += '<td>' + escapeEducationHtml_(person.team) + '</td>';
    html += '<td>' + escapeEducationHtml_(person.name) + '</td>';
    html += '<td>' + escapeEducationHtml_(person.phone) + '</td>';
    if (showStatus) {
      html += '<td>' + escapeEducationHtml_(person.status) + '</td>';
    }
    html += '<td>' + escapeEducationHtml_(person.date) + '</td>';
    html += '</tr>';
  });
  return html + '</table>';
}

function createPhoneCopyBlock_(list) {
  if (!list.length) return '<p>대상자 없음</p>';
  let html = '<div style="font-family:monospace;background:#f7f7f7;padding:12px">';
  list.forEach(function (person, index) {
    html += escapeEducationHtml_(person.phone) + '<br>';
    if ((index + 1) % 20 === 0 && index !== list.length - 1) {
      html += '<br><b style="color:#c00">----- 20명 구분선 -----</b><br><br>';
    }
  });
  return html + '</div>';
}

function parseNotificationDate_(value) {
  if (!value || String(value).trim() === '') return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;

  let text = String(value).trim().replace(/\./g, '/').replace(/\s/g, '');
  if (text.endsWith('/')) text = text.slice(0, -1);

  const shortMatch = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (shortMatch) {
    return new Date(
      new Date().getFullYear(),
      Number(shortMatch[1]) - 1,
      Number(shortMatch[2])
    );
  }

  const date = new Date(text);
  if (isNaN(date.getTime())) return null;
  if (date.getFullYear() >= 1900 && date.getFullYear() < 2000) {
    date.setFullYear(date.getFullYear() + 100);
  }
  return date;
}

function formatNotificationDate_(date) {
  return Utilities.formatDate(new Date(date), 'Asia/Seoul', 'yyyy-MM-dd');
}
