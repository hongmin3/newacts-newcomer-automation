/**
 * 새가족 집중교육 신청 자동화 시스템
 * ------------------------------------------------------
 * 사용법:
 * 1) script.google.com 에서 새 프로젝트 생성
 * 2) 이 파일 전체를 복사해서 붙여넣기
 * 3) 함수 선택 드롭다운에서 setupSystem 선택 후 실행(▶)
 * 4) 최초 실행 시 나오는 Google 권한 승인 화면에서 허용
 * 5) 실행 로그(보기 > 로그, 또는 Ctrl/Cmd+Enter)에서 생성된 링크 확인
 *
 * 다시 실행해도 안전하도록 스크립트 속성(Properties)에 생성 여부를 기록합니다.
 * 새로 다시 만들고 싶으면 resetSystemProperties()를 먼저 실행하세요.
 * (단, 이미 만들어진 시스템 폴더와 파일 자체는 Drive에서 직접 삭제해야 합니다.)
 */

/************************ 설정값 ************************/

const CONFIG = {
  SYSTEM_FOLDER_NAME: '새가족 집중교육 신청_자동화',
  FORM_TITLE: '새가족 집중교육 신청',
  FORM_DESCRIPTION:
    '새가족 집중교육 참석 신청을 위한 양식입니다.\n신청 정보를 정확하게 입력해주세요.\n\n' +
    '※ 오신청/중복신청 방지를 위해 새가족 본인이 아닌, 해당 팀 담당 팀장 또는 목양리더가 대신 신청해주세요.',
  ADMIN_SS_NAME: '새가족 집중교육 신청_관리자용(비공개)',
  PUBLIC_SS_NAME: '새가족 집중교육 신청_공개확인용',
  RAW_SHEET_NAME: '집중교육_신청자_관리',
  ADMIN_VIEW_SHEET_NAME: '관리용_명단',
  PUBLIC_SHEET_NAME: '신청확인명단',
  PRIVACY_NOTICE:
    '[개인정보 수집 및 이용 안내]\n' +
    '- 수집 항목: 이름, 소속 군/팀, 전화번호\n' +
    '- 이용 목적: 새가족 집중교육 신청 및 참석자 관리\n' +
    '- 보유 기간: 교육 운영 종료 후 관리 목적이 끝나면 삭제\n\n' +
    '위 내용에 동의하시는 분만 신청을 진행해 주세요.'
};

const GROUPS = ['신군', '조군', '명군', '총군', '영군', '석군', '임군', '전군', '슬군'];

const TEAMS_BY_GROUP = {
  '신군': ['가예', '하임', '아가', '예하'],
  '조군': ['보배'],
  '명군': ['예슈아', '에덴', '열매', '주전', '하이'],
  '총군': ['예비', '주품', '서사', '여신', '진리', '동행'],
  '영군': ['진토', '힐러', '하나', '주인', '새빛', '그날', '존귀'],
  '석군': ['두유', '퓨어', '여기', '구름', '솔라', '기회'],
  '임군': ['주하', '푸릇', '나무'],
  '전군': ['샤인', '나라', '로뎀', '여름', '이음'],
  '슬군': ['오예', '샘물', '보라', '하루']
};

const PHONE_REGEX = /^010-\d{4}-\d{4}$/;

// 각 문항 title. 응답 시트의 헤더명으로 사용되므로 변경 시 아래도 함께 수정할 것.
const Q = {
  APPLICANT: '신청자 이름',
  GROUP: '군',
  TEAM: '팀',
  ATTENDEE: '집중교육 참석자 이름',
  PHONE: '집중교육 참석자 전화번호'
};

/************************ 메인 설치 함수 ************************/

