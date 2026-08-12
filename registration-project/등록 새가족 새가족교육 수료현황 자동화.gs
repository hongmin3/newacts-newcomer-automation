/**
 * 새가족 데이터 동기화 및 군별 심층 통계 시스템 (최종_리포트_개선)
 * 작성자: 김홍민 부장님을 위한 AI 비서
 */

// ================= [설 정] =================
const CONFIG = {
  // 1. 스프레드시트 ID
  REG_SPREADSHEET_ID: '1dBO4rhCCadxO-KVBX_Jmg4aDcV9zim_sqM95JKd4Snk',
  EDU_SPREADSHEET_ID: '1EEIAL39SgRtO1JTe8zpZ4qDMCf_qF-bfrtxn6jfpLgg',

  // 2. 이메일 수신자 설정 (분기 처리)
  DISCREPANCY_RECIPIENT: 'ksj747172@gmail.com', // 불일치/자동업데이트 알림 받는 사람 (1명)
  ADMIN_EMAILS: ['ksj747172@gmail.com', 'rayo072@naver.com' , 'rnrnwkddn@naver.com', 'wnehdrms123@naver.com', 'whduswn94@naver.com'], // 전체 통계 받는 사람

  // 3. 조회 시작 기준일 (이 날짜 이전 데이터는 통계 기간에서 제외)
  START_CUTOFF_DATE: '2025-12-28',

  // 4. [유지보수용 설정] 방문자 조회 시트명 및 기간설정 (상반기 <-> 하반기 전환용)
  USE_VISITOR_REPORT: false,  // 💡 true면 방문자 명단 포함, false면 제외 (카운팅 기간에만 true로 변경)
  VISITOR_SHEET_NAME: '상반기 방문 새가족',
  VISITOR_START_DATE: '2026-03-01',
  VISITOR_END_DATE: '2026-06-30'
};

// 5. 각 군별 대표 이메일 매핑

/*
const GROUP_EMAIL_MAP = {
  '신': 'ksj747172@gmail.com',
  '조': 'ksj747172@gmail.com',
  '총': 'ksj747172@gmail.com',
  '석': 'ksj747172@gmail.com',
  '전': 'ksj747172@gmail.com',
  '명': 'ksj747172@gmail.com',
  '임': 'ksj747172@gmail.com',
  '슬': 'ksj747172@gmail.com',
  '영': 'ksj747172@gmail.com'
};
 */

const GROUP_EMAIL_MAP = {
  '신': 'smk941129@gmail.com',
  '조': 'kmc7758@naver.com',
  '총': 'eomchong@icloud.com',
  '석': 'hwoneeeeee@gmail.com',
  '전': 'jbr0196@naver.com',
  '명': 'jun607@naver.com',
  '임': 'dkssud2521@naver.com',
  '슬': 'l__seul@naver.com',
  '영': 'revlee0956@gmail.com'
};

// ===========================================

function runSystem() {
  try {
    syncNewFamilyData();
    SpreadsheetApp.flush(); 
    sendWeeklyReports();
  } catch (error) {
    // 🚨 에러 발생 시 부장님께 즉시 원인 메일 발송
    Logger.log("에러 내용: " + error.toString());
    try {
      MailApp.sendEmail({
        to: CONFIG.DISCREPANCY_RECIPIENT,
        subject: "🚨 [새가족부 시스템] 스크립트 실행 에러 보고",
        body: "부장님, 시스템 실행 중 에러가 발생했습니다.\n\n" +
              "에러 상세 내용:\n" + error.toString() + "\n\n" +
              "발생 위치(줄 번호):\n" + error.stack
      });
    } catch (mailError) {
      Logger.log("에러 메일 발송 실패 (일일 메일 발송 한도 초과일 가능성 높음)");
    }
    throw error; // 화면에도 에러 표시
  }
}

/**
 * 1. 데이터 동기화 및 자동 업데이트
 */
