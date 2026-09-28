const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '..', 'intensive-training-application', 'Code.gs');
const source = fs.readFileSync(sourcePath, 'utf8');
const api = new Function(
  source +
    '\nreturn { CONFIG, GROUPS, TEAMS_BY_GROUP, PHONE_REGEX, normalizePhone, pickResponseValue, displayGroupName, canonicalGroupName };'
)();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(api.GROUPS.length === 9, '군은 9개여야 합니다.');

const expectedTeamCounts = {
  신군: 4,
  조군: 1,
  명군: 5,
  총군: 6,
  영군: 7,
  석군: 6,
  임군: 3,
  전군: 5,
  슬군: 4
};

Object.entries(expectedTeamCounts).forEach(([group, count]) => {
  assert(api.TEAMS_BY_GROUP[group].length === count, `${group} 팀 개수가 올바르지 않습니다.`);
});

assert(api.normalizePhone('01012345678') === '010-1234-5678', '숫자 전화번호 정규화 실패');
assert(api.normalizePhone('010-1234-5678') === '010-1234-5678', '하이픈 전화번호 유지 실패');
assert(api.PHONE_REGEX.test(api.normalizePhone('01012345678')), '정상 전화번호 검증 실패');
assert(!api.PHONE_REGEX.test(api.normalizePhone('0101234567')), '10자리 전화번호가 통과했습니다.');
assert(api.displayGroupName('총군') === '총', '시트 저장용 군 이름 변환 실패');
assert(api.displayGroupName('명') === '명', '이미 축약된 군 이름 유지 실패');
assert(api.canonicalGroupName('전') === '전군', '정렬용 군 이름 복원 실패');

assert(
  api.pickResponseValue(['팀', '팀', '팀'], ['', '보배', ''], '팀') === '보배',
  'Section별 중복 팀 헤더에서 선택값을 찾지 못했습니다.'
);

assert(
  source.includes("forSpreadsheet(adminSs).onFormSubmit().create()"),
  '관리자 Spreadsheet Form-submit 트리거가 아닙니다.'
);
assert(
  !source.includes("newTrigger('onFormSubmitHandler').forForm("),
  'Form 이벤트와 Spreadsheet 이벤트를 혼용하고 있습니다.'
);
assert(
  source.includes('adminFile.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE)'),
  '관리자 파일 비공개 설정이 없습니다.'
);
assert(
  source.includes('publicFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)'),
  '공개 확인 시트 링크 뷰어 설정이 없습니다.'
);

const publicHeaders = ['번호', '군', '팀', '집중교육 참석자 이름', '신청자 이름'];
assert(
  publicHeaders.every((header) => !/전화|연락처|이메일|계정|응답.?ID/i.test(header)),
  '공개 헤더에 개인정보 컬럼이 있습니다.'
);

console.log('intensive-training-application tests passed');
