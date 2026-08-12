/**
 * 설정값 (변수명 충돌 방지를 위해 NOTI_CONFIG 유지)
 */
const NOTI_CONFIG = {
  // 1. [뉴액츠 새가족부 교육관리] 스프레드시트 ID
  SPREADSHEET_ID_EDU: '1EEIAL39SgRtO1JTe8zpZ4qDMCf_qF-bfrtxn6jfpLgg', 
  
  // 2. [2026년 뉴액츠 청년부 등록 새가족 현황] 스프레드시트 ID
  SPREADSHEET_ID_REG: '1dBO4rhCCadxO-KVBX_Jmg4aDcV9zim_sqM95JKd4Snk', 
  
  EMAIL_RECIPIENT: 'ksj747172@gmail.com, kimth6805@gmail.com, rnrnwkddn@naver.com, wnehdrms123@naver.com, whduswn94@naver.com',
  // 
  
  SHEET_NAME_EDU: '교육 출석 현황',       
  SHEET_NAME_REG: '새가족교육 수료현황',  
  
  // 고정 시작일 및 주수 제한 설정
  FIXED_START_DATE: '2025-11-02', 
  WEEKS_LIMIT: 15,

  // 3. 임원단 연락처 (문자 발송 확인/이중체크용) - 변경 시 여기서 수정하세요!
  EXECUTIVE_PHONES: [
    '010-7413-7693',
    '010-4155-4469',
    '010-3621-1131',
    '010-3190-5073'
  ]
};

function sendNewcomerNotifications() {
  const ssEdu = SpreadsheetApp.openById(NOTI_CONFIG.SPREADSHEET_ID_EDU);
  const ssReg = SpreadsheetApp.openById(NOTI_CONFIG.SPREADSHEET_ID_REG);
  
  // 1. 조회 기간(Start Date) 계산
  const today = new Date();
  today.setHours(0,0,0,0); 

  let limitDate = new Date(today);
  limitDate.setDate(today.getDate() - (NOTI_CONFIG.WEEKS_LIMIT * 7));
  limitDate.setHours(0,0,0,0);

  const fixedStart = new Date(NOTI_CONFIG.FIXED_START_DATE);
  fixedStart.setHours(0,0,0,0);

  let effectiveStart = (limitDate < fixedStart) ? fixedStart : limitDate;

  const weeksDiff = Math.ceil((today - effectiveStart) / (1000 * 60 * 60 * 24 * 7));
  const dateRangeStr = `${formatDateShort(effectiveStart)} ~ ${formatDateShort(today)} (${weeksDiff}주)`;

  // 2. 데이터 가져오기
  const eduData = getEducationInProgressList(ssEdu, effectiveStart);
  const regData = getNotStartedList(ssReg, effectiveStart);
  
  // 3. 이메일 본문 생성
  const emailBody = createEmailBody(eduData, regData, dateRangeStr);
  
  // 4. 이메일 발송
  MailApp.sendEmail({
    to: NOTI_CONFIG.EMAIL_RECIPIENT,
    subject: `[뉴액츠 새가족부] 금주 새가족 교육 문자공지 명단 (${formatDateShort(today)})`,
    htmlBody: emailBody
  });
  
  Logger.log('이메일 발송이 완료되었습니다.');
}

/**
 * 1. 교육 진행 중인 인원 추출 
 */