function syncNewFamilyData() {
  const regSpreadsheet = SpreadsheetApp.openById(CONFIG.REG_SPREADSHEET_ID);
  const eduSpreadsheet = SpreadsheetApp.openById(CONFIG.EDU_SPREADSHEET_ID);
  const regSheet = regSpreadsheet.getSheetByName('등록 새가족');
  const targetSheet = regSpreadsheet.getSheetByName('새가족교육 수료현황');
  const eduSheet = eduSpreadsheet.getSheetByName('교육 출석 현황');

  if (!regSheet || !targetSheet || !eduSheet) return;
  
  if (regSheet.getLastRow() <= 1 || eduSheet.getLastRow() <= 1) return;
  
  const oldData = targetSheet.getDataRange().getValues();
  const backupMap = {}; 
  
  if (oldData.length > 1) {
    for (let i = 1; i < oldData.length; i++) {
      const row = oldData[i];
      const phone = normalizePhone(row[6]); 
      const msgX = row[12]; 
      const note = row[14]; 
      
      if (phone) backupMap[phone] = { msgX: msgX, note: note };
    }
  }
  
  const regData = regSheet.getRange(2, 1, regSheet.getLastRow() - 1, regSheet.getLastColumn()).getValues();
  const eduData = eduSheet.getRange(2, 1, eduSheet.getLastRow() - 1, eduSheet.getLastColumn()).getValues();

  const eduMapByPhone = {};
  const eduMapByName = {};
  eduData.forEach(row => {
    const phone = normalizePhone(row[6]); 
    const name = normalizeName(row[4]);
    if (phone) eduMapByPhone[phone] = row;
    if (name) eduMapByName[name] = row;
  });

  const outputData = [];
  const autoUpdates = []; 

  regData.forEach((row, index) => {
    const regDate = row[1];
    const regWorship = row[2];
    let regGroup = row[3];     
    let regTeam = row[4];      
    const regNameRaw = row[5];
    const regGender = row[6];
    let regPhoneRaw = row[9];  

    if (!regNameRaw && !regPhoneRaw) return;

    const phoneKey = normalizePhone(regPhoneRaw);
    const nameKey = normalizeName(regNameRaw);
    
    let matchedRow = null;
    
    if (phoneKey && eduMapByPhone[phoneKey]) {
      matchedRow = eduMapByPhone[phoneKey];
    } else if (nameKey && eduMapByName[nameKey]) {
      const candidateRow = eduMapByName[nameKey];
      const candidatePhone = normalizePhone(candidateRow[6]); 

      if (phoneKey && candidatePhone && phoneKey !== candidatePhone) {
        matchedRow = null; 
      } else {
        matchedRow = candidateRow;
      }
    }

    let w1='', w2='', w3='', w4='';
    if (matchedRow) {
      const eduGroup = matchedRow[2]; 
      const eduTeam = matchedRow[3];  
      const eduPhone = matchedRow[6]; 
      
      let isUpdated = false;
      let updateLog = {
        name: regNameRaw,
        oldGroup: regGroup || '없음', newGroup: regGroup || '없음',
        oldTeam: regTeam || '없음', newTeam: regTeam || '없음',
        oldPhone: regPhoneRaw || '없음', newPhone: regPhoneRaw || '없음',
        changes: []
      };

      const actualRow = index + 2; 

      const cleanEduGroup = String(eduGroup).trim();
      const validGroups = ['석', '총', '신', '슬', '명', '전', '조', '영', '임', '군배정필요']; 
      
      const needsGroupUpdate = cleanEduGroup !== '' && validGroups.includes(cleanEduGroup) && (
        !regGroup || String(regGroup).includes('미정') || String(regGroup).includes('배정필요') || String(regGroup).trim() !== cleanEduGroup
      );

      if (needsGroupUpdate) {
        regSheet.getRange(actualRow, 4).setValue(cleanEduGroup); 
        regSheet.getRange(actualRow, 5).setValue(eduTeam || ''); 
        updateLog.newGroup = cleanEduGroup;
        updateLog.newTeam = eduTeam || '없음';
        regGroup = cleanEduGroup; 
        regTeam = eduTeam;   
        updateLog.changes.push('군/팀');
        isUpdated = true;
      }

      if (eduPhone && normalizePhone(regPhoneRaw) !== normalizePhone(eduPhone)) {
        regSheet.getRange(actualRow, 10).setValue(eduPhone || ''); 
        updateLog.newPhone = eduPhone;
        regPhoneRaw = eduPhone; 
        updateLog.changes.push('전화번호');
        isUpdated = true;
      }

      if (isUpdated) autoUpdates.push(updateLog);

      w1 = formatEduDate(matchedRow[7]);
      w2 = formatEduDate(matchedRow[8]);
      w3 = formatEduDate(matchedRow[9]);
      w4 = formatEduDate(matchedRow[10]);
    }
    
    let preservedMsgX = '';
    let preservedNote = '';
    const updatedPhoneKey = normalizePhone(regPhoneRaw);
    if (updatedPhoneKey && backupMap[updatedPhoneKey]) {
      preservedMsgX = backupMap[updatedPhoneKey].msgX !== undefined ? backupMap[updatedPhoneKey].msgX : ''; 
      preservedNote = backupMap[updatedPhoneKey].note !== undefined ? backupMap[updatedPhoneKey].note : '';
    }

    outputData.push([
      index + 1,      
      regGroup,       
      regTeam,        
      regWorship,     
      regNameRaw,     
      regGender,      
      regPhoneRaw,    
      regDate,        
      w1, w2, w3, w4, 
      preservedMsgX,  
      '',             
      preservedNote   
    ]);
  });

  if (targetSheet.getLastRow() > 1) targetSheet.getRange(2, 1, targetSheet.getLastRow() - 1, targetSheet.getLastColumn()).clearContent();
  
  if (outputData.length > 0 && outputData[0].length > 0) {
    targetSheet.getRange(2, 1, outputData.length, outputData[0].length).setValues(outputData);
  }
  
  if (autoUpdates.length > 0) {
    sendHtmlEmail([CONFIG.DISCREPANCY_RECIPIENT], "[새가족부] 등록현황 시트 자동 업데이트 완료 알림", createUpdateHtml(autoUpdates));
  }
}