function setupSystem() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('FORM_ID')) {
    Logger.log('이미 설치되어 있습니다. 링크를 다시 보려면 printSystemInfo()를 실행하세요.');
    Logger.log('처음부터 새로 만들려면 resetSystemProperties()를 실행한 뒤 다시 setupSystem()을 실행하세요.');
    return;
  }

  const createdFileIds = [];
  let createdFolder = null;

  try {
  // 1) 세 파일을 담을 비공개 시스템 폴더 생성
  // 공개 폴더 아래에 관리자 파일을 두면 링크 공개 권한이 상속될 수 있으므로
  // 반드시 My Drive 루트에 새 비공개 폴더를 만듭니다.
  const systemFolder = DriveApp.createFolder(CONFIG.SYSTEM_FOLDER_NAME);
  createdFolder = systemFolder;
  systemFolder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);

  // 2) 관리자용 / 공개용 스프레드시트 생성
  const adminSs = SpreadsheetApp.create(CONFIG.ADMIN_SS_NAME);
  const publicSs = SpreadsheetApp.create(CONFIG.PUBLIC_SS_NAME);
  createdFileIds.push(adminSs.getId(), publicSs.getId());

  // 3) Form 생성 및 기본 설정
  const form = FormApp.create(CONFIG.FORM_TITLE);
  createdFileIds.push(form.getId());
  form.setDescription(CONFIG.FORM_DESCRIPTION);
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);
  form.setShowLinkToRespondAgain(true);

  // 생성한 세 파일을 비공개 시스템 폴더로 이동
  moveFileToFolder(form.getId(), systemFolder);
  moveFileToFolder(adminSs.getId(), systemFolder);
  moveFileToFolder(publicSs.getId(), systemFolder);

  // ---- Page 1: 신청자 이름 + 군 ----
  form
    .addTextItem()
    .setTitle(Q.APPLICANT)
    .setHelpText('새가족 본인이 아닌, 담당 팀장 또는 목양리더의 성함을 입력해주세요.')
    .setRequired(true);
  const groupItem = form.addMultipleChoiceItem().setTitle(Q.GROUP).setRequired(true);

  // ---- 군별 팀 선택 Section (임시 선택지로 먼저 생성) ----
  const groupPageMap = {};
  const teamItemMap = {};
  GROUPS.forEach(function (g) {
    const pageBreak = form.addPageBreakItem().setTitle(g + ' - 팀 선택');
    const teamItem = form.addMultipleChoiceItem().setTitle(Q.TEAM).setRequired(true);
    teamItem.setChoices(
      TEAMS_BY_GROUP[g].map(function (t) {
        return teamItem.createChoice(t);
      })
    );
    groupPageMap[g] = pageBreak;
    teamItemMap[g] = teamItem;
  });

  // 군 선택지에 분기(해당 군 Section으로 이동) 연결
  groupItem.setChoices(
    GROUPS.map(function (g) {
      return groupItem.createChoice(g, groupPageMap[g]);
    })
  );

  // ---- 마지막 Section: 참석자 정보 + 개인정보 동의 ----
  const finalPage = form.addPageBreakItem().setTitle('참석자 정보 입력');
  form.addTextItem().setTitle(Q.ATTENDEE).setRequired(true);

  const phoneItem = form
    .addTextItem()
    .setTitle(Q.PHONE)
    .setRequired(true)
    .setHelpText('예: 010-1234-5678 (숫자만 입력해도 자동으로 형식이 정리됩니다)');
  phoneItem.setValidation(
    FormApp.createTextValidation()
      .setHelpText('010으로 시작하는 휴대폰 번호를 입력해주세요. 예) 010-1234-5678 또는 01012345678')
      .requireTextMatchesPattern('^010-?\\d{4}-?\\d{4}$')
      .build()
  );

  const consentItem = form
    .addCheckboxItem()
    .setTitle('개인정보 수집 및 이용 동의')
    .setHelpText(CONFIG.PRIVACY_NOTICE)
    .setRequired(true);
  consentItem.setChoices([consentItem.createChoice('개인정보 수집 및 이용에 동의합니다.')]);

  // 각 군의 팀 선택지가 마지막 Section으로 이동하도록 재설정
  GROUPS.forEach(function (g) {
    const teamItem = teamItemMap[g];
    teamItem.setChoices(
      TEAMS_BY_GROUP[g].map(function (t) {
        return teamItem.createChoice(t, finalPage);
      })
    );
  });

  form.setConfirmationMessage(
    '새가족 집중교육 신청이 완료되었습니다.\n\n' +
      '신청 확인 명단을 통해 정상적으로 신청되었는지 확인해주세요.\n' +
      '※ 개인정보 보호를 위해 신청 확인 명단에는 전화번호가 표시되지 않습니다.\n\n' +
      '신청 확인 링크: ' + publicSs.getUrl() + '\n\n' +
      '다른 참석자를 추가로 신청하려면 하단의 "다른 응답 제출"을 선택해주세요.'
  );

  // 4) Form 응답을 관리자 스프레드시트에 연결
  const sheetIdsBeforeDestination = adminSs.getSheets().map(function (s) {
    return s.getSheetId();
  });
  form.setDestination(FormApp.DestinationType.SPREADSHEET, adminSs.getId());
  const rawSheet = waitForResponseSheet(adminSs, sheetIdsBeforeDestination);

  // 자동 생성된 응답 시트 이름 변경 + 남는 기본 시트 정리
  rawSheet.setName(CONFIG.RAW_SHEET_NAME);
  adminSs.getSheets().forEach(function (s) {
    if (s.getSheetId() !== rawSheet.getSheetId() && s.getLastRow() === 0) {
      adminSs.deleteSheet(s);
    }
  });

  // 5) 관리자용 보기 좋은 명단 시트 생성
  const adminView = adminSs.insertSheet(CONFIG.ADMIN_VIEW_SHEET_NAME);
  const adminHeaders = [
    '번호',
    '군',
    '팀',
    '집중교육 참석자 이름',
    '전화번호',
    '신청자 이름',
    '신청일시',
    '중복 의심',
    '처리상태'
  ];
  adminView.getRange(1, 1, 1, adminHeaders.length).setValues([adminHeaders]);
  adminView.setFrozenRows(1);
  formatHeader(adminView, adminHeaders.length);
  refreshFilter(adminView, adminHeaders.length);
  // 시트 순서: 맨 앞으로
  adminSs.setActiveSheet(adminView);
  adminSs.moveActiveSheet(1);

  // 6) 공개용 시트 생성
  const publicSheet = publicSs.getSheets()[0];
  publicSheet.setName(CONFIG.PUBLIC_SHEET_NAME);
  const publicHeaders = ['번호', '군', '팀', '집중교육 참석자 이름', '신청자 이름'];
  publicSheet.getRange(1, 1, 1, publicHeaders.length).setValues([publicHeaders]);
  publicSheet.setFrozenRows(1);
  formatHeader(publicSheet, publicHeaders.length);
  refreshFilter(publicSheet, publicHeaders.length);

  // 7) 관리자 파일/폴더는 비공개, 공개 시트만 링크 뷰어로 설정
  const adminFile = DriveApp.getFileById(adminSs.getId());
  adminFile.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  adminFile.setShareableByEditors(false);

  const publicFile = DriveApp.getFileById(publicSs.getId());
  publicFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  assertSafeSharing(systemFolder, adminFile, publicFile);

  // 8) 속성 저장 + Spreadsheet Form-submit 트리거 설치
  props.setProperties({
    SYSTEM_FOLDER_ID: systemFolder.getId(),
    FORM_ID: form.getId(),
    ADMIN_SS_ID: adminSs.getId(),
    PUBLIC_SS_ID: publicSs.getId()
  });

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onFormSubmitHandler') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onFormSubmitHandler').forSpreadsheet(adminSs).onFormSubmit().create();

  verifySystem();
  Logger.log('===== 설치 완료 =====');
  printSystemInfo();
  } catch (err) {
    // 이번 설치 시도에서 만든 항목만 휴지통으로 보내 중복/반쪽 설치를 방지합니다.
    props.deleteAllProperties();
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === 'onFormSubmitHandler') {
        ScriptApp.deleteTrigger(trigger);
      }
    });
    createdFileIds.forEach(function (fileId) {
      try {
        DriveApp.getFileById(fileId).setTrashed(true);
      } catch (cleanupErr) {
        console.error('실패 항목 정리 오류: ' + cleanupErr);
      }
    });
    if (createdFolder) {
      try {
        createdFolder.setTrashed(true);
      } catch (cleanupErr) {
        console.error('실패 폴더 정리 오류: ' + cleanupErr);
      }
    }
    console.error('setupSystem 설치 실패: ' + err);
    throw err;
  }
}

