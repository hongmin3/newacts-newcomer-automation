// Validates: REQ-SYNC-003
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {runPush, runDeploy, readLocalFiles, readGitFiles} from '../scripts/apps-script.mjs';
assert.equal((await readGitFiles({dir: 'education-project'}, 'HEAD')).size, 4, '한글 파일명을 포함한 기준 원본을 모두 읽는다');
assert.deepEqual([...(await readGitFiles({dir: 'education-project'}, 'HEAD')).keys()].sort(), [...(await readLocalFiles('education-project')).keys()].sort());
const project = {name: 'sample', dir: 'intensive-training-application', scriptId: 'sample', webApp: true};
const local = await readLocalFiles(project.dir);
const baseline = new Map([...local].map(([name, source], i) => [name, source + (i ? '' : '\n// previous')]));
const files = [...baseline].map(([name, source]) => ({name: name.replace(/\.[^.]+$/, ''),
  type: name.endsWith('.gs') ? 'SERVER_JS' : 'JSON', source}));
function server(changeAt = Infinity, deploying = false) {
  let reads = 0;
  const writes = [], backups = [];
  let stored = files, version = 7;
  return {writes, backups, request: async (_token, url, init = {}) => {
    if (init.method) {
      const body = JSON.parse(init.body); writes.push({url, ...body});
      if (body.files) stored = body.files;
      if (body.deploymentConfig) version = body.deploymentConfig.versionNumber;
      return url.endsWith('/versions') ? {versionNumber: 9} : {};
    }
    if (url.endsWith('/deployments/chosen')) return {deploymentConfig: {versionNumber: version}};
    if (url.endsWith('/deployments')) return {deployments: [
      {deploymentId: 'chosen', deploymentConfig: {versionNumber: 7, manifestFileName: 'appsscript'}, entryPoints: [{webApp: {}}]},
      {deploymentId: 'other', deploymentConfig: {versionNumber: 8}, entryPoints: [{webApp: {}}]}
    ]};
    reads++;
    return {files: reads >= changeAt ? stored.map((f, i) => i ? f : {...f, source: f.source + '\n// remote edit'}) : deploying ? [...local].map(([name, source]) => ({name: name.replace(/\.[^.]+$/, ''), type: name.endsWith('.gs') ? 'SERVER_JS' : 'JSON', source})) : stored};
  }, backup: async data => {backups.push(data); return '/private/backup';}};
}
let s = server(1);
await assert.rejects(runPush('token', project, {...s, baseline}), /운영.*기준|충돌/);
assert.equal(s.writes.length, 0);
s = server(2);
await assert.rejects(runPush('token', project, {...s, baseline}), /변경|충돌/);
assert.equal(s.writes.length, 0, '백업 이후 바뀌어도 쓰지 않는다');
s = server();
await runPush('token', project, {...s, baseline});
assert.equal(s.writes.length, 1); assert.equal(s.backups.length, 1);
s = server();
await assert.rejects(runDeploy('token', project, 'test', {...s}), /배포 ID/);
assert.equal(s.writes.length, 0);
await assert.rejects(runDeploy('token', project, 'test', {...s, deploymentId: 'missing'}), /배포.*찾|대상/);
assert.equal(s.writes.length, 0, '대상 검증 전에 버전을 만들지 않는다');
s = server(Infinity, true);
await runDeploy('token', project, 'restore', {...s, deploymentId: 'chosen', version: 6});
assert.equal(s.writes.length, 1);
assert.match(s.writes[0].url, /deployments\/chosen$/);
assert.equal(s.writes[0].deploymentConfig.versionNumber, 6);
s = server(Infinity, true);
await runDeploy('token', project, 'new version', {...s, deploymentId: 'chosen'});
assert.equal(s.writes.length, 2);
assert.match(s.writes[0].url, /\/versions$/);
assert.match(s.writes[1].url, /\/deployments\/chosen$/);
assert.equal(s.writes[1].deploymentConfig.versionNumber, 9);
const unknown = spawnSync(process.execPath, ['scripts/apps-script.mjs', 'push', 'education', 'missing'], {encoding: 'utf8'});
assert.notEqual(unknown.status, 0); assert.match(unknown.stderr, /알 수 없는 프로젝트/);
console.log('apps-script-deploy tests passed');