/**
 * 2. 통계 리포트 생성 및 메일 전송
 */
function sendWeeklyReports() {
  const ss = SpreadsheetApp.openById(CONFIG.REG_SPREADSHEET_ID);
  const sheet = ss.getSheetByName('새가족교육 수료현황');
  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1);

  const today = new Date();
  const dateInfo = calculateDateRange(today); 
  const yyYear = today.getFullYear().toString().slice(-2);
  
  // [변경] 하이라이트 기간 설정 (오늘 기준 7일 전 ~ 어제까지)
  const highlightEnd = new Date(today);
  highlightEnd.setDate(today.getDate() - 1); 
  highlightEnd.setHours(23, 59, 59, 999);

  const highlightStart = new Date(today);
  highlightStart.setDate(today.getDate() - 7); 
  highlightStart.setHours(0, 0, 0, 0);

  const stats = { 'Total': createStatObject() };
  for (const g in GROUP_EMAIL_MAP) stats[g] = createStatObject();

  const assignmentNeededList = [];

  rows.forEach(row => {
    const groupRaw = row[1];
    const groupName = String(groupRaw).trim().charAt(0);
    const regDate = new Date(row[7]);
    
    if (String(groupRaw).includes("배정필요") || String(groupRaw).includes("군배정필요")) {
      assignmentNeededList.push({
        date: formatEduDate(regDate), worship: row[3], name: row[4], gender: row[5], phone: row[6]
      });
    }

    const eduDates = [row[8], row[9], row[10], row[11]].map(d => {
      if (!d) return null;
      if (d instanceof Date) return d;
      const parsed = new Date(d);
      return isNaN(parsed.getTime()) ? d : parsed;
    });
    
    // [변경] 파라미터에 highlightStart, highlightEnd 전달
    updateStats(stats['Total'], row, eduDates, regDate, dateInfo.start, dateInfo.end, highlightStart, highlightEnd);
    if (stats[groupName]) {
      updateStats(stats[groupName], row, eduDates, regDate, dateInfo.start, dateInfo.end, highlightStart, highlightEnd);
    }
  });

  // --- 상반기/하반기 방문 새가족 데이터 로드 및 처리 ---
  const visitorSheet = ss.getSheetByName(CONFIG.VISITOR_SHEET_NAME);
  let visitorRows = [];
  if (visitorSheet && visitorSheet.getLastRow() > 1) {
    visitorRows = visitorSheet.getRange(2, 1, visitorSheet.getLastRow() - 1, visitorSheet.getLastColumn()).getValues();
  }

  const vStart = new Date(CONFIG.VISITOR_START_DATE);
  const vEnd = new Date(CONFIG.VISITOR_END_DATE);
  vEnd.setHours(23, 59, 59, 999);

  const globalVisitorList = [];
  visitorRows.forEach(row => {
    const dateRaw = row[1];       // B열
    const groupRaw = row[3];      // D열
    const teamRaw = row[4];       // E열
    const nameRaw = row[5];       // F열
    const guideRaw = row[10];     // K열
    // [변경] N열(13)에서 M열(12)로 중복 체크 컬럼 인덱스 수정
    const duplicateRaw = row[12]; 
    
    if (!nameRaw || !dateRaw) return;
    
    if (String(duplicateRaw).trim().toUpperCase() === 'O') return;
    
    const vDate = parseVisitorDate(dateRaw);
    if (!vDate || vDate < vStart || vDate > vEnd) return;
    
    const dateStr = formatEduDate(vDate);
    // [변경] 방문 날짜가 지난 일주일 내에 있는지 체크하여 하이라이트 적용
    globalVisitorList.push({
      dateStr: dateStr,
      group: String(groupRaw).trim(),
      team: String(teamRaw).trim(),
      name: String(nameRaw).trim(),
      guide: String(guideRaw).trim(),
      isHighlight: (vDate >= highlightStart && vDate <= highlightEnd) 
    });
  });

  stats['Total'].visitorList = globalVisitorList;
  for (const g in GROUP_EMAIL_MAP) {
    stats[g].visitorList = globalVisitorList.filter(v => v.group.charAt(0) === g);
  }

  const totalSubject = `[새가족부] ${yyYear}년 등록자 전체 새가족교육 수료 통계 현황`;
  sendHtmlEmail(CONFIG.ADMIN_EMAILS, totalSubject, generateReportHtml('전체', stats['Total'], dateInfo));

  for (const [groupName, email] of Object.entries(GROUP_EMAIL_MAP)) {
    const groupStat = stats[groupName];
    if (groupStat && (groupStat.totalReg > 0 || groupStat.visitorList.length > 0)) { 
      const groupSubject = `[새가족부] ${yyYear}년 등록자 ${groupName}군 새가족교육 수료 통계 현황`;
      sendHtmlEmail([email], groupSubject, generateReportHtml(`${groupName}군`, groupStat, dateInfo));
      Utilities.sleep(10000); 
    }
  }

  if (assignmentNeededList.length > 0) {
    sendHtmlEmail(CONFIG.ADMIN_EMAILS, "[알림] 군 배정 필요 새가족 명단", createAssignmentHtml(assignmentNeededList));
  }
}

