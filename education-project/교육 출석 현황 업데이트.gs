/**
 * 설정값
 */
const CONFIG = {
  MASTER_SHEET_ID: '1EEIAL39SgRtO1JTe8zpZ4qDMCf_qF-bfrtxn6jfpLgg', 
  MASTER_TAB_NAME: '교육 출석 현황',
  // [수정됨] 통합된 하나의 응답 시트 ID를 여기에 입력하세요.
  SOURCE_ID: '1PKQY3wVgSpk6SqJa9dCyCAV54CIzZF03d-ePReFGwxs', 
  ADMIN_EMAIL: 'ksj747172@gmail.com, kimth6805@gmail.com, rnrnwkddn@naver.com, wnehdrms123@naver.com, whduswn94@naver.com'
};

function main() {
  if (CONFIG.SOURCE_ID.includes('여기에')) {
    Browser.msgBox("오류: CONFIG 변수의 SOURCE_ID를 확인해주세요.");
    return;
  }

  // 1. 실행일 기준 '지난 일요일' 날짜
  const targetDate = getLastSundayDate(); 
  Logger.log(`[시작] 타겟 날짜: ${targetDate}`);

  // 2. 통합 시트 출석 동기화 처리
  const result = syncAttendance(targetDate);

  // 3. 결과 집계
  const totalProcessed = result.processed[4] + result.processed[5];
  const totalErrors = result.errors.length;
  const totalDuplicates = result.duplicates.length;
  const totalInfoChanges = result.infoChanges.length;
  const totalPhoneMismatches = result.phoneMismatches.length;
  const totalUndecided = result.undecided.length; 

  // 알림 로직
  // 데이터가 아예 없는 경우 (휴강 체크)
  if (totalProcessed === 0 && totalErrors === 0 && totalDuplicates === 0 && totalPhoneMismatches === 0) {
    const urlMaster = `https://docs.google.com/spreadsheets/d/${CONFIG.MASTER_SHEET_ID}`;
    const urlSource = `https://docs.google.com/spreadsheets/d/${CONFIG.SOURCE_ID}`;
    
    const bodyText = `${targetDate} (일요일) 날짜로 접수된 새가족 교육 출석 데이터가 없습니다.\n휴강 주간이거나 접수된 인원이 없는지 확인바랍니다.`;
    
    const htmlBody = `
      <div style="font-family: Arial, sans-serif;">
        <p>${targetDate} (일요일) 날짜로 접수된 새가족 교육 출석 데이터가 없습니다.<br>
        휴강 주간이거나 접수된 인원이 없는지 확인바랍니다.</p>
        <hr>
        <strong>[바로가기]</strong><br>
        1. <a href="${urlMaster}">새가족 교육 현황</a><br>
        2. <a href="${urlSource}">통합 응답 시트</a>
      </div>
    `;
    MailApp.sendEmail({
      to: CONFIG.ADMIN_EMAIL,
      subject: `[알림] ${targetDate} 새가족 교육 데이터 없음`,
      body: bodyText,
      htmlBody: htmlBody
    });
  }
  // 이슈가 하나라도 있으면 리포트 발송
  else if (totalErrors > 0 || totalDuplicates > 0 || totalInfoChanges > 0 || totalPhoneMismatches > 0 || totalUndecided > 0 || totalProcessed > 0) {
    sendReportEmail(targetDate, result);
  }
}