/************************ Form 제출 시 자동 처리 ************************/

function onFormSubmitHandler(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!e || !e.range || !e.values) {
      throw new Error('이 함수는 관리자 Spreadsheet의 양식 제출 트리거로만 실행해야 합니다.');
    }

    const props = PropertiesService.getScriptProperties();
    const adminSs = SpreadsheetApp.openById(props.getProperty('ADMIN_SS_ID'));
    const publicSs = SpreadsheetApp.openById(props.getProperty('PUBLIC_SS_ID'));
    const responseSheet = e.range.getSheet();

    if (responseSheet.getParent().getId() !== adminSs.getId()) {
      throw new Error('설치된 관리자 Spreadsheet가 아닌 곳에서 제출 이벤트가 발생했습니다.');
    }

    const headers = responseSheet
      .getRange(1, 1, 1, e.values.length)
      .getDisplayValues()[0];
    const values = e.values;

    const applicantName = pickResponseValue(headers, values, Q.APPLICANT);
    const group = pickResponseValue(headers, values, Q.GROUP);
    // Form Section마다 같은 제목의 '팀' 문항이 있으므로, 같은 헤더 중 값이 있는 항목을 선택합니다.
    const team = pickResponseValue(headers, values, Q.TEAM);
    const attendeeName = pickResponseValue(headers, values, Q.ATTENDEE);
    const rawPhone = pickResponseValue(headers, values, Q.PHONE);
    const timestamp = responseSheet.getRange(e.range.getRow(), 1).getValue();

    const phone = normalizePhone(rawPhone);
    const groupValid = GROUPS.indexOf(group) !== -1;
    const teamValid = groupValid && (TEAMS_BY_GROUP[group] || []).indexOf(team) !== -1;
    const phoneValid = PHONE_REGEX.test(phone);
    const requiredValuesValid = Boolean(applicantName && attendeeName);
    const storedGroup = displayGroupName(group);

    // Form에서는 '명군/총군/전군'처럼 안내하되 시트에는 '명/총/전'만 저장합니다.
    const groupColumn = headers.indexOf(Q.GROUP) + 1;
    if (groupColumn > 0 && groupValid) {
      responseSheet.getRange(e.range.getRow(), groupColumn).setValue(storedGroup);
    }

    // 원문 응답 시트의 전화번호도 010-xxxx-xxxx 형식으로 즉시 정규화합니다.
    const phoneColumn = headers.indexOf(Q.PHONE) + 1;
    if (phoneColumn > 0 && phoneValid) {
      responseSheet
        .getRange(e.range.getRow(), phoneColumn)
        .setNumberFormat('@')
        .setValue(phone);
    }

    const adminView = adminSs.getSheetByName(CONFIG.ADMIN_VIEW_SHEET_NAME);
    if (!adminView) throw new Error(CONFIG.ADMIN_VIEW_SHEET_NAME + ' 시트를 찾을 수 없습니다.');

    const duplicate = requiredValuesValid && phoneValid && isDuplicate(adminView, attendeeName, phone);
    let status = '정상';
    if (!requiredValuesValid) {
      status = '필수값 오류';
    } else if (!groupValid || !teamValid) {
      status = '군/팀 오류';
    } else if (!phoneValid) {
      status = '전화번호 형식 오류';
    }

    // 관리자용 명단에 기록 (전화번호 포함)
    const nextRow = adminView.getLastRow() + 1;
    const rowNumber = nextRow - 1;
    adminView
      .getRange(nextRow, 1, 1, 9)
      .setValues([[
        rowNumber,
        storedGroup,
        team,
        attendeeName,
        phone,
        applicantName,
        timestamp,
        duplicate ? '중복 의심' : '',
        status
      ]]);
    adminView.getRange(nextRow, 5).setNumberFormat('@');
    refreshFilter(adminView, 9);

    // 공개용 명단에는 모든 필드가 유효한 경우에만, 전화번호 없이 기록
    if (requiredValuesValid && groupValid && teamValid && phoneValid) {
      appendAndSortPublicSheet(publicSs, group, team, attendeeName, applicantName);
    }
  } catch (err) {
    console.error('onFormSubmitHandler 오류: ' + err);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function pickResponseValue(headers, values, title) {
  for (let i = 0; i < headers.length; i += 1) {
    if (String(headers[i]).trim() === title) {
      const value = String(values[i] || '').trim();
      if (value) return value;
    }
  }
  return '';
}

function isDuplicate(adminViewSheet, attendeeName, phone) {
  const lastRow = adminViewSheet.getLastRow();
  if (lastRow < 2) return false;
  const data = adminViewSheet.getRange(2, 4, lastRow - 1, 2).getValues(); // D:참석자이름, E:전화번호
  return data.some(function (r) {
    return String(r[0]).trim() === attendeeName && String(r[1]).trim() === phone;
  });
}

function appendAndSortPublicSheet(publicSs, group, team, attendeeName, applicantName) {
  const sheet = publicSs.getSheetByName(CONFIG.PUBLIC_SHEET_NAME);
  const lastRow = sheet.getLastRow();
  sheet
    .getRange(lastRow + 1, 1, 1, 5)
    .setValues([[0, displayGroupName(group), team, attendeeName, applicantName]]);
  resortPublicSheet(sheet);
  refreshFilter(sheet, 5);
}

function resortPublicSheet(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const numRows = lastRow - 1;
  const data = sheet.getRange(2, 1, numRows, 5).getValues();

  data.sort(function (a, b) {
    const canonicalGroupA = canonicalGroupName(a[1]);
    const canonicalGroupB = canonicalGroupName(b[1]);
    const ga = GROUPS.indexOf(canonicalGroupA);
    const gb = GROUPS.indexOf(canonicalGroupB);
    if (ga !== gb) return ga - gb;
    const teamsA = TEAMS_BY_GROUP[canonicalGroupA] || [];
    const teamsB = TEAMS_BY_GROUP[canonicalGroupB] || [];
    const ta = teamsA.indexOf(a[2]);
    const tb = teamsB.indexOf(b[2]);
    if (ta !== tb) return ta - tb;
    return String(a[3]).localeCompare(String(b[3]), 'ko');
  });

  data.forEach(function (row, i) {
    row[0] = i + 1;
  });

  sheet.getRange(2, 1, numRows, 5).setValues(data);
}

/************************ 유틸리티 ************************/

function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.indexOf('010') === 0) {
    return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7);
  }
  return String(raw).trim();
}