// === 로직 함수 및 유틸리티 ===

function createStatObject() {
  return {
    totalReg: 0, totalComp: 0, periodReg: 0, periodComp: 0, recentAttended: 0, periodList: [], gradList: [], visitorList: []      
  };
}

function updateStats(statObj, row, eduDates, regDate, startDate, endDate, highlightStart, highlightEnd) {
  statObj.totalReg++;
  const isCompleted = eduDates[3] !== null; 
  
  // [변경] 최근 7일(지난 일주일) 내에 등록했거나 교육을 받은 이력이 있는지 판별
  let isHighlight = (regDate >= highlightStart && regDate <= highlightEnd);
  eduDates.forEach(d => {
    if (d) {
      const ed = new Date(d);
      if (ed >= highlightStart && ed <= highlightEnd) isHighlight = true;
    }
  });

  if (isCompleted) {
    statObj.totalComp++;
    statObj.gradList.push({
      worship: row[3], group: row[1], team: row[2], name: row[4], phone: row[6],
      regDateStr: formatEduDate(regDate), status: formatEduDate(eduDates[3]), isHighlight: isHighlight
    });
  }

  let participatedAtLeastOnce = false;
  eduDates.forEach(d => { if (d) participatedAtLeastOnce = true; });
  if (participatedAtLeastOnce) statObj.recentAttended++;

  if (regDate >= startDate && regDate <= endDate) {
    statObj.periodReg++;
    if (isCompleted) statObj.periodComp++;

    let statusText = "";
    if (isCompleted) {
      const isText = typeof eduDates[3] === 'string'; 
      const dispText = isText ? eduDates[3] : `수료완료(${formatEduDate(eduDates[3])})`;
      statusText = `<span style="color:blue; font-weight:bold;">${dispText}</span>`;
    } else {
      let progressStr = [];
      eduDates.forEach((d, idx) => { if (d) progressStr.push(`${idx+1}주`); });
      statusText = progressStr.length > 0 ? progressStr.join(', ') : `<span style="color:#ff6b6b">미참여</span>`;
    }

    let recentEduStr = '-';
    for (let i = 3; i >= 0; i--) {
      if (eduDates[i]) {
        recentEduStr = `${i + 1}주차(${formatEduDate(eduDates[i])})`;
        break;
      }
    }

    statObj.periodList.push({
      worship: row[3], group: row[1], team: row[2], name: row[4], phone: row[6],
      regDateStr: formatEduDate(regDate), recentEdu: recentEduStr, status: statusText, isHighlight: isHighlight
    });
  }
}

