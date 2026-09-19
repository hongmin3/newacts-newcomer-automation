#!/usr/bin/env node
/**
 * Apps Script 운영 프로젝트와 저장소를 동기화하는 도구.
 *
 *   node scripts/apps-script.mjs diff  [프로젝트...]   운영 ↔ 저장소 차이 확인 (기본값)
 *   node scripts/apps-script.mjs pull  [프로젝트...]   운영 코드를 저장소로 내려받기
 *   node scripts/apps-script.mjs push  [프로젝트...]   저장소 코드를 운영에 반영
 *   node scripts/apps-script.mjs deploy <프로젝트> --description "..."
 *                                                    새 버전 생성 후 웹앱 배포 갱신
 *
 * 인증은 clasp가 저장한 ~/.clasprc.json의 refresh token을 재사용합니다.
 * push는 프로젝트의 파일 전체를 교체하므로 실행 전 diff로 확인하세요.
 * 개인정보·시트 데이터는 다루지 않고 스크립트 소스만 주고받습니다.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'scripts', 'apps-script-projects.json');
const CLASPRC = process.env.CLASPRC_PATH || path.join(os.homedir(), '.clasprc.json');

const EXTENSION_BY_TYPE = { SERVER_JS: '.gs', HTML: '.html', JSON: '.json' };
const TYPE_BY_EXTENSION = { '.gs': 'SERVER_JS', '.html': 'HTML', '.json': 'JSON' };

async function readAccessToken() {
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(CLASPRC, 'utf8'));
  } catch {
    throw new Error(
      `clasp 인증 파일을 찾을 수 없습니다: ${CLASPRC}\n` +
      'clasp login을 먼저 실행하거나 CLASPRC_PATH를 지정하세요.'
    );
  }
  const token = raw.tokens?.default ?? raw;
  const { client_id, client_secret, refresh_token } = token;
  if (!client_id || !client_secret || !refresh_token) {
    throw new Error('clasp 인증 파일에 refresh token이 없습니다. clasp login을 다시 실행하세요.');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id, client_secret, refresh_token, grant_type: 'refresh_token'
    })
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(`토큰 갱신 실패: ${body.error_description || body.error || response.status}`);
  }
  return body.access_token;
}

async function callApi(token, url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok || body.error) {
    const message = body.error?.message || `HTTP ${response.status}`;
    throw new Error(`${init.method || 'GET'} ${url}\n  → ${message}`);
  }
  return body;
}

const fetchContent = (token, scriptId) =>
  callApi(token, `https://script.googleapis.com/v1/projects/${scriptId}/content`);

/** 운영 파일 목록을 `이름.확장자 → 소스` 맵으로 바꿉니다. */
function toFileMap(files) {
  const map = new Map();
  for (const file of files) {
    const extension = EXTENSION_BY_TYPE[file.type];
    if (!extension) continue;
    map.set(file.name + extension, file.source);
  }
  return map;
}

/** 저장소 디렉터리를 같은 형태의 맵으로 읽습니다. */
async function readLocalFiles(dir) {
  const absolute = path.join(ROOT, dir);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const map = new Map();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name);
    if (!TYPE_BY_EXTENSION[extension]) continue;
    // appsscript.json 외의 JSON은 Apps Script 파일이 아닙니다.
    if (extension === '.json' && entry.name !== 'appsscript.json') continue;
    map.set(entry.name, await fs.readFile(path.join(absolute, entry.name), 'utf8'));
  }
  if (!map.has('appsscript.json')) {
    throw new Error(`${dir}/appsscript.json이 없습니다. 먼저 pull을 실행하세요.`);
  }
  return map;
}

function compare(localMap, remoteMap) {
  const names = [...new Set([...localMap.keys(), ...remoteMap.keys()])].sort();
  return names.map((name) => {
    const local = localMap.get(name);
    const remote = remoteMap.get(name);
    if (local === undefined) return { name, state: 'remote-only' };
    if (remote === undefined) return { name, state: 'local-only' };
    return { name, state: local === remote ? 'same' : 'differs' };
  });
}

function describe(rows) {
  const symbol = { same: '  =', differs: '  ~', 'local-only': '  +', 'remote-only': '  -' };
  for (const row of rows) console.log(`${symbol[row.state]} ${row.name}`);
  return rows.some((row) => row.state !== 'same');
}

async function runDiff(token, project) {
  console.log(`\n[${project.name}] ${project.dir}`);
  const remote = toFileMap((await fetchContent(token, project.scriptId)).files);
  const local = await readLocalFiles(project.dir);
  const changed = describe(compare(local, remote));
  console.log(changed ? '  → 차이 있음' : '  → 동일');
  return changed;
}