function displayGroupName(group) {
  return String(group || '').trim().replace(/군$/, '');
}

function canonicalGroupName(group) {
  const value = String(group || '').trim();
  if (GROUPS.indexOf(value) !== -1) return value;
  const candidate = value + '군';
  return GROUPS.indexOf(candidate) !== -1 ? candidate : value;
}

function moveFileToFolder(fileId, folder) {
  DriveApp.getFileById(fileId).moveTo(folder);
}

function waitForResponseSheet(spreadsheet, existingSheetIds) {
  const existing = {};
  existingSheetIds.forEach(function (id) {
    existing[id] = true;
  });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    SpreadsheetApp.flush();
    const created = spreadsheet.getSheets().find(function (sheet) {
      return !existing[sheet.getSheetId()];
    });
    if (created) return created;
    Utilities.sleep(500);
  }
  throw new Error('Form 응답 시트가 제한 시간 안에 생성되지 않았습니다. 잠시 후 다시 실행해주세요.');
}

function assertSafeSharing(systemFolder, adminFile, publicFile) {
  const folderAccess = systemFolder.getSharingAccess();
  const adminAccess = adminFile.getSharingAccess();
  const publicAccess = publicFile.getSharingAccess();

  if (folderAccess !== DriveApp.Access.PRIVATE) {
    throw new Error('보안 확인 실패: 시스템 폴더가 비공개가 아닙니다.');
  }
  if (adminAccess !== DriveApp.Access.PRIVATE) {
    throw new Error('보안 확인 실패: 관리자 Spreadsheet가 비공개가 아닙니다.');
  }
  if (publicAccess !== DriveApp.Access.ANYONE_WITH_LINK) {
    throw new Error('공개 확인 Spreadsheet의 링크 공유 설정에 실패했습니다.');
  }
}