function syncAttendance(targetDateString) {
  let result = {
    processed: { 4: 0, 5: 0 }, // 4부, 5부 각각 카운트
    errors: [],        
    duplicates: [],    
    infoChanges: [],    
    phoneMismatches: [], 
    undecided: []       
  };

  try {
    const masterSS = SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
    const masterSheet = masterSS.getSheetByName(CONFIG.MASTER_TAB_NAME);
    const sourceSS = SpreadsheetApp.openById(CONFIG.SOURCE_ID);
    const sourceSheet = sourceSS.getSheets()[0];
    
    const sourceData = sourceSheet.getDataRange().getValues();
    const masterData = masterSheet.getDataRange().getValues();
    
    // 컬럼 인덱스
    const COL_TIMESTAMP = 0;
    const COL_WEEK = 2;
    const COL_NAME = 4;
    const COL_PHONE = 5;
    const COL_GENDER = 6;
    const COL_GUN = 8;
    const COL_TEAM = 9;
    
    // 소스 데이터 반복
    for (let i = 1; i < sourceData.length; i++) {
      const row = sourceData[i];
      if (row.length === 0 || row[0] === "") continue;

      // 1. 날짜 필터링 (지난 일요일 날짜와 같은 데이터만 처리)
      const timestampObj = new Date(row[COL_TIMESTAMP]);
      const rowDate = formatDate(timestampObj);
      if (rowDate !== targetDateString) continue;

      // [핵심 변경] 타임스탬프 시간 기준으로 4/5부 분류
      const hours = timestampObj.getHours();
      const minutes = timestampObj.getMinutes();
      const timeInMinutes = hours * 60 + minutes;
      
      // 13:30 (13 * 60 + 30 = 810분) 기준으로 이전이면 4부, 이후면 5부
      const serviceType = timeInMinutes < 810 ? 4 : 5;

      const rawWeek = String(row[COL_WEEK]);
      const name = row[COL_NAME];
      const rawPhone = String(row[COL_PHONE]);
      const gender = transformGender(row[COL_GENDER]);
      const phone = transformPhone(rawPhone);
      const gun = transformGun(row[COL_GUN]);
      const team = transformTeam(row[COL_TEAM]);
      const weekNum = parseInt(rawWeek.replace(/[^0-9]/g, "")); 

      try {
        if (isNaN(weekNum)) throw new Error("주차 정보 파싱 실패");

        // 군/팀 미정 체크
        if (gun === "미정" || team === "미정") {
          result.undecided.push({
            service: serviceType,
            name: name,
            week: rawWeek,
            gun: gun,
            team: team
          });
        }

        // --- [검색 1단계] 이름 + 전화번호로 찾기 ---
        let foundRowIndex = -1;
        for (let m = masterData.length - 1; m >= 1; m--) {
          const mName = masterData[m][4]; 
          const mPhone = String(masterData[m][6]);
          if (mName === name && mPhone === phone) {
            foundRowIndex = m + 1;
            break;
          }
        }

        // --- [검색 2단계] 없으면 이름으로만 찾기 (번호 불일치 감지용) ---
        if (foundRowIndex === -1 && weekNum > 1) {
          let nameMatches = [];
          for (let m = masterData.length - 1; m >= 1; m--) {
            if (masterData[m][4] === name) {
              nameMatches.push({ index: m + 1, phone: String(masterData[m][6]) });
            }
          }
          
          if (nameMatches.length === 1) {
            result.phoneMismatches.push({
              service: serviceType,
              name: name,
              inputPhone: phone,
              masterPhone: nameMatches[0].phone,
              week: rawWeek
            });
            continue; 
          }
        }

        // [로직 분기]
        if (weekNum === 1) {
          if (foundRowIndex === -1) {
            // [신규 추가]
            const lastRow = masterSheet.getLastRow();
            let newNo = 1;
            if (lastRow > 1) {
               const lastNo = masterSheet.getRange(lastRow, 1).getValue();
               if (!isNaN(lastNo) && typeof lastNo === 'number') newNo = lastNo + 1;
            }
            masterSheet.appendRow([
              newNo, serviceType, gun, team, name, gender, phone,
              targetDateString, "", "", ""
            ]);
            result.processed[serviceType]++;

          } else {
            // [중복 확인] 
            checkAndUpdate(masterSheet, foundRowIndex, 8, targetDateString, result, name, phone, rawWeek, serviceType);
            updateGroupInfoIfChanged(masterSheet, foundRowIndex, gun, team, name, phone, result, serviceType);
          }
        } else {
          // [2~4주차]
          if (foundRowIndex === -1) throw new Error(`[데이터 없음] 명단에 없는 인원`);

          updateGroupInfoIfChanged(masterSheet, foundRowIndex, gun, team, name, phone, result, serviceType);

          const targetCol = 8 + (weekNum - 1);
          
          // 순서 체크
          const attendanceRange = masterSheet.getRange(foundRowIndex, 8, 1, 4); 
          const attendanceValues = attendanceRange.getValues()[0];
          let isSequenceValid = true;
          for (let w = 0; w < weekNum - 1; w++) {
            if (attendanceValues[w] === "") {
              isSequenceValid = false;
              break;
            }
          }
          if (!isSequenceValid) throw new Error(`[순서 오류] 이전 주차 누락`);

          // [업데이트]
          checkAndUpdate(masterSheet, foundRowIndex, targetCol, targetDateString, result, name, phone, rawWeek, serviceType);
        }

      } catch (e) {
        result.errors.push({ service: serviceType, name: name, phone: phone, week: rawWeek, reason: e.message });
      }
    }
    return result;

  } catch (e) {
    Logger.log(`[시스템 오류]: ${e.message}`);
    result.errors.push({ service: "시스템", name: "-", phone: "-", week: "-", reason: `실행 중단: ${e.message}` });
    return result;
  }
}

// --- 중복 체크 및 업데이트 함수 ---
function checkAndUpdate(sheet, rowIndex, colIndex, dateStr, resultObj, name, phone, week, serviceType) {
  const existingDate = sheet.getRange(rowIndex, colIndex).getValue();
  
  if (existingDate !== "") {
    resultObj.duplicates.push({ service: serviceType, name: name, phone: phone, week: week, currentVal: formatDate(existingDate) });
  } else {
    sheet.getRange(rowIndex, colIndex).setValue(dateStr);
    resultObj.processed[serviceType]++;
  }
}

// --- 군/팀 변경 확인 및 업데이트 함수 ---
function updateGroupInfoIfChanged(sheet, rowIndex, newGun, newTeam, name, phone, resultObj, serviceType) {
  const currentGun = sheet.getRange(rowIndex, 3).getValue();
  const currentTeam = sheet.getRange(rowIndex, 4).getValue();

  if (currentGun !== newGun || currentTeam !== newTeam) {
    sheet.getRange(rowIndex, 3).setValue(newGun);
    sheet.getRange(rowIndex, 4).setValue(newTeam);
    
    resultObj.infoChanges.push({
      service: serviceType,
      name: name,
      phone: phone,
      oldInfo: `${currentGun}/${currentTeam}`,
      newInfo: `${newGun}/${newTeam}`
    });
  }
}

