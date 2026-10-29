import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { zipSync, strToU8 } from 'fflate';
import { createDashboardServer, dashboardConfig } from '../lib/dashboard-server.mjs';
import { snapshotFromArchive, snapshotLoader } from '../lib/dashboard-snapshot.mjs';
import { issueBody } from '../lib/register.mjs';
import { findingKey } from '../lib/audit.mjs';

const target={id:'demo',repository:'owner/app',directory:'.',ecosystem:'npm'};
const record={key:findingKey(target,'minimist','GHSA-example'),targetId:'demo',repository:'owner/app',directory:'.',manifest:'package-lock.json',package:'minimist',advisoryId:'GHSA-example',status:'open',issueNumber:6,firstSeen:'2026-01-01',cycleStartedAt:'2026-02-01'};
const issue={number:6,state:'open',labels:[{name:'vulnerability-register'}],body:issueBody(record),html_url:'https://github.com/owner/hub/issues/6'};
const snapshot={hub:'owner/hub',mode:'github',findings:[record],scans:[],activity:{runs:[]}};
async function fixture(t, overrides={}) {
 const config={origin:'http://127.0.0.1:0',hub:'owner/hub',clientId:'fake-id',clientSecret:'not-a-real-secret',allowedUsers:['owner']};
 const state={user:{id:1,login:'owner'},permission:'admin',dispatched:[],exchanges:[],time:1000000000000,loads:0};
 const api={get:async path=>{
   if(path==='/user')return state.user;
   if(path==='/repos/owner/hub')return {default_branch:'main'};
   if(path.includes('/collaborators/'))return {permission:state.permission};
   if(path==='/repos/owner/hub/issues/6')return issue;
   if(path.includes('/actions/workflows/remediate.yml/runs'))return {workflow_runs:[]};
   throw Error('Unexpected API path '+path);
 },list:async()=>[issue],post:async(path,body)=>{state.dispatched.push({path,body});return null;}};
 const server=createDashboardServer(config,{targets:[target],apiFactory:()=>api,now:()=>state.time,
   fetcher:async(url,options)=>{assert.equal(url,'https://github.com/login/oauth/access_token');state.exchanges.push(JSON.parse(options.body));return Response.json({access_token:'fake-user-token',expires_in:3600});},
   loadSnapshot:async()=>{state.loads++;return snapshot;},...overrides});
 server.listen(0,'127.0.0.1');await once(server,'listening');config.origin='http://127.0.0.1:'+server.address().port;
 t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const request=(path,options={})=>fetch(config.origin+path,{redirect:'manual',...options});
 const login=async()=>{
   const start=await request('/auth/login'), location=new URL(start.headers.get('location'));
   assert.equal(location.origin,'https://github.com');assert.equal(location.searchParams.get('code_challenge_method'),'S256');
   const browser=start.headers.getSetCookie()[0].split(';')[0];
   const callback='/auth/callback?state='+location.searchParams.get('state')+'&code=fake-code';
   const end=await request(callback,{headers:{Cookie:browser}});
   return {start,end,callback,browser,cookie:end.headers.getSetCookie().find(c=>c.startsWith('hub_session='))?.split(';')[0]};
 };
 return {config,state,request,login};
}