function getEducationInProgressList(ss, cutOffDate) {
  const sheet = ss.getSheetByName(NOTI_CONFIG.SHEET_NAME_EDU);
  if (!sheet) throw new Error(`'${NOTI_CONFIG.SHEET_NAME_EDU}' 시트를 찾을 수 없습니다.`);
  
  const data = sheet.getDataRange().getValues();
  const result = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const group = row[2];
    const team = row[3];
    const name = row[4];
    const phone = row[6];
    const week1 = row[7];
    const week2 = row[8];
    const week3 = row[9];
    const week4 = row[10];
    const optOut = row[11]; 

    if (!name || !phone) continue;
    // 빈칸 띄어쓰기(스페이스바) 오타 방어
    if (String(week4).trim() !== "") continue; 
    if (String(optOut).trim().toUpperCase() === "O") continue; 

    let lastDate = null;
    let statusStr = "교육 시작 전";
    
    // 안전한 날짜 파싱 적용
    const w3Date = parseDateSafely(week3);
    const w2Date = parseDateSafely(week2);
    const w1Date = parseDateSafely(week1);

    if (w3Date) { lastDate = w3Date; statusStr = "3주차 완료"; }
    else if (w2Date) { lastDate = w2Date; statusStr = "2주차 완료"; }
    else if (w1Date) { lastDate = w1Date; statusStr = "1주차 완료"; }
    
    if (lastDate) {
      if (lastDate < cutOffDate) continue;
    }

    let lastDateStr = lastDate ? Utilities.formatDate(lastDate, Session.getScriptTimeZone(), "yyyy-MM-dd") : "";

    result.push({ 
      group: group, team: team, name: name, phone: formatPhoneNumber(phone), 
      status: statusStr, lastDate: lastDateStr
    });
  }
  return result;
}

/**
 * 2. 등록새가족 중 교육 미진행 인원 추출
 */
function getNotStartedList(ss, cutOffDate) {
  const sheet = ss.getSheetByName(NOTI_CONFIG.SHEET_NAME_REG);
  if (!sheet) throw new Error(`'${NOTI_CONFIG.SHEET_NAME_REG}' 시트를 찾을 수 없습니다.`);

  const data = sheet.getDataRange().getValues();
  const result = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const group = row[1];
    const team = row[2];
    const name = row[4];
    const phone = row[6];
    const regDate = row[7];
    const week1 = row[8]; 
    const optOut = row[12]; 

    if (!name || !phone) continue;
    // 빈칸 띄어쓰기(스페이스바) 오타 방어
    if (String(week1).trim() !== "") continue; 
    if (String(optOut).trim().toUpperCase() === "O") continue; 

    // 안전한 날짜 파싱 적용
    const rDate = parseDateSafely(regDate);

    if (rDate) {
      if (rDate < cutOffDate) continue;
    }

    let regDateStr = "";
    if (rDate && !isNaN(rDate.getTime())) {
      regDateStr = Utilities.formatDate(rDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
    } else {
      regDateStr = regDate ? String(regDate).trim() : "";
    }

    result.push({ 
      group: group, team: team, name: name, phone: formatPhoneNumber(phone), 
      regDate: regDateStr 
    });
  }
  return result;
}

/**
 * 이메일 본문 생성 (20명 단위 구분선 추가 및 임원단 번호 병합)
 */