// --- Helper Functions ---
function getLastSundayDate() {
  const date = new Date(); 
  const day = date.getDay(); 
  const diff = day === 0 ? 0 : day; 
  date.setDate(date.getDate() - diff);
  return Utilities.formatDate(date, "Asia/Seoul", "yyyy-MM-dd");
}

function transformPhone(str) {
  if (!str) return "";
  const cleanStr = str.replace(/[^0-9]/g, '');
  if (cleanStr.length === 11) {
    return cleanStr.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  }
  return str;
}

function transformGender(str) {
  if (!str) return "";
  if (str.includes("남자")) return "남";
  if (str.includes("여자")) return "여";
  return str;
}

function transformGun(str) {
  if (!str) return "미정";
  if (str.includes("모르겠")) return "미정";
  return str.substring(0, 1);
}

function transformTeam(str) {
  if (!str) return "미정";
  if (str.includes("모르겠")) return "미정";
  return str.split('(')[0].trim();
}

function formatDate(dateObj) {
  if (!dateObj) return "";
  return Utilities.formatDate(new Date(dateObj), "Asia/Seoul", "yyyy-MM-dd");
}

// 통합 리포트 메일 발송
function sendReportEmail(dateStr, res) {
  const subject = `[자동화 결과] ${dateStr} 새가족 출석부 정리 리포트`;
  
  let body = `[${dateStr} 처리 현황]\n`;
  body += `4부 - 성공: ${res.processed[4]}\n`;
  body += `5부 - 성공: ${res.processed[5]}\n\n`;

  // 1. 군/팀 변경 내역
  if (res.infoChanges.length > 0) {
    body += `■ [정보 변경] 군/팀 정보가 최신 데이터로 업데이트됨\n`;
    res.infoChanges.forEach(item => {
      body += `- [${item.service}부] ${item.name}: ${item.oldInfo} -> ${item.newInfo}\n`;
    });
    body += `\n`;
  }

  // 2. 군/팀 미정(잘 모르겠어요) 입력자
  if (res.undecided.length > 0) {
    body += `■ [확인 필요] 군/팀 '미정' 입력자 (새가족부 확인 요망)\n`;
    body += `(설문에 '잘 모르겠어요' 등으로 체크한 인원입니다)\n`;
    res.undecided.forEach(item => {
      body += `- [${item.service}부] ${item.name} (${item.week}): ${item.gun}/${item.team}\n`;
    });
    body += `\n`;
  }

  // 3. 전화번호 불일치
  if (res.phoneMismatches.length > 0) {
    body += `■ [번호 불일치] 이름은 같으나 전화번호가 다른 인원 (확인 필요)\n`;
    body += `(안전을 위해 자동 입력하지 않았습니다. 확인 후 수동 처리 바랍니다.)\n`;
    res.phoneMismatches.forEach(item => {
      body += `- [${item.service}부] 이름: ${item.name} (${item.week})\n`;
      body += `   명단 번호: ${item.masterPhone}\n`;
      body += `   입력 번호: ${item.inputPhone}\n`;
    });
    body += `\n`;
  }

  // 4. 이미 기재되어 건너뛴 명단
  if (res.duplicates.length > 0) {
    body += `■ [알림] 이미 출석표에 기재되어 있어 건너뛴 인원\n`;
    res.duplicates.forEach(item => {
      body += `- [${item.service}부] ${item.name} (${item.week}): 기존값 [${item.currentVal}] 존재\n`;
    });
    body += `\n`;
  }

  // 5. 처리 중 오류 발생 명단
  if (res.errors.length > 0) {
    body += `■ [오류] 자동 입력 실패 (확인 필요)\n`;
    res.errors.forEach(item => {
      body += `- [${item.service}부] ${item.name} (${item.phone}): ${item.week} -> 사유: ${item.reason}\n`;
    });
    body += `\n`;
  }

  const urlMaster = `https://docs.google.com/spreadsheets/d/${CONFIG.MASTER_SHEET_ID}`;
  const urlSource = `https://docs.google.com/spreadsheets/d/${CONFIG.SOURCE_ID}`;

  const htmlBody = `
    <div style="font-family: Arial, sans-serif;">
      <h3>📊 시트 바로가기</h3>
      <ul>
        <li><a href="${urlMaster}" target="_blank"><strong>[마스터] 새가족 교육관리 시트</strong></a></li>
        <li><a href="${urlSource}" target="_blank">통합 출석 응답 시트</a></li>
      </ul>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <h3>📋 상세 리포트</h3>
      <pre style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; font-family: monospace; white-space: pre-wrap;">${body}</pre>
    </div>
  `;

  MailApp.sendEmail({
    to: CONFIG.ADMIN_EMAIL,
    subject: subject,
    body: body,         
    htmlBody: htmlBody  
  });
}