test('anonymous dashboard HTML offers sign-in but data, scripts and proxy endpoints are protected',async t=>{
 const f=await fixture(t);
 const page=await f.request('/');assert.equal(page.status,401);assert.match(await page.text(),/Sign in with GitHub/);
 for(const path of ['/register.json','/activity.json','/app.js','/dashboard-mode.json','/api/github/actions/workflows/remediate.yml/runs?per_page=20'])assert.equal((await f.request(path)).status,401);
 assert.equal(f.state.loads,0);
 const wrongHost=await new Promise((resolve,reject)=>{const req=httpRequest(f.config.origin,{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
 assert.equal(wrongHost,403);
});
test('OAuth state is browser bound, single use, and uses PKCE; disallowed users get no session',async t=>{
 const f=await fixture(t), start=await f.request('/auth/login');
 const callback='/auth/callback?state='+new URL(start.headers.get('location')).searchParams.get('state')+'&code=fake';
 assert.equal((await f.request(callback)).status,403);assert.equal(f.state.exchanges.length,0);
 const auth=await f.login();assert.equal(auth.end.status,302);assert.ok(f.state.exchanges[0].code_verifier);assert.equal((await f.request(auth.callback,{headers:{Cookie:auth.browser}})).status,403);
 assert.match(auth.end.headers.getSetCookie()[0],/HttpOnly; SameSite=Lax/);
 f.state.user={id:2,login:'stranger'};const denied=await f.login();assert.equal(denied.end.status,403);assert.equal(denied.cookie,undefined);
});
test('direct fix dispatch carries the selected issue after live permissions and identity checks; duplicate clicks reuse request',async t=>{
 const f=await fixture(t), auth=await f.login();
 const mode=await(await f.request('/dashboard-mode.json',{headers:{Cookie:auth.cookie}})).json();
 const headers={Cookie:auth.cookie,Origin:f.config.origin,'X-CSRF-Token':mode.csrf,'Content-Type':'application/json'};
 const fix=body=>f.request('/api/fix',{method:'POST',headers,body:JSON.stringify(body)});
 const body={issueNumber:6,key:record.key};
 assert.equal((await f.request('/api/fix',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:JSON.stringify(body)})).status,403);
 assert.equal((await f.request('/api/fix',{method:'POST',headers:{...headers,'X-CSRF-Token':'wrong'},body:JSON.stringify(body)})).status,403);
 assert.equal((await fix({...body,key:'tampered'})).status,409);
 f.state.permission='read';assert.equal((await fix(body)).status,403);assert.equal(f.state.dispatched.length,0);
 f.state.permission='admin';
 const result=await Promise.all([fix(body),fix(body)]);assert.ok(result.every(r=>r.status===202));
 assert.deepEqual(f.state.dispatched,[{path:'/repos/owner/hub/actions/workflows/remediate.yml/dispatches',body:{ref:'main',inputs:{issue_number:'6'}}}]);
 const data=await(await f.request('/register.json',{headers:{Cookie:auth.cookie}})).text();assert.equal(data.includes('fake-user-token'),false);
 assert.equal((await f.request('/api/github/user',{headers:{Cookie:auth.cookie}})).status,404);
 assert.equal((await f.request('/auth/logout',{method:'POST',headers})).status,200);
 assert.equal((await f.request('/register.json',{headers:{Cookie:auth.cookie}})).status,401);
});
test('expired sessions cannot fetch the snapshot or request a fix',async t=>{
 const f=await fixture(t), auth=await f.login();f.state.time+=3600001;
 assert.equal((await f.request('/register.json',{headers:{Cookie:auth.cookie}})).status,401);assert.equal(f.state.loads,0);
});
test('configuration requires HTTPS off loopback and explicit account allowlist',()=>{
 const env={DASHBOARD_CLIENT_ID:'id',DASHBOARD_CLIENT_SECRET:'secret'};
 assert.equal(dashboardConfig(env).origin,'http://127.0.0.1:4180');
 for(const origin of ['http://example.com','http://localhost:4180','https://user:password@example.com','https://example.com/path'])assert.throws(()=>dashboardConfig({...env,DASHBOARD_ORIGIN:origin}));
 assert.throws(()=>dashboardConfig({...env,DASHBOARD_ALLOWED_USERS:'*'}));
 assert.throws(()=>dashboardConfig({}));
});
test('snapshot extraction selects only bounded register JSON and rejects another hub',()=>{
 const zip=zipSync({'site/register.json':strToU8(JSON.stringify(snapshot)),'../../outside':strToU8('ignored')});
 assert.deepEqual(snapshotFromArchive(zip,'owner/hub'),snapshot);
 assert.throws(()=>snapshotFromArchive(zip,'different/hub'),/identity/);
 assert.throws(()=>snapshotFromArchive(zipSync({'register.json':strToU8('{}')}),'owner/hub'),/missing/);
 assert.throws(()=>snapshotFromArchive(zipSync({'site/register.json':new Uint8Array(10*1024*1024+1)}),'owner/hub'),/entry/);
});
test('snapshot loader never silently falls back to an older successful scan after a newer failure',async()=>{
 const api={token:'fake',get:async path=>path==='/repos/owner/hub'?{default_branch:'main'}:path.includes('/workflows/')?{workflow_runs:[{id:12,run_attempt:1,event:'workflow_dispatch',conclusion:'failure',head_repository:{full_name:'owner/hub'}}]}:{artifacts:[]}};
 await assert.rejects(snapshotLoader()(api,'owner/hub'),/Latest scan/);
});