function generateReportHtml(title, data, dateInfo) {
  // [정렬 조건 변경] 4. 군-팀-등록일 순으로 정렬
  data.periodList.sort((a, b) => {
    const groupComp = String(a.group).localeCompare(String(b.group));
    if (groupComp !== 0) return groupComp;
    const teamComp = String(a.team).localeCompare(String(b.team));
    if (teamComp !== 0) return teamComp;
    return String(a.regDateStr).localeCompare(String(b.regDateStr));
  });

  data.gradList.sort((a, b) => {
    const groupComp = String(a.group).localeCompare(String(b.group));
    if (groupComp !== 0) return groupComp;
    const teamComp = String(a.team).localeCompare(String(b.team));
    if (teamComp !== 0) return teamComp;
    return String(a.regDateStr).localeCompare(String(b.regDateStr));
  });

  // [추가] 5. 방문자 데이터 군-팀-날짜 순으로 정렬
  data.visitorList.sort((a, b) => {
    const groupComp = String(a.group).localeCompare(String(b.group));
    if (groupComp !== 0) return groupComp;
    const teamComp = String(a.team).localeCompare(String(b.team));
    if (teamComp !== 0) return teamComp;
    return String(a.dateStr).localeCompare(String(b.dateStr));
  });

  // [변경] 2. 수식 및 항목 이름 전체 변경
  const totalRate = data.totalReg > 0 ? ((data.totalComp / data.totalReg) * 100).toFixed(1) : 0;
  const progressRate = data.totalReg > 0 ? ((data.recentAttended / data.totalReg) * 100).toFixed(1) : 0;

  return `
    <div style="font-family: 'Malgun Gothic', sans-serif; padding: 20px; color: #333;">
      <h2 style="border-bottom: 2px solid #4CAF50; padding-bottom: 10px;">📊 ${title} 새가족 교육 수료 현황</h2>
      <p><b>조회 범위:</b> ${dateInfo.label} (~ 직전 일요일: ${formatEduDate(dateInfo.end)})</p>
      
      <h3>1. 통계</h3>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%; max-width: 600px; text-align: center;">
        <tr style="background-color: #f2f2f2;"><th>항목</th><th>인원/수치</th></tr>
        <tr><td style="text-align:left;">총 등록 인원 (올해 전체)</td><td><b>${data.totalReg}명</b></td></tr>
        <tr><td style="text-align:left;">총 수료 인원 (올해 전체)</td><td><b>${data.totalComp}명</b></td></tr>
        <tr style="background-color: #e3f2fd;">
          <td style="text-align:left;"><b>총 수료율 (올해 전체)</b></td>
          <td style="color:blue;"><b>${totalRate}%</b></td>
        </tr>
        <tr>
          <td style="text-align:left;">등록자 중 교육 참여 인원 (1회 이상)</td>
          <td><b>${data.recentAttended}명</b></td>
        </tr>
        <tr style="background-color: #e8f5e9;">
          <td style="text-align:left;">
            <b>등록자 새가족 교육 진행율</b><br>
            <span style="font-size:11px; color:gray;">(등록자 중 참여인원) / (총 등록 인원)</span>
          </td>
          <td style="color:green;"><b>${progressRate}%</b></td>
        </tr>
      </table>

      <h3>2. 모든 등록자 중 새가족교육 참여자 명단 (${data.periodList.length}명)</h3>
      ${createPeriodTable(data.periodList)}

      <h3>3. 올해 수료자 명단 (${data.gradList.length}명)</h3>
      ${createGradTable(data.gradList)}

      ${CONFIG.USE_VISITOR_REPORT ? `
        <h3>4. 상반기 방문자 현황 (${data.visitorList.length}명)</h3>
        <p style="font-size:11px; color:gray; margin-top:-5px;">* 조회 기간: ${CONFIG.VISITOR_START_DATE} ~ ${CONFIG.VISITOR_END_DATE}</p>
        ${createVisitorTable(data.visitorList)}
      ` : ''}
     </div>
   `;
}

