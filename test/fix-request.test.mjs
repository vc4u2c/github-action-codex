import test from 'node:test';
import assert from 'node:assert/strict';
import { findingKey } from '../lib/audit.mjs';
import { issueBody, registerLabel } from '../lib/register.mjs';
import { authorizeFixRequest, isFixRequest, remediationRecord, requestRemediation } from '../lib/fix-request.mjs';

const hub = 'owner/hub';
const target = { id:'app', repository:'owner/app', directory:'.', ecosystem:'npm' };
const record = { key:findingKey(target, 'minimist', 'GHSA-xvch-5gv4-984h'), targetId:'app',
  repository:target.repository, directory:'.', manifest:'package-lock.json', package:'minimist',
  advisoryId:'GHSA-xvch-5gv4-984h', status:'open', severity:'critical', title:'Prototype pollution' };
function fixture() {
  const before = issueBody(record, hub);
  const issue = { number:6, state:'open', body:before.replace('- [ ] Request a Codex fix','- [x] Request a Codex fix'),
    labels:[{name:registerLabel}], html_url:'https://github.com/owner/hub/issues/6' };
  const event = { repository:{full_name:hub}, action:'edited', sender:{login:'maintainer',type:'User'},
    issue, changes:{body:{from:before}} };
  const calls = [];
  const api = { get:async path => {
    calls.push(path);
    if (path === '/repos/owner/hub/collaborators/maintainer/permission') return {permission:'write'};
    if (path === '/repos/owner/hub/issues/6') return issue;
    throw new Error('Unexpected API call: ' + path);
  } };
  return {api,hub,actor:'maintainer',eventName:'issues',event,targets:[target],calls,issue};
}

test('ticking the generated register checkbox authorizes the same issue after a live write-access check', async () => {
  const f=fixture();
  assert.ok(isFixRequest(f.event));
  assert.equal(await authorizeFixRequest(f),6);
  assert.deepEqual(f.calls, ['/repos/owner/hub/collaborators/maintainer/permission','/repos/owner/hub/issues/6']);
  assert.equal(remediationRecord(f.issue,[target]).record.key,record.key);
});

test('unchecking, ordinary edits, missing prior checkbox, duplicate controls, and bots are not fix requests', async () => {
  for (const change of [
    e => {e.issue.body=e.changes.body.from;},
    e => {e.changes.body.from=e.issue.body;},
    e => {delete e.changes;},
    e => {e.changes.body.from='ordinary issue body';},
    e => {e.issue.body+='\n- [x] Request a Codex fix';},
    e => {e.action='opened';},
    e => {e.sender.type='Bot';},
  ]) {
    const f=fixture(); change(f.event);
    await assert.rejects(authorizeFixRequest(f), /new checkbox request/);
    assert.deepEqual(f.calls,[]);
  }
});

test('public readers, triage users, missing permissions, and permission lookup failures cannot request a paid fix', async () => {
  for (const permission of ['read','none','triage',undefined]) {
    const f=fixture(); f.api.get=async path => {f.calls.push(path); return {permission};};
    await assert.rejects(authorizeFixRequest(f), /write access/);
    assert.equal(f.calls.length,1);
  }
  const f=fixture(); f.api.get=async()=>{throw new Error('GitHub 403');};
  await assert.rejects(authorizeFixRequest(f),/403/);
});

test('reruns verify the current actor and malformed issue numbers cannot reach GitHub', async () => {
  const f=fixture();
  assert.equal(await authorizeFixRequest(f),6);
  f.triggeringActor='reader'; const get=f.api.get;
  f.api.get=async path=>path.includes('/reader/')?{permission:'read'}:get(path);
  await assert.rejects(authorizeFixRequest(f), /write access/);
  for (const value of ['6; echo unwanted','0','-1','1.5','9007199254740993']) {
    const bad=fixture(); bad.event.issue.number=value;
    await assert.rejects(authorizeFixRequest(bad),/valid register issue number/);
    assert.deepEqual(bad.calls,[]);
  }
});

test('pull requests, closed findings, unlabeled issues, and altered target identities are rejected', async () => {
  for (const change of [
    i=>{i.pull_request={url:'https://github.com/owner/hub/pull/6'};},
    i=>{i.state='closed';},
    i=>{i.labels=[];},
    i=>{i.body='ordinary issue';},
    i=>{i.body=issueBody({...record,status:'resolved'},hub);},
    i=>{i.body=issueBody({...record,repository:'other/repo'},hub);},
    i=>{i.body=issueBody({...record,manifest:'other/package-lock.json'},hub);},
  ]) {
    const f=fixture(); const current=structuredClone(f.issue); change(current); const get=f.api.get;
    f.api.get=async path=>path.endsWith('/issues/6')?current:get(path);
    await assert.rejects(authorizeFixRequest(f));
  }
  const f=fixture();f.event.repository.full_name='other/hub';
  await assert.rejects(authorizeFixRequest(f),/Wrong hub/);
  assert.deepEqual(f.calls,[]);
});

test('changing finding identity in the same checkbox edit is rejected', async () => {
  const f=fixture(); const other={...record,package:'lodash',key:findingKey(target,'lodash',record.advisoryId)};
  f.event.changes.body.from=issueBody(other,hub);
  await assert.rejects(authorizeFixRequest(f),/identity changed/);
});

test('register output offers requests only for open findings, and retains stored finding identity', () => {
  assert.match(issueBody(record,hub), /^- \[ \] Request a Codex fix$/m);
  assert.match(issueBody(record,hub), /https:\/\/github.com\/owner\/hub\/actions\/workflows\/remediate.yml/);
  for (const status of ['pr-open','awaiting-verification','resolved']) assert.doesNotMatch(issueBody({...record,status},hub), /^- \[ \] Request a Codex fix$/m);
});

test('listener ignores unrelated edits without API calls, and dispatches only the authorized issue on the default branch', async () => {
  const ordinary=fixture(); ordinary.event.issue.body=ordinary.event.changes.body.from;
  assert.equal(await requestRemediation(ordinary),null);
  assert.deepEqual(ordinary.calls,[]);
  const f=fixture(), get=f.api.get, dispatched=[];
  f.api.get=async path=>path==='/repos/owner/hub'?{default_branch:'trunk'}:get(path);
  f.api.post=async (path,body)=>dispatched.push({path,body});
  assert.equal(await requestRemediation(f),6);
  assert.deepEqual(dispatched,[{path:'/repos/owner/hub/actions/workflows/remediate.yml/dispatches',body:{ref:'trunk',inputs:{issue_number:'6'}}}]);
  dispatched.length=0;f.api.get=async()=>({permission:'read'});
  await assert.rejects(requestRemediation(f),/write access/);
  assert.deepEqual(dispatched,[]);
});
