/**
 * 보존 정책과 동기화 계약 검사.
 *
 * Validates: NFR-DATA-001, NFR-SYNC-001
 *
 * NFR-DATA-001은 "무엇을 하라"가 아니라 "자동 삭제 코드를 두지 않는다"는 금지다. 금지는
 * 코드로 검증할 수 있고, 오히려 검증하지 않으면 누군가 정리 코드를 넣어도 아무도 모른다
 * (SPEC이 '코드로 검증하지 않는다'고 적어 둔 것은 보존 기간 정책이지 이 금지가 아니다).
 *
 * NFR-SYNC-001의 `diff`/`push`는 운영 Apps Script 자격 증명이 필요해 여기서 돌리지 않는다.
 * 매니페스트 구성과 토큰 파일 비추적만 본다 — 나머지는 SPEC의 수동 절차가 맡는다.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

// ── NFR-DATA-001: 자동 삭제·만료 코드가 없어야 한다 ─────────────────────────
const GS_FILES = [
  ['education-project', '교육 출석 현황 업데이트.gs'],
  ['education-project', '집중교육 출석 현황 업데이트.gs'],
  ['education-project', '문자 명단 리스트.gs'],
  ['registration-project', '등록새가족-군현황 자동 배치.gs'],
  ['registration-project', '등록 새가족 새가족교육 수료현황 자동화.gs'],
  ['registration-project', '제목 없음.gs'],
];

// 개인정보가 든 원본·로그·보정 상태를 지우는 호출들.
const DESTRUCTIVE = [
  /\.deleteSheet\s*\(/,
  /\.deleteRow\s*\(/,
  /\.deleteRows\s*\(/,
  /deleteAllProperties\s*\(/,
  /\.clearContents\s*\(/,
  /\.clear\s*\(\s*\)/,
];

let scanned = 0;
for (const parts of GS_FILES) {
  const source = read(...parts);
  scanned += 1;
  for (const pattern of DESTRUCTIVE) {
    assert.doesNotMatch(
      source, pattern,
      `${parts.join('/')}에 자동 삭제로 보이는 호출(${pattern})이 있다 — NFR-DATA-001은 ` +
      '보존 기간을 정하기 전에는 자동 삭제·만료 코드를 두지 않는다고 정한다. 정말 필요하면 ' +
      'SPEC을 먼저 고친다.'
    );
  }
}
// 감도: 검사한 파일이 0개면 위 반복문은 아무것도 보지 않고 통과한다.
assert.equal(scanned, GS_FILES.length, `검사한 .gs 파일 수가 맞지 않다: ${scanned}`);
assert.ok(scanned >= 6, '검사 대상 파일이 비었다');

// 보정 상태 속성을 통째로 지우는 경로가 없어야 한다(보호 상태를 잃는다).
for (const parts of GS_FILES) {
  assert.doesNotMatch(read(...parts), /PropertiesService[\s\S]{0,80}deleteAllProperties/,
    `${parts.join('/')}: 스크립트 속성을 통째로 지우는 경로가 있다`);
}

// ── NFR-SYNC-001: 매니페스트 한 곳에서 네 프로젝트를 관리한다 ───────────────
const manifest = JSON.parse(read('scripts', 'apps-script-projects.json'));
assert.ok(Array.isArray(manifest.projects), 'projects 배열이 없다');
assert.equal(manifest.projects.length, 4, `프로젝트가 4개가 아니다: ${manifest.projects.length}`);

const dirs = new Set();
for (const project of manifest.projects) {
  assert.ok(project.name, 'name이 없는 항목이 있다');
  assert.ok(project.scriptId && /^[A-Za-z0-9_-]{20,}$/.test(project.scriptId),
    `${project.name}: scriptId 형식이 아니다`);
  assert.ok(fs.existsSync(path.join(root, project.dir)),
    `${project.name}: dir이 실제로 없다 (${project.dir})`);
  assert.equal(dirs.has(project.dir), false, `${project.name}: dir이 중복이다`);
  dirs.add(project.dir);
}
// 웹앱은 하나뿐이고, 버전 고정 배포라 코드 반영만으로는 화면이 바뀌지 않는다.
assert.equal(manifest.projects.filter((p) => p.webApp).length, 1, '웹앱 프로젝트가 하나가 아니다');

// 인증 토큰 파일은 저장소에 없어야 한다.
const tracked = execFileSync('git', ['-C', root, '-c', 'core.quotepath=false', 'ls-files'],
  { encoding: 'utf8' }).split('\n').filter(Boolean);
const secrets = tracked.filter((p) => /(^|\/)\.clasprc?\.json$/.test(p));
assert.deepEqual(secrets, [], `clasp 인증 파일이 추적되고 있다: ${secrets}`);

// push가 반영 후 다시 읽어 검증하는 계약이 코드에 남아 있어야 한다.
const sync = read('scripts', 'apps-script.mjs');
assert.match(sync, /push/, 'apps-script.mjs에 push 경로가 없다');
assert.ok(/verify|재확인|다시 읽|reread|confirm/i.test(sync),
  'push 후 다시 읽어 일치를 검증하는 경로가 보이지 않는다 — 없으면 불일치가 성공으로 보인다');

console.log(`data retention and sync checks passed (.gs ${scanned}개, 프로젝트 ${manifest.projects.length}개)`);