function createEmailBody(eduList, regList, dateRangeStr) {
  
  // 20명씩 끊어서 출력하는 헬퍼 함수
  const formatPhoneList = (list) => {
    if (!list || list.length === 0) return "대상자 없음";
    
    let html = "";
    list.forEach((p, index) => {
      html += p.phone + "<br>";
      
      // 20번째, 40번째... 일 때 구분선 추가 (마지막 번호 뒤에는 추가 안 함)
      if ((index + 1) % 20 === 0 && index !== list.length - 1) {
        html += `<br><span style="color:#d9534f; font-weight:bold;">----------------- (20명 절취선) -----------------</span><br><br>`;
      }
    });
    return html;
  };

  // 임원단 번호를 리스트 형태의 객체 배열로 변환
  const execList = (NOTI_CONFIG.EXECUTIVE_PHONES || []).map(phoneNum => ({ phone: phoneNum }));

  // 복사용 리스트에만 임원단 번호를 병합 (테이블 명단에는 영향 없음)
  const eduPhonesToCopy = eduList.concat(execList);
  const regPhonesToCopy = regList.concat(execList);

  let html = `
    <html>
    <head>
      <style>
        body { font-family: 'Malgun Gothic', sans-serif; line-height: 1.6; color: #333; }
        h2 { color: #2c3e50; }
        h3 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; margin-top: 30px;}
        .info-box { background-color: #e8f4fd; padding: 10px; border-radius: 5px; margin-bottom: 20px; border: 1px solid #b6d4fe; }
        .period { font-weight: bold; color: #0056b3; }
        table { border-collapse: collapse; width: 100%; max-width: 700px; margin-bottom: 20px; font-size: 13px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
        th { background-color: #f2f2f2; color: #333; font-weight: bold; }
        .phone-box { background-color: #f9f9f9; border: 1px solid #ccc; padding: 15px; border-radius: 5px; font-family: monospace; white-space: pre-line; }
        .date { color: #666; font-size: 0.9em; }
        .group-info { color: #000080; font-weight: bold; }
      </style>
    </head>
    <body>
      <h2>[뉴액츠] 새가족 교육 문자공지 대상자</h2>
      
      <div class="info-box">
        📌 <strong>조회 기간:</strong> <span class="period">${dateRangeStr}</span><br>
        <span style="font-size: 0.9em; color: #666;">※ 시작일(${NOTI_CONFIG.FIXED_START_DATE}) 기준, 최대 ${NOTI_CONFIG.WEEKS_LIMIT}주 전까지의 데이터를 조회합니다.</span>
      </div>
      
      <h3>1. 교육 진행 중 (${eduList.length}명)</h3>
      <table>
        <tr>
          <th width="10%">군</th>
          <th width="10%">팀</th>
          <th width="15%">이름</th>
          <th width="25%">전화번호</th>
          <th width="20%">상태</th>
          <th width="20%">마지막 수강일</th>
        </tr>
        ${eduList.map(p => `
          <tr>
            <td class="group-info">${p.group}</td>
            <td class="group-info">${p.team}</td>
            <td>${p.name}</td>
            <td>${p.phone}</td>
            <td>${p.status}</td>
            <td class="date">${p.lastDate}</td>
          </tr>`).join('')}
      </table>

      <h3>2. 등록새가족 중 교육 미진행 (${regList.length}명)</h3>
      <table>
        <tr>
          <th width="15%">군</th>
          <th width="15%">팀</th>
          <th width="15%">이름</th>
          <th width="30%">전화번호</th>
          <th width="25%">등록일</th>
        </tr>
        ${regList.map(p => `
          <tr>
            <td class="group-info">${p.group}</td>
            <td class="group-info">${p.team}</td>
            <td>${p.name}</td>
            <td>${p.phone}</td>
            <td>${p.regDate}</td>
          </tr>`).join('')}
      </table>
      
      <h3>3. 문자 발송용 번호 복사 (20명 단위)</h3>
      <p style="font-size:12px; color:#666;">※ 붉은색 점선이 보이면 끊어서 복사하세요. (명단 맨 끝에 임원단 확인용 번호가 자동 추가되어 있습니다.)</p>
      
      <div class="phone-box">
      <strong>[교육 진행자]</strong><br>
      ${formatPhoneList(eduPhonesToCopy)}
      <br><br>
      <strong>[등록새가족 중 교육 미진행]</strong><br>
      ${formatPhoneList(regPhonesToCopy)}
      </div>
    </body>
    </html>`;
  return html;
}

function formatPhoneNumber(phone) {
  if (!phone) return "";
  let p = String(phone).replace(/[^0-9]/g, '');
  if (p.length === 11) return p.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  if (p.length === 10) return p.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3');
  return phone;
}

function formatDateShort(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yy.MM.dd");
}

/**
 * 안전한 날짜 파싱 헬퍼 함수
 */
/**
 * 안전한 날짜 파싱 헬퍼 함수
 */
function parseDateSafely(dateValue) {
  if (!dateValue || String(dateValue).trim() === "") return null;
  if (dateValue instanceof Date) return dateValue;
  
  let str = String(dateValue).trim();
  str = str.replace(/\./g, '/').replace(/\s/g, '');
  if (str.endsWith('/')) str = str.slice(0, -1);
  
  let d = new Date(str);
  
  // V8 엔진의 연도 파싱 오류 방어
  if (d && !isNaN(d.getTime())) {
    let yr = d.getFullYear();
    // 1. "3/8" 입력 시 2001년으로 파싱되는 문제 방어
    if (yr === 2001) {
      d.setFullYear(new Date().getFullYear());
    } 
    // 2. "26.3.8" 입력 시 1926년으로 파싱되는 문제 방어 (2026으로 보정)
    else if (yr >= 1900 && yr < 2000) {
      d.setFullYear(yr + 100);
    }
  }
  
  return isNaN(d.getTime()) ? null : d;
}
