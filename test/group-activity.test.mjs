import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { findingKey } from '../lib/audit.mjs';
import { groupKey, groupedFindings, existingFix } from '../lib/remediation-group.mjs';
import { assertRemediated, assertContext } from '../lib/remediation.mjs';
import { progressFor, normalizeRun } from '../dashboard/activity.js';
import { parseUsage, collectActivity } from '../lib/run-activity.mjs';
import { materializeBaseline } from '../lib/demo-baseline.mjs';
import { reconcile } from '../lib/register.mjs';
import { git } from '../lib/process.mjs';
const target={id:'demo',repository:'owner/app',directory:'.',ecosystem:'npm'};
const make=(advisoryId,packageName='lodash')=>({key:findingKey(target,packageName,advisoryId),repository:target.repository,manifest:'package-lock.json',package:packageName,advisoryId});
const a=make('GHSA-one'),b=make('GHSA-two'),other=make('GHSA-three','minimist');
const context={target,finding:a,findings:[a,b],groupKey:groupKey(a),before:[a,b,other],sha:'a'.repeat(40),branch:'codex/fix-'+groupKey(a)+'-123',issueNumber:1};
test('one package group requires every advisory removed without crossing repository/manifest/package boundaries',()=>{
 assert.equal(groupKey(a),groupKey(b)); assert.notEqual(groupKey(a),groupKey(other));
 assert.deepEqual(new Set(groupedFindings(a,[a,b,other,{...a,repository:'other/app'},{...a,manifest:'nested/package-lock.json'}]).map(f=>f.key)),new Set([a.key,b.key]));
 assert.equal(assertContext(context,[target]),target);
 assert.throws(()=>assertRemediated(context,[b,other]),/still present/);
 assert.doesNotThrow(()=>assertRemediated(context,[other]));
 assert.throws(()=>assertContext({...context,findings:[a,other]},[target]),/Invalid package group/);
});
test('any advisory in a group reuses one matching open PR, with repository and base isolation',()=>{
 const pr={number:8,head:{repo:{full_name:'owner/app'},ref:'codex/fix-'+groupKey(a)+'-123'},base:{ref:'main'}};
 assert.equal(existingFix([pr],b,[],'main'),pr);
 assert.equal(existingFix([{...pr,base:{ref:'other'}}],b,[],'main'),undefined);
 assert.equal(existingFix([{...pr,head:{...pr.head,repo:{full_name:'fork/app'}}}],b,[],'main'),undefined);
});
test('progress follows package requests, failures, PRs, and recurrence without resurrecting an old run',()=>{
 const records=[{...a,issueNumber:1,status:'open',firstSeen:'2026-01-01'},{...b,issueNumber:2,status:'open',firstSeen:'2026-01-01'}];
 const r={id:123,attempt:1,issueNumber:1,status:'queued',createdAt:'2026-02-01',url:'https://github.com/owner/hub/actions/runs/123'};
 assert.equal(progressFor(records[1],records,[r]).label,'Requested / queued');
 assert.equal(progressFor(records[1],records,[{...r,status:'in_progress'},{...r,id:124,createdAt:'2026-02-02'}]).label,'Running');
 const failure={...r,status:'completed',conclusion:'failure',jobs:[{name:'verify',conclusion:'failure',step:'Audit and tests'}]};
 assert.match(progressFor(records[1],records,[failure]).detail,/verify.*Audit/);
 assert.equal(progressFor({...records[1],status:'pr-open'},records,[failure]).label,'PR ready');
 assert.equal(progressFor({...records[1],cycleStartedAt:'2026-03-01'},records,[failure]).label,'Not requested');
 assert.equal(progressFor({...records[1],status:'resolved'},records,[failure]).label,'Resolved');
 const reopened=reconcile([{...records[0],status:'resolved'}],[{target,success:true,findings:[a],scannedAt:'2026-03-01',sha:'b'.repeat(40)}])[0];
 assert.equal(reopened.cycleStartedAt,'2026-03-01'); assert.equal(reopened.issueNumber,1);
});
test('usage ignores quoted commands, malformed events and invalid counts; missing usage is unavailable',()=>{
 const event={type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:80,output_tokens:10,reasoning_output_tokens:4}};
 const log=['timestamp '+JSON.stringify(event),JSON.stringify({type:'item.completed',item:{aggregated_output:JSON.stringify(event)}}),'bad {"type":',JSON.stringify({...event,usage:{input_tokens:-4,output_tokens:7}})].join('\n');
 assert.deepEqual(parseUsage(log),{inputTokens:100,cachedInputTokens:80,outputTokens:10,reasoningOutputTokens:4,completedTurns:1});
 assert.equal(parseUsage('model failed before reporting usage'),null);
 assert.equal(normalizeRun({id:1,event:'push',display_title:'Remediate register issue #1'}),null);
});
test('activity failure metadata survives unavailable logs and uses the latest attempt',async()=>{
 const calls=[];const api={get:async path=>{calls.push(path);if(path.includes('/workflows/'))return {workflow_runs:[{id:123,event:'workflow_dispatch',display_title:'Remediate register issue #1',run_attempt:2,status:'completed',conclusion:'failure',created_at:'2026-01-01'}]};return {jobs:[{id:4,name:'propose',status:'completed',conclusion:'failure',steps:[{name:'Model',conclusion:'failure'}]}]};},text:async()=>{throw Error('expired');}};
 const {runs}=await collectActivity(api,'owner/hub');
 assert.ok(calls.some(p=>p.includes('/attempts/2/jobs')));assert.equal(runs[0].jobs[0].step,'Model');assert.equal(runs[0].detailsUnavailable,true);
});
test('integration baseline comes from the pinned commit even when the sibling checkout is fixed',async()=>{
 await mkdir('.work',{recursive:true});const folder=await mkdtemp(join(resolve('.work'),'baseline-test-')), source=join(folder,'source');await mkdir(source);
 for(const [name,body] of Object.entries({'package.json':'{"dependencies":{"minimist":"1.2.5"}}','package-lock.json':'{}','src/app.mjs':'export const app=1;','test/app.test.mjs':'export const test=1;'})){await mkdir(join(source,name,'..'),{recursive:true});await writeFile(join(source,name),body);}
 await git(['init','-b','main'],{cwd:source});await git(['add','.'],{cwd:source});await git(['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','baseline'],{cwd:source});
 const baselineCommit=await git(['rev-parse','HEAD'],{cwd:source});await writeFile(join(source,'package.json'),'fixed checkout');
 const destination=join(folder,'fixture');await materializeBaseline(source,destination,{...target,demo:{baselineCommit}});
 assert.equal(await readFile(join(destination,'package.json'),'utf8'),'{"dependencies":{"minimist":"1.2.5"}}');
 assert.equal(await readFile(join(source,'package.json'),'utf8'),'fixed checkout');
 await assert.rejects(materializeBaseline(source,destination,{...target,demo:{baselineCommit}}),/exist/);
});
