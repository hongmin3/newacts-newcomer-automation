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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

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

async function readGitFiles(project, base) {
  const {stdout} = await exec('git', ['ls-tree', '-rz', '--name-only', base, '--', project.dir], {cwd: ROOT});
  const files = new Map();
  for (const name of stdout.split('\0').filter(Boolean)) {
    if (!/\.(gs|html)$/.test(name) && !name.endsWith('/appsscript.json')) continue;
    const {stdout: source} = await exec('git', ['show', `${base}:${name}`], {cwd: ROOT, maxBuffer: 10 * 1024 * 1024});
    files.set(path.basename(name), source);
  }
  if (!files.size) throw new Error('Git 기준 판에 프로젝트 파일이 없습니다.');
  return files;
}

async function saveBackup(data) {
  const dir = path.join(os.homedir(), '.config', 'newacts-apps-script', 'backups',
    `${Date.now()}-${data.project.name}-${Math.random().toString(16).slice(2, 10)}`);
  await fs.mkdir(dir, {recursive: true, mode: 0o700});
  await fs.writeFile(path.join(dir, 'snapshot.json'), JSON.stringify(data, null, 2), {mode: 0o600});
  return dir;
}

function assertSame(left, right, message) {
  const changes = compare(left, right).filter(row => row.state !== 'same');
  if (changes.length) throw new Error(message + ': ' + changes.map(row => row.name).join(', '));
}

async function runPush(token, project, options = {}) {
  const request = options.request || callApi;
  const backup = options.backup || saveBackup;
  const url = `https://script.googleapis.com/v1/projects/${project.scriptId}`;
  console.log(`\n[${project.name}] 저장소 → 운영`);
  const local = await readLocalFiles(project.dir);
  const baseline = options.baseline || await readGitFiles(project, options.base || 'HEAD');
  const remote = await request(token, `${url}/content`);
  // 이미 같은 내용이면 다시 쓰거나 기준 판을 되돌릴 필요가 없습니다.
  if (compare(local, toFileMap(remote.files)).every(row => row.state === 'same')) {
    console.log('  운영과 동일하여 쓰기를 생략합니다.'); return;
  }
  assertSame(baseline, toFileMap(remote.files), '운영 원본과 Git 기준 판 충돌. 먼저 변경을 조정하세요');
  const deployments = await request(token, `${url}/deployments`);
  const backupPath = await backup({project, content: remote, deployments, createdAt: new Date().toISOString()});
  console.log(`  운영 백업: ${backupPath}`);
  assertSame(toFileMap(remote.files), toFileMap((await request(token, `${url}/content`)).files),
    '백업 이후 운영 원본이 변경되어 중단합니다');
  const files = [...local].map(([name, source]) => ({
    name: name.slice(0, name.length - path.extname(name).length),
    type: TYPE_BY_EXTENSION[path.extname(name)], source
  }));
  await request(token, `${url}/content`, {method: 'PUT', body: JSON.stringify({files})});
  assertSame(local, toFileMap((await request(token, `${url}/content`)).files), '반영 후 확인 실패');
  console.log(`  반영·확인 완료: ${files.length}개 파일`);
}

