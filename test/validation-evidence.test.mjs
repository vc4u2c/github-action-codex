import test from 'node:test';
import assert from 'node:assert/strict';
import { validationForFinding, verificationForRun } from '../dashboard/validation.js';
import { publicationEvidence } from '../lib/validation-evidence.mjs';
const head='a'.repeat(40), key='b'.repeat(24), hash='c'.repeat(64);
const finding={key,repository:'owner/app',manifest:'package-lock.json',package:'minimist',issueNumber:6,status:'open',firstSeen:'2026-01-01',cycleStartedAt:'2026-02-01',scanSha:head};
const scan={target:{repository:'owner/app',directory:'.'},success:true,sha:head,scannedAt:'2026-02-02',findings:[finding]};
const checks={patch:'passed',installation:'passed',tests:'passed',audit:'passed'};
const receipt={schema:1,verifiedAt:'2026-02-02',baseSha:head,headSha:head,patchSha256:hash,checks,resolvedKeys:[key],runUrl:'https://github.com/owner/hub/actions/runs/1'};

test('successful workflow with skipped verifier is never reported as validation passed',()=>{
 assert.equal(verificationForRun({conclusion:'success',jobs:[{name:'verify',conclusion:'skipped',status:'completed'}]}).label,'Not run');
 assert.equal(verificationForRun({conclusion:'success'}).label,'Unavailable');
 assert.equal(verificationForRun({jobs:[{name:'verify',conclusion:'failure',status:'completed',step:'Tests'}]}).label,'Failed');
});
test('recurrence ignores old proposal receipt and old successful verifier run',()=>{
 const old={...finding,remediation:{patchSha256:hash,headSha:head,validation:{...receipt,verifiedAt:'2026-01-02'}}};
 const run={id:1,issueNumber:6,createdAt:'2026-01-02',jobs:[{name:'verify',conclusion:'success',status:'completed'}]};
 const result=validationForFinding(old,[old],[run],[scan]);
 assert.equal(result.proposal.label,'Not run this cycle');assert.equal(result.main.label,'Advisory present');
});
test('proposal evidence is bound to the current PR commit, independent of main branch resolution',()=>{
 const f={...finding,status:'pr-open',remediation:{patchSha256:hash,headSha:head,validation:receipt}};
 let result=validationForFinding(f,[f],[],[scan]);assert.equal(result.proposal.label,'Passed');assert.equal(result.main.label,'Advisory present');
 result=validationForFinding({...f,remediation:{...f.remediation,headSha:'d'.repeat(40)}},[f],[],[scan]);assert.equal(result.proposal.label,'Needs revalidation');
 result=validationForFinding({...f,status:'resolved'},[f],[],[{...scan,findings:[]}]);assert.equal(result.main.label,'Advisory absent');
 result=validationForFinding({...f,status:'resolved'},[f],[],[{...scan,success:false,error:'Registry unavailable'}]);assert.equal(result.main.label,'Scan failed');
});
test('missing or mismatched receipt cannot produce passed proposal evidence',()=>{
 for(const validation of [{...receipt,checks:{tests:'passed'}},{...receipt,resolvedKeys:[]},{...receipt,patchSha256:'e'.repeat(64)}]){
 const f={...finding,remediation:{patchSha256:hash,headSha:head,validation}};
 assert.equal(validationForFinding(f,[f],[],[scan]).proposal.label,'Not run this cycle');
 }
 const context={sha:head,hub:'owner/hub'},env={GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2'};
 assert.equal(publicationEvidence(context,receipt,{patchSha256:hash},head,env).runUrl,'https://github.com/owner/hub/actions/runs/123/attempts/2');
 assert.throws(()=>publicationEvidence(context,{...receipt,checks:{}},{patchSha256:hash},head,env),/Incomplete/);
 assert.throws(()=>publicationEvidence(context,receipt,{patchSha256:'bad'},head,env),/Incomplete/);
});

test('a passing verifier without a receipt never attests the current PR commit',()=>{
 const run={id:9,issueNumber:6,createdAt:'2026-02-02',jobs:[{name:'verify',status:'completed',conclusion:'success'}]};
 const result=validationForFinding(finding,[finding],[run],[scan]);assert.equal(result.proposal.label,'Job passed');assert.equal(result.proposal.kind,'open');
});
