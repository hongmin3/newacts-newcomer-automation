#!/usr/bin/env node
/** tests/ 안의 모든 검증 파일을 순서대로 실행하고 실패를 한 번에 보고합니다. */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(root, 'tests');
const files = readdirSync(testDir).filter((name) => name.endsWith('.test.js')).sort();

const failed = [];
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(testDir, file)], {
    stdio: 'inherit',
    cwd: root
  });
  if (result.status !== 0) failed.push(file);
}

if (failed.length) {
  console.error(`\n실패: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`\n${files.length}개 검증 파일 모두 통과`);
