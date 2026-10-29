#!/usr/bin/env node
/** 등록 운영 미리보기 전용 REST 호출. 비밀 설정은 저장소 밖 파일에서만 읽는다. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

class ExecutionError extends Error {}
const FUNCTIONS=Object.freeze({maintenance:'previewRegistrationMaintenance',reporting:'previewRegistrationReporting'});
export function validateConfig(config) {
  for(const key of ['projectNumber','deploymentId','client_id','client_secret','refresh_token']) {
    if(typeof config?.[key]!=='string'||!config[key].trim()) throw new ExecutionError('REST 설정에 '+key+' 항목이 필요합니다.');
  }
  if(!/^\d+$/.test(config.projectNumber)||config.client_id.split('-')[0]!==config.projectNumber) {
    throw new ExecutionError('OAuth 클라이언트와 지정한 Cloud 프로젝트가 다릅니다.');
  }
  if(!/^AKfy[\w-]+$/.test(config.deploymentId)) throw new ExecutionError('실행 API 배포 ID가 필요합니다. 스크립트 ID를 넣지 마세요.');
  return config;
}
export function validateDeployment(body) {
  const api=(body.entryPoints||[]).find(e=>e.entryPointType==='EXECUTION_API');
  if(!api)throw new ExecutionError('지정 배포에 실행 API 진입점이 없습니다.');
  const access=api.executionApi?.entryPointConfig?.access;
  if(access!=='MYSELF')throw new ExecutionError('실행 API 접근 범위를 본인만(MYSELF)으로 제한하세요.');
  return access;
}
export function summarizeResult(value) {
  if(Array.isArray(value))return value.length;
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>typeof v!=='string').map(([k,v])=>[k,summarizeResult(v)]));
  return typeof value==='number'||typeof value==='boolean'?value:null;
}
async function readJson(response,label) {
  let body;try{body=await response.json();}catch{throw new ExecutionError(label+' 응답을 읽을 수 없습니다.');}
  if(!response.ok)throw new ExecutionError(label+' 실패 (HTTP '+response.status+'). 배포·Cloud 연결·OAuth 권한을 확인하세요.');
  return body;
}
async function accessToken(config,fetch) {
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:config.client_id,client_secret:config.client_secret,refresh_token:config.refresh_token,grant_type:'refresh_token'})});
  const body=await readJson(response,'OAuth 갱신');
  if(body.error||typeof body.access_token!=='string'||(!Number.isFinite(Number(body.expires_in))||Number(body.expires_in)<=360))throw new ExecutionError('OAuth 토큰을 갱신하지 못했습니다. 전용 인증을 다시 진행하세요.');
  return body.access_token;
}
export async function executePreview({config,kind,fetch=globalThis.fetch}) {
  if(!Object.hasOwn(FUNCTIONS,kind))throw new ExecutionError('미리보기 종류는 maintenance 또는 reporting만 가능합니다.');
  validateConfig(config);
  const token=await accessToken(config,fetch);
  let response;try {
    response=await fetch('https://script.googleapis.com/v1/scripts/'+encodeURIComponent(config.deploymentId)+':run',{
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({function:FUNCTIONS[kind],devMode:true}),signal:AbortSignal.timeout(420000)
    });
  }catch{throw new ExecutionError('REST 미리보기 전송이 실패했습니다. 실행 여부를 확인한 뒤 다시 요청하세요. 자동 재시도하지 않습니다.');}
  const body=await readJson(response,'REST 미리보기');
  if(body.error)throw new ExecutionError('운영 미리보기 함수 실행 오류입니다. Apps Script 실행 이력을 확인하세요.');
  if(body.done!==true||!body.response||typeof body.response.result!=='object'||body.response.result===null)throw new ExecutionError('미리보기 완료 결과가 없습니다.');
  if(body.response.result.dryRun!==true)throw new ExecutionError('서버 결과가 미리보기 상태가 아닙니다. 배포 코드를 확인하세요.');
  return summarizeResult(body.response.result);
}
export async function runCli(args=process.argv.slice(2)) {
  const [project,kind,...extra]=args;
  if(project!=='registration'||!['maintenance','reporting','doctor'].includes(kind)||extra.length)throw new ExecutionError('사용: npm run preview -- registration maintenance|reporting|doctor');
  const configPath=process.env.NEWACTS_EXECUTION_CONFIG||path.join(os.homedir(),'.config/newacts-apps-script/registration.json');
  const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const resolved=path.resolve(configPath);const relative=path.relative(repo,resolved);
  if(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw new ExecutionError('REST 인증 설정은 저장소 밖에 보관하세요.');
  let config;try{config=JSON.parse(await fs.readFile(resolved,'utf8'));}catch{throw new ExecutionError('REST 전용 인증 설정이 없습니다. 저장소 밖 ~/.config/newacts-apps-script/registration.json을 준비하세요.');}
  validateConfig(config);
  const permissions=await fs.stat(resolved);if(process.platform!=='win32'&&(permissions.mode&0o077))throw new ExecutionError('REST 인증 파일 권한을 600으로 제한하세요.');
  if(kind==='doctor') {
    const token=await accessToken(config,globalThis.fetch);
    const manifest=JSON.parse(await fs.readFile(path.join(repo,'scripts/apps-script-projects.json'),'utf8'));
    const target=manifest.projects.find(p=>p.name==='registration');
    const body=await readJson(await fetch(`https://script.googleapis.com/v1/projects/${target.scriptId}/deployments/${encodeURIComponent(config.deploymentId)}`,{headers:{Authorization:'Bearer '+token}}),'실행 배포 조회');
    const access=validateDeployment(body);
    console.log(JSON.stringify({oauthProjectMatchesConfiguration:true,executionDeployment:true,access,previewExecuted:false}));
    return;
  }
  console.log(JSON.stringify(await executePreview({config,kind}),null,2));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)runCli().catch(error=>{
  // 응답 원문이나 인증값이 예외에 섞이지 않도록 미리 정의한 오류만 출력한다.
  console.error(error instanceof ExecutionError ? error.message : 'REST 미리보기에 실패했습니다. 전용 설정·배포·Cloud 연결·OAuth 권한을 확인하세요.');process.exitCode=1;
});