function formatHeader(sheet, numCols) {
  sheet
    .getRange(1, 1, 1, numCols)
    .setFontWeight('bold')
    .setBackground('#4a86e8')
    .setFontColor('#ffffff');
  sheet.autoResizeColumns(1, numCols);
}

function refreshFilter(sheet, numCols) {
  const existing = sheet.getFilter();
  if (existing) existing.remove();
  const lastRow = Math.max(sheet.getLastRow(), 1);
  sheet.getRange(1, 1, lastRow, numCols).createFilter();
}

/************************ 보조 명령 ************************/

function verifySystem() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('SYSTEM_FOLDER_ID');
  const formId = props.getProperty('FORM_ID');
  const adminId = props.getProperty('ADMIN_SS_ID');
  const publicId = props.getProperty('PUBLIC_SS_ID');

  if (!folderId || !formId || !adminId || !publicId) {
    throw new Error('검증 실패: 설치 속성에 필요한 ID가 없습니다.');
  }

  const folder = DriveApp.getFolderById(folderId);
  const adminFile = DriveApp.getFileById(adminId);
  const publicFile = DriveApp.getFileById(publicId);
  assertSafeSharing(folder, adminFile, publicFile);

  const expectedFileIds = [formId, adminId, publicId].sort();
  const actualFileIds = [];
  const files = folder.getFiles();
  while (files.hasNext()) actualFileIds.push(files.next().getId());
  actualFileIds.sort();
  if (!arraysEqual(actualFileIds, expectedFileIds)) {
    throw new Error('검증 실패: 시스템 폴더에는 Form 1개와 Spreadsheet 2개만 있어야 합니다.');
  }

  const adminSs = SpreadsheetApp.openById(adminId);
  const adminSheetNames = adminSs.getSheets().map(function (sheet) {
    return sheet.getName();
  });
  if (!arraysEqual(adminSheetNames, [CONFIG.ADMIN_VIEW_SHEET_NAME, CONFIG.RAW_SHEET_NAME])) {
    throw new Error('검증 실패: 관리자 Spreadsheet의 시트 구성이 올바르지 않습니다.');
  }

  const publicSs = SpreadsheetApp.openById(publicId);
  const publicSheets = publicSs.getSheets();
  if (publicSheets.length !== 1 || publicSheets[0].getName() !== CONFIG.PUBLIC_SHEET_NAME) {
    throw new Error('검증 실패: 공개 Spreadsheet의 시트 구성이 올바르지 않습니다.');
  }
  const publicHeaders = publicSheets[0].getRange(1, 1, 1, 5).getDisplayValues()[0];
  const expectedPublicHeaders = ['번호', '군', '팀', '집중교육 참석자 이름', '신청자 이름'];
  if (!arraysEqual(publicHeaders, expectedPublicHeaders)) {
    throw new Error('검증 실패: 공개 Spreadsheet 헤더가 올바르지 않습니다.');
  }
  if (publicHeaders.some(function (header) {
    return /전화|연락처|이메일|계정|응답.?ID/i.test(header);
  })) {
    throw new Error('검증 실패: 공개 Spreadsheet에 개인정보 컬럼이 있습니다.');
  }

  const form = FormApp.openById(formId);
  const groupItems = form.getItems(FormApp.ItemType.MULTIPLE_CHOICE).map(function (item) {
    return item.asMultipleChoiceItem();
  });
  if (groupItems.length !== GROUPS.length + 1) {
    throw new Error('검증 실패: 군/팀 선택 문항 수가 올바르지 않습니다.');
  }
  const actualGroups = groupItems[0].getChoices().map(function (choice) {
    return choice.getValue();
  });
  if (!arraysEqual(actualGroups, GROUPS)) {
    throw new Error('검증 실패: 군 선택지가 올바르지 않습니다.');
  }
  groupItems[0].getChoices().forEach(function (choice) {
    const destination = choice.getGotoPage();
    if (!destination || destination.getTitle() !== choice.getValue() + ' - 팀 선택') {
      throw new Error('검증 실패: ' + choice.getValue() + ' 군→팀 Section 분기가 올바르지 않습니다.');
    }
  });
  GROUPS.forEach(function (group, index) {
    const teamChoices = groupItems[index + 1].getChoices();
    const actualTeams = teamChoices.map(function (choice) {
      return choice.getValue();
    });
    if (!arraysEqual(actualTeams, TEAMS_BY_GROUP[group])) {
      throw new Error('검증 실패: ' + group + ' 팀 선택지가 올바르지 않습니다.');
    }
    teamChoices.forEach(function (choice) {
      const destination = choice.getGotoPage();
      if (!destination || destination.getTitle() !== '참석자 정보 입력') {
        throw new Error('검증 실패: ' + group + '/' + choice.getValue() + ' 팀→참석자 Section 분기가 올바르지 않습니다.');
      }
    });
  });

  const triggerOk = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'onFormSubmitHandler' &&
      trigger.getTriggerSourceId() === adminId;
  });
  if (!triggerOk) throw new Error('검증 실패: 관리자 Spreadsheet 제출 트리거가 없습니다.');

  Logger.log('검증 완료: 파일 3개, 비공개 관리자 파일, 공개 명단, 군→팀→참석자 분기, 제출 트리거가 정상입니다.');
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every(function (value, index) {
    return value === b[index];
  });
}