async function runDeploy(token, project, description, options = {}) {
  if (!project.webApp) throw new Error(`${project.name}은 웹앱 프로젝트가 아닙니다.`);
  if (!options.deploymentId) throw new Error('--deployment-id로 배포 ID를 지정하세요.');
  const request = options.request || callApi;
  const backup = options.backup || saveBackup;
  const url = `https://script.googleapis.com/v1/projects/${project.scriptId}`;
  const {deployments = []} = await request(token, `${url}/deployments`);
  const target = deployments.find(item => item.deploymentId === options.deploymentId &&
    item.deploymentConfig?.versionNumber && item.entryPoints?.some(entry => entry.webApp));
  if (!target) throw new Error('지정한 버전 고정 웹앱 배포를 찾을 수 없습니다.');
  const content = await request(token, `${url}/content`);
  if (!options.version) assertSame(await readLocalFiles(project.dir), toFileMap(content.files), '운영과 저장소가 다릅니다');
  if (options.version) await request(token, `${url}/versions/${options.version}`);
  const backupPath = await backup({project, content, deployments, createdAt: new Date().toISOString()});
  console.log(`  운영 백업: ${backupPath}`);
  // 버전 생성 직전 원본과 선택한 배포가 바뀌지 않았는지 다시 확인합니다.
  assertSame(toFileMap(content.files), toFileMap((await request(token, `${url}/content`)).files), '운영 코드가 변경되어 중단합니다');
  const latest = await request(token, `${url}/deployments`);
  if (JSON.stringify(latest.deployments.find(item => item.deploymentId === options.deploymentId)?.deploymentConfig)
      !== JSON.stringify(target.deploymentConfig)) throw new Error('운영 배포가 변경되어 중단합니다');
  const version = options.version || (await request(token, `${url}/versions`, {
    method: 'POST', body: JSON.stringify({description})
  })).versionNumber;
  const deploymentConfig = {...target.deploymentConfig, scriptId: project.scriptId,
    versionNumber: version, description};
  await request(token, `${url}/deployments/${target.deploymentId}`, {
    method: 'PUT', body: JSON.stringify({deploymentConfig})
  });
  const readback = await request(token, `${url}/deployments/${target.deploymentId}`);
  if (readback.deploymentConfig?.versionNumber !== version) throw new Error('배포 버전 재확인 실패');
  console.log(`  선택한 배포 → 버전 ${version} 확인 완료 (이전 버전 ${target.deploymentConfig.versionNumber})`);
  return version;
}

async function main() {
  const [, , rawCommand, ...rest] = process.argv;
  const command = rawCommand && !rawCommand.startsWith('--') ? rawCommand : 'diff';
  const args = rawCommand && rawCommand.startsWith('--') ? [rawCommand, ...rest] : rest;

  const flags = {'--description': 'description', '--base': 'base', '--deployment-id': 'deploymentId', '--version': 'version'};
  const options = {};
  const names = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = flags[args[i]];
      if (!key || !args[i + 1] || args[i + 1].startsWith('--') || options[key] !== undefined) {
        throw new Error(`알 수 없거나 값이 잘못된 옵션: ${args[i]}`);
      }
      options[key] = args[++i];
    } else names.push(args[i]);
  }
  if (!['diff', 'pull', 'push', 'deploy'].includes(command)) throw new Error(`알 수 없는 명령: ${command}`);
  if (options.version !== undefined) {
    if (!/^[1-9][0-9]*$/.test(options.version)) throw new Error('버전은 양의 정수여야 합니다.');
    options.version = Number(options.version);
  }
  if (command !== 'deploy' && (options.deploymentId || options.version || options.description)) {
    throw new Error('배포 옵션은 deploy에서만 사용합니다.');
  }
  if (options.base && command !== 'push') throw new Error('--base는 push에서만 사용합니다.');
  const {projects} = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
  const unknown = names.filter(name => !projects.some(project => project.name === name));
  if (unknown.length) throw new Error(`알 수 없는 프로젝트: ${unknown.join(', ')}`);
  const selected = names.length ? projects.filter(project => names.includes(project.name)) : projects;
  if (command === 'deploy' && (names.length !== 1 || !options.deploymentId)) {
    throw new Error('deploy는 프로젝트 한 개와 --deployment-id를 지정합니다.');
  }
  const description = options.description || `repo deploy ${new Date().toISOString().slice(0, 10)}`;

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
    for (const project of selected) await runPush(token, project, options);
    return;
  }
  if (command === 'deploy') {
    if (names.length !== 1) {
      throw new Error('deploy는 프로젝트 한 개만 지정합니다.');
    }
    await runDeploy(token, selected[0], description, options);
    return;
  }
  throw new Error(`알 수 없는 명령: ${command}`);
}

export {runPush, runDeploy, readLocalFiles, readGitFiles};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(`\n오류: ${error.message}`);
  process.exitCode = 1;
});
