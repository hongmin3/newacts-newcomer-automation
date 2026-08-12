function syncIntensiveTraining() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const intensiveSheet = ss.getSheetByName('26년 집중교육');
  const attendanceSheet = ss.getSheetByName('교육 출석 현황');

  // 데이터 범위 가져오기 (첫 번째 행인 헤더는 제외)
  const intensiveData = intensiveSheet.getRange(2, 1, intensiveSheet.getLastRow() - 1, intensiveSheet.getLastColumn()).getValues();
  const attendanceData = attendanceSheet.getRange(2, 1, attendanceSheet.getLastRow() - 1, attendanceSheet.getLastColumn()).getValues();

  // '교육 출석 현황' 시트의 이름과 핸드폰 번호를 기준으로 기존 행 번호를 저장하는 객체 생성
  // 인덱스: E열 이름(4), G열 핸드폰(6)
  let attendanceMap = {};
  for (let i = 0; i < attendanceData.length; i++) {
    let name = attendanceData[i][4];
    let phone = attendanceData[i][6];
    if (name && phone) {
      attendanceMap[name + phone] = i + 2; // 배열 인덱스(0) + 헤더(1) = 2부터 시작하는 실제 행 번호
    }
  }

  for (let j = 0; j < intensiveData.length; j++) {
    let row = intensiveData[j];
    let id = row[0];           // A열: 1-n 형태 (예: 1-1)
    let group = row[1];        // B열: 군
    let team = row[2];         // C열: 팀
    let name = row[3];         // D열: 이름
    let phone = row[4];        // E열: 핸드폰
    let isAttended = row[5];   // F열: 참석 여부

    // 참석 여부가 'O'인 대상자만 필터링해서 처리
    if (isAttended === 'O') {
      
      // 1. A열(id)에서 '-' 앞의 숫자를 추출하여 분기 텍스트 생성
      let quarter = id.toString().split('-')[0];
      let quarterText = quarter + "분기 집중교육";

      let key = name + phone;

      if (attendanceMap[key]) {
        // 2. 이미 명단에 있는 경우 (기존 출석 업데이트)
        let targetRow = attendanceMap[key];

        // 1~3주차(H, I, J열) 기존 데이터 확인
        let current1 = attendanceSheet.getRange(targetRow, 8).getValue(); 
        let current2 = attendanceSheet.getRange(targetRow, 9).getValue(); 
        let current3 = attendanceSheet.getRange(targetRow, 10).getValue();

        // 비어있는 주차에만 'O' 채우기
        if (!current1) attendanceSheet.getRange(targetRow, 8).setValue('O');
        if (!current2) attendanceSheet.getRange(targetRow, 9).setValue('O');
        if (!current3) attendanceSheet.getRange(targetRow, 10).setValue('O');

        // 4주차(K열)에 "n분기 집중교육" 텍스트 덮어쓰기
        attendanceSheet.getRange(targetRow, 11).setValue(quarterText);

      } else {
        // 3. 명단에 없는 경우 (새로운 행으로 추가)
        // 시트 구조: [ㄱ, 예배, 군, 팀, 이름, 성별, 핸드폰, 1주차, 2주차, 3주차, 4주차, 문자공지, 비고]
        let newRow = ['', '', group, team, name, '', phone, 'O', 'O', 'O', quarterText, '', ''];
        attendanceSheet.appendRow(newRow);

        // 새롭게 추가된 사람도 Map에 기록하여 스크립트 내에서 중복 추가되는 것을 방지
        attendanceMap[key] = attendanceSheet.getLastRow();
      }
    }
  }
}
