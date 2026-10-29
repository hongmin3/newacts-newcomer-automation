// Validates: REQ-SYNC-001
const assert=require('node:assert/strict');
(async()=>{
 const {executePreview,summarizeResult,validateConfig,validateDeployment,runCli}=await import('../scripts/apps-script-execution.mjs');
 assert.equal(validateDeployment({entryPoints:[{entryPointType:'EXECUTION_API',executionApi:{entryPointConfig:{access:'MYSELF'}}}]}),'MYSELF');
 assert.throws(()=>validateDeployment({entryPoints:[{entryPointType:'EXECUTION_API',executionApi:{entryPointConfig:{access:'ANYONE'}}}]}),/MYSELF/);
 assert.equal(JSON.parse(require('node:fs').readFileSync('registration-project/appsscript.json','utf8')).executionApi?.access,'MYSELF');
 const config={projectNumber:'123456',deploymentId:'AKfy-test',client_id:'123456-test.apps.googleusercontent.com',client_secret:'SECRET',refresh_token:'REFRESH'};
 assert.throws(()=>validateConfig({...config,client_id:'987654-test.apps.googleusercontent.com'}),/Cloud/);
 const requests=[];
 const fetch=async(url,init)=>{requests.push({url,init});return {ok:true,status:200,json:async()=>url.includes('oauth2')?{access_token:'ACCESS',expires_in:3600}:{done:true,response:{result:{dryRun:true,sync:{registrations:505,unmatched:[{name:'PRIVATE'}]}}}}};};
 const result=await executePreview({config,kind:'reporting',fetch});
 assert.equal(requests.length,2);assert.match(requests[1].url,/\/scripts\/AKfy-test:run$/);
 assert.deepEqual(JSON.parse(requests[1].init.body),{function:'previewRegistrationReporting',devMode:true});
 assert.equal(result.sync.registrations,505);assert.equal(result.sync.unmatched,1);assert(!JSON.stringify(result).includes('PRIVATE'));
 await assert.rejects(executePreview({config,kind:'runSystem',fetch}),/미리보기/);assert.equal(requests.length,2);
 for(const payload of [{done:true,error:{message:'SECRET REFRESH ACCESS'}},{done:false},{done:true,response:{}},{done:true,response:{result:{dryRun:false}}}]){
  let calls=0;await assert.rejects(executePreview({config,kind:'maintenance',fetch:async(url)=>{calls++;return {ok:true,status:200,json:async()=>url.includes('oauth2')?{access_token:'ACCESS',expires_in:3600}:payload};}}),e=>!e.message.includes('SECRET')&&!e.message.includes('ACCESS'));assert.equal(calls,2);
 }
 let failureCalls=0;
 await assert.rejects(executePreview({config,kind:'reporting',fetch:async(url)=>{failureCalls++;return {ok:url.includes('oauth2'),status:url.includes('oauth2')?200:403,json:async()=>url.includes('oauth2')?{access_token:'ACCESS',expires_in:3600}:{error:{message:'SECRET'}}};}}),/HTTP 403/);
 assert.equal(failureCalls,2);
 await assert.rejects(executePreview({config,kind:'reporting',fetch:async()=>({ok:true,status:200,json:async()=>({access_token:'ACCESS',expires_in:60})})}),/OAuth/);
 assert.deepEqual(summarizeResult({items:[{name:'PRIVATE'}],name:'PRIVATE',count:2}),{items:1,count:2});
 const {mkdtempSync,writeFileSync,rmSync,existsSync}=require('node:fs');
 const path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
 const dir=mkdtempSync(path.join(os.tmpdir(),'newacts-auth-test-'));
 try {
  const client=path.join(dir,'client.json'),output=path.join(dir,'registration.json');
  writeFileSync(client,JSON.stringify({installed:{client_id:'999-test.apps.googleusercontent.com',client_secret:'SECRET'}}));
  const auth=spawnSync('python3',['-I','scripts/apps-script-execution-auth.py','--client',client,'--project-number','123456','--deployment-id','AKfy-test','--scope','https://www.googleapis.com/auth/spreadsheets','--config',output],{encoding:'utf8'});
  assert.notEqual(auth.status,0);assert.match(auth.stderr,/Cloud/);assert(!auth.stderr.includes('SECRET'));assert(!existsSync(output));
 } finally {rmSync(dir,{recursive:true,force:true});}
 await assert.rejects(runCli(['registration','runSystem']),/사용/);
 const oldConfig=process.env.NEWACTS_EXECUTION_CONFIG;
 try {
  process.env.NEWACTS_EXECUTION_CONFIG=require('node:path').resolve('private-execution.json');
  await assert.rejects(runCli(['registration','doctor']),/저장소 밖/);
 } finally {if(oldConfig===undefined)delete process.env.NEWACTS_EXECUTION_CONFIG;else process.env.NEWACTS_EXECUTION_CONFIG=oldConfig;}
 console.log('REST 미리보기 대상 제한·배포 ID·인증·오류·개인정보 출력 검사 통과');
})().catch(e=>{console.error(e);process.exitCode=1;});