function printSystemInfo() {
  const props = PropertiesService.getScriptProperties();
  const formId = props.getProperty('FORM_ID');
  const adminId = props.getProperty('ADMIN_SS_ID');
  const publicId = props.getProperty('PUBLIC_SS_ID');
  const folderId = props.getProperty('SYSTEM_FOLDER_ID');
  if (!formId) {
    Logger.log('아직 설치되지 않았습니다. setupSystem()을 먼저 실행하세요.');
    return;
  }
  const form = FormApp.openById(formId);
  Logger.log('시스템 폴더 (비공개): ' + DriveApp.getFolderById(folderId).getUrl());
  Logger.log('신청 Form (제출용, 카톡 공유용): ' + form.getPublishedUrl());
  Logger.log('신청 Form (편집용, 관리자용): ' + form.getEditUrl());
  Logger.log('관리자 Spreadsheet (비공개): ' + SpreadsheetApp.openById(adminId).getUrl());
  Logger.log('공개 확인 Spreadsheet (카톡 공유용): ' + SpreadsheetApp.openById(publicId).getUrl());
}

function resetSystemProperties() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onFormSubmitHandler') ScriptApp.deleteTrigger(t);
  });
  Logger.log('스크립트 속성과 트리거를 초기화했습니다. 기존 시스템 폴더와 파일은 Drive에서 직접 삭제해야 합니다.');
}