// [변경] 최근 교육 진행 현황 열이 반영된 참여자 리스트 표 디자인 및 6번 강조(볼드+파란색) 조건식 적용
function createPeriodTable(list) {
  if (list.length === 0) return '<p style="color:gray;">해당 인원이 없습니다.</p>';
  let rows = list.map(p => {
    // 파란 글씨 대신 배경색을 노란색(#ffff00)으로 변경 (글자는 검은색 유지)
    const style = p.isHighlight ? ' style="background-color: #ffff00;"' : '';
    return `<tr${style}><td>${p.group}</td><td>${p.team}</td><td><b>${p.name}</b></td><td>${p.phone}</td><td>${p.regDateStr}</td><td>${p.recentEdu}</td><td>${p.status}</td></tr>`;
  }).join('');
  return `<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%; font-size: 13px; text-align: center;"><tr style="background-color: #eee;"><th>군</th><th>팀</th><th>이름</th><th>전화번호</th><th>등록일</th><th>최근 교육 진행 현황</th><th>교육 진행 현황</th></tr>${rows}</table>`;
}

function createGradTable(list) {
  if (list.length === 0) return '<p style="color:gray;">해당 인원이 없습니다.</p>';
  let rows = list.map(p => {
    // 파란 글씨 대신 배경색을 노란색(#ffff00)으로 변경
    const style = p.isHighlight ? ' style="background-color: #ffff00;"' : '';
    return `<tr${style}><td>${p.group}</td><td>${p.team}</td><td><b>${p.name}</b></td><td>${p.phone}</td><td>${p.regDateStr}</td><td>${p.status}</td></tr>`;
  }).join('');
  return `<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%; font-size: 13px; text-align: center;"><tr style="background-color: #eee;"><th>군</th><th>팀</th><th>이름</th><th>전화번호</th><th>등록일</th><th>수료날짜</th></tr>${rows}</table>`;
}