async function runPull(token, project) {
  console.log(`\n[${project.name}] 운영 → 저장소`);
  const remote = toFileMap((await fetchContent(token, project.scriptId)).files);
  for (const [name, source] of remote) {
    await fs.writeFile(path.join(ROOT, project.dir, name), source, 'utf8');
    console.log(`  저장: ${project.dir}/${name}`);
  }
}

async function runPush(token, project) {
  console.log(`\n[${project.name}] 저장소 → 운영`);
  const local = await readLocalFiles(project.dir);
  const files = [...local].map(([name, source]) => ({
    name: name.slice(0, name.length - path.extname(name).length),
    type: TYPE_BY_EXTENSION[path.extname(name)],
    source
  }));

  await callApi(
    token,
    `https://script.googleapis.com/v1/projects/${project.scriptId}/content`,
    { method: 'PUT', body: JSON.stringify({ files }) }
  );

  // 반영 결과를 그대로 다시 읽어 확인합니다.
  const remote = toFileMap((await fetchContent(token, project.scriptId)).files);
  const mismatched = compare(local, remote).filter((row) => row.state !== 'same');
  if (mismatched.length) {
    throw new Error(
      `반영 후 확인 실패: ${mismatched.map((row) => `${row.name}(${row.state})`).join(', ')}`
    );
  }
  console.log(`  반영·확인 완료: ${files.length}개 파일`);
}

async function runDeploy(token, project, description) {
  if (!project.webApp) {
    throw new Error(`${project.name}은 웹앱 프로젝트가 아닙니다.`);
  }
  console.log(`\n[${project.name}] 새 버전 배포`);

  const version = await callApi(
    token,
    `https://script.googleapis.com/v1/projects/${project.scriptId}/versions`,
    { method: 'POST', body: JSON.stringify({ description }) }
  );
  console.log(`  버전 ${version.versionNumber} 생성`);

  const { deployments = [] } = await callApi(
    token,
    `https://script.googleapis.com/v1/projects/${project.scriptId}/deployments`
  );
  // versionNumber가 없는 항목은 항상 HEAD를 가리키는 기본 배포라 갱신 대상이 아닙니다.
  const targets = deployments.filter((item) => item.deploymentConfig?.versionNumber);
  if (!targets.length) throw new Error('갱신할 버전 고정 배포가 없습니다.');

  for (const target of targets) {
    const updated = await callApi(
      token,
      `https://script.googleapis.com/v1/projects/${project.scriptId}` +
        `/deployments/${target.deploymentId}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          deploymentConfig: {
            scriptId: project.scriptId,
            versionNumber: version.versionNumber,
            manifestFileName: 'appsscript',
            description
          }
        })
      }
    );
    const webApp = (updated.entryPoints || []).find((entry) => entry.webApp)?.webApp;
    console.log(`  배포 ${target.deploymentId} → 버전 ${version.versionNumber}`);
    if (webApp) console.log(`  웹앱 URL: ${webApp.url}`);
  }
  return version.versionNumber;
}

async function main() {
  const [, , rawCommand, ...rest] = process.argv;
  const command = rawCommand && !rawCommand.startsWith('--') ? rawCommand : 'diff';
  const args = rawCommand && rawCommand.startsWith('--') ? [rawCommand, ...rest] : rest;

  const descriptionIndex = args.indexOf('--description');
  const description = descriptionIndex >= 0
    ? args[descriptionIndex + 1]
    : `repo deploy ${new Date().toISOString().slice(0, 10)}`;
  // --description의 값 위치만 제외합니다. 옵션이 없을 때 0번을 지우면 안 됩니다.
  const descriptionValueIndex = descriptionIndex >= 0 ? descriptionIndex + 1 : -1;
  const names = args.filter(
    (value, index) =>
      !value.startsWith('--') && index !== descriptionValueIndex
  );

  const { projects } = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
  const selected = names.length
    ? projects.filter((project) => names.includes(project.name))
    : projects;
  if (!selected.length) {
    throw new Error(`알 수 없는 프로젝트: ${names.join(', ')}`);
  }

  const token = await readAccessToken();

  if (command === 'diff') {
    let changed = false;
    for (const project of selected) changed = (await runDiff(token, project)) || changed;
    console.log(changed ? '\n차이가 있습니다.' : '\n모든 프로젝트가 운영과 동일합니다.');
    process.exitCode = changed ? 1 : 0;
    return;
  }
  if (command === 'pull') {
    for (const project of selected) await runPull(token, project);
    return;
  }
  if (command === 'push') {
    for (const project of selected) await runPush(token, project);
    return;
  }
  if (command === 'deploy') {
    if (names.length !== 1) {
      throw new Error('deploy는 프로젝트 한 개만 지정합니다.');
    }
    await runDeploy(token, selected[0], description);
    return;
  }
  throw new Error(`알 수 없는 명령: ${command}`);
}

main().catch((error) => {
  console.error(`\n오류: ${error.message}`);
  process.exitCode = 1;
});