// [추가] 5번 및 6번 규칙이 적용된 방문자 현황 전용 표 렌더링 함수
function createVisitorTable(list) {
  if (list.length === 0) return '<p style="color:gray;">해당 범위 내에 방문한 인원이 없습니다.</p>';
  let rows = list.map(v => {
    const style = v.isHighlight ? ' style="background-color: #ffff00;"' : '';
    // [변경] 데이터 출력 순서를 군 -> 팀 -> 날짜 순으로 바꿨습니다.
    return `<tr${style}><td>${v.group}</td><td>${v.team}</td><td>${v.dateStr}</td><td><b>${v.name}</b></td><td>${v.guide}</td></tr>`;
  }).join('');
  // [변경] 표 헤더(제목) 순서를 군 -> 팀 -> 날짜 순으로 바꿨습니다.
  return `<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%; font-size: 13px; text-align: center;"><tr style="background-color: #eee;"><th>군</th><th>팀</th><th>날짜</th><th>방문자 이름</th><th>인도자</th></tr>${rows}</table>`;
}

// [변경] 최근 16주 기반 조회를 탈피하여 전체 누적 명단을 가져오도록 변경
function calculateDateRange(today) {
  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - today.getDay());
  lastSunday.setHours(23, 59, 59, 999);

  const cutoffParts = CONFIG.START_CUTOFF_DATE.split('-');
  const startDate = new Date(cutoffParts[0], cutoffParts[1] - 1, cutoffParts[2]); 
  startDate.setHours(0, 0, 0, 0);

  return { start: startDate, end: lastSunday, label: '올해 전체 명단' };
}

// [추가] 다양한 형태의 방문 날짜 포맷팅(5/17 텍스트형 또는 Date형 호환 가능) 보정 유틸리티
function parseVisitorDate(dateVal) {
  if (dateVal instanceof Date) return dateVal;
  if (!dateVal) return null;
  const str = String(dateVal).trim();
  if (str.includes('/')) {
    const parts = str.split('/');
    return new Date(2026, parseInt(parts[0], 10) - 1, parseInt(parts[1], 10));
  }
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function createAssignmentHtml(list) {
  let rows = list.map(p => `<tr><td>${p.date}</td><td>${p.worship}</td><td><b>${p.name}</b></td><td>${p.gender}</td><td>${p.phone}</td></tr>`).join('');
  return `<h3 style="color:red;">🚨 군 배정 필요 인원</h3><table border="1" cellpadding="5" style="border-collapse:collapse;">${rows}</table>`;
}

function createUpdateHtml(list) {
  let rows = list.map(item => {
    const groupDisplay = item.changes.includes('군/팀') ? `<strike style="color:#999;">${item.oldGroup}/${item.oldTeam}</strike><br><b style="color:blue;">${item.newGroup}/${item.newTeam}</b>` : `${item.newGroup}/${item.newTeam}`;
    const phoneDisplay = item.changes.includes('전화번호') ? `<strike style="color:#999;">${item.oldPhone}</strike><br><b style="color:blue;">${item.newPhone}</b>` : `${item.newPhone}`;
    return `<tr><td><b>${item.name}</b></td><td style="color:#d32f2f; font-weight:bold;">${item.changes.join(', ')}</td><td>${groupDisplay}</td><td>${phoneDisplay}</td></tr>`;
  }).join('');
  return `<div style="padding: 20px;"><h3 style="color:#4CAF50;">✅ 시트 자동 업데이트 알림</h3><table border="1" cellpadding="8" style="border-collapse: collapse; text-align: center;"><tr><th>이름</th><th>항목</th><th>군/팀 정보</th><th>전화번호</th></tr>${rows}</table></div>`;
}

function sendHtmlEmail(recipients, subject, htmlBody) {
  recipients.forEach(email => MailApp.sendEmail({ to: email, subject: subject, htmlBody: htmlBody }));
}

function normalizeName(name) { return name ? String(name).replace(/[a-zA-Z]/g, '').replace(/\s+/g, '') : ''; }
function normalizePhone(phone) { return phone ? String(phone).replace(/[^0-9]/g, '') : ''; }
function formatEduDate(dateVal) { 
  if (!dateVal) return '';
  if (dateVal instanceof Date) return isNaN(dateVal.getTime()) ? '' : Utilities.formatDate(dateVal, "GMT+9", "yyyy-MM-dd");
  return String(dateVal);
}
