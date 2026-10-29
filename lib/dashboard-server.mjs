import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { GitHub } from './github.mjs';
import { remediationRecord } from './fix-request.mjs';
import { readRegister } from './register.mjs';
import { packageScope, normalizeRun, progressFor } from '../dashboard/activity.js';
import { snapshotLoader } from './dashboard-snapshot.mjs';

const random = () => randomBytes(32).toString('base64url');
const equal = (a,b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const html = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class HttpError extends Error { constructor(status,message) {super(message);this.status=status;} }

export function dashboardConfig(env) {
  const origin = new URL(env.DASHBOARD_ORIGIN || 'http://127.0.0.1:4180');
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password ||
      (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && origin.hostname === '127.0.0.1'))) throw new Error('Use HTTPS, or http://127.0.0.1 for a local demo');
  const hub = env.DASHBOARD_HUB || 'vc4u2c/github-action-codex';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(hub)) throw new Error('Invalid dashboard hub');
  const allowedUsers = (env.DASHBOARD_ALLOWED_USERS || hub.split('/')[0]).split(',').map(s=>s.trim().toLowerCase());
  if (!allowedUsers.every(s=>/^[a-z0-9-]+$/.test(s))) throw new Error('List explicit allowed GitHub logins');
  if (!env.DASHBOARD_CLIENT_ID || !env.DASHBOARD_CLIENT_SECRET) throw new Error('Configure the dashboard GitHub App client ID and secret');
  return {origin: origin.origin, hub, allowedUsers, clientId: env.DASHBOARD_CLIENT_ID, clientSecret: env.DASHBOARD_CLIENT_SECRET};
}

export function createDashboardServer(config, {targets, fetcher = fetch, apiFactory = token => new GitHub(token,fetcher), loadSnapshot = snapshotLoader(fetcher), now = Date.now} = {}) {
  const origin = new URL(config.origin), secure = origin.protocol === 'https:';
  const sessionName = secure ? '__Host-hub_session' : 'hub_session';
  const sessions = new Map(), logins = new Map(), requests = new Map();
  const cookie = (name,value,seconds) => name+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+seconds+(secure?'; Secure':'');
  const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(v=>v.trim().split('=')));
  const send = (res,status,body,type='application/json',headers={}) => {
    res.writeHead(status, {'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
      'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
      'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      ...(secure?{'Strict-Transport-Security':'max-age=31536000'}:{}),...headers});
    res.end(type==='application/json'?JSON.stringify(body):body);
  };
  const redirect = (res,path,headers={}) => send(res,302,'','text/plain',{Location:path,...headers});
  const publicPage = (res,status,message) => send(res,status,'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in - Vulnerability Hub</title><link rel="stylesheet" href="/login.css"><main><h1>Vulnerability Hub</h1><p>'+html(message)+'</p><p><a class="request-fix" href="/auth/login">Sign in with GitHub</a></p><p>Access is limited to the configured GitHub accounts. Fix requests also require write access to '+html(config.hub)+'.</p></main></html>','text/html; charset=utf-8');
  const identity = async token => {
    const api = apiFactory(token), user = await api.get('/user');
    if (!config.allowedUsers.includes(user.login?.toLowerCase())) throw new HttpError(403,'This GitHub account is not allowed to view the dashboard.');
    await api.get('/repos/'+config.hub); // The user's App token must be able to access this installation.
    return {api,user};
  };
  const requireSession = async req => {
    const id = cookies(req)[sessionName], session = sessions.get(id);
    if (!session || session.expires <= now()) {sessions.delete(id);throw new HttpError(401,'Sign in to continue.');}
    if (now()-session.checkedAt > 60000) {
      try {const {user} = await identity(session.token);if(user.id!==session.user.id)throw Error('Identity changed');session.checkedAt=now();}
      catch {sessions.delete(id);throw new HttpError(401,'Access could not be verified. Sign in again.');}
    }
    return {session,id,api:apiFactory(session.token)};
  };
  const csrf = (req,session) => {
    if (req.headers.origin !== config.origin || !equal(req.headers['x-csrf-token'],session.csrf)) throw new HttpError(403,'Invalid request origin or CSRF token.');
  };
  const jsonBody = async req => {
    if (req.headers['content-type'] !== 'application/json') throw new HttpError(415,'Expected JSON.');
    const chunks=[];let size=0;
    for await(const chunk of req) {size+=chunk.length;if(size>2048)throw new HttpError(413,'Request too large.');chunks.push(chunk);}
    try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(400,'Invalid JSON.');}
  };
  const assets = new Map(['index.html','app.js','activity.js','validation.js','style.css'].map(file=>['/'+file,file]));
  return createServer(async (req,res) => {
    try {
      if (req.headers.host !== new URL(config.origin).host) throw new HttpError(403,'Invalid host.');
      const url = new URL(req.url,config.origin), path=url.pathname;
      if (req.method==='GET' && path==='/login.css') return send(res,200,await readFile(new URL('../dashboard/style.css',import.meta.url)),'text/css');
      if (req.method==='GET' && path==='/auth/login') {
        if (req.headers['sec-fetch-site']==='cross-site') throw new HttpError(403,'Open this dashboard first.');
        for(const [key,value] of logins) if(value.expires<=now())logins.delete(key);
        for(const [key,value] of sessions) if(value.expires<=now())sessions.delete(key);
        if(logins.size>=100 || sessions.size>=100)throw new HttpError(429,'Too many sign-in sessions. Try again shortly.');
        const state=random(), verifier=random(), browser=random();
        logins.set(state,{verifier,browser,expires:now()+600000});
        const auth=new URL('https://github.com/login/oauth/authorize');
        auth.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.origin+'/auth/callback',state,
          code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',allow_signup:'false'}).toString();
        return redirect(res,auth.href,{'Set-Cookie':cookie('hub_login',browser,600)});
      }
      if (req.method==='GET' && path==='/auth/callback') {
        const state=url.searchParams.get('state'), login=logins.get(state);logins.delete(state);
        if (!login || login.expires<=now() || !equal(login.browser,cookies(req).hub_login)) throw new HttpError(403,'Sign-in state expired or did not match this browser.');
        const code=url.searchParams.get('code');
        if(!code || code.length>512)throw new HttpError(400,'GitHub authorization was not completed.');
        const response=await fetcher('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},
          body:JSON.stringify({client_id:config.clientId,client_secret:config.clientSecret,code,redirect_uri:config.origin+'/auth/callback',code_verifier:login.verifier}),signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new HttpError(502,'GitHub sign-in failed. Try again.');
        const credentials=await response.json();if(!credentials.access_token)throw new HttpError(403,'GitHub did not authorize the application.');
        const {user}=await identity(credentials.access_token), id=random();
        const seconds=Math.min(14400,Number.isFinite(credentials.expires_in)?credentials.expires_in:14400);
        if(seconds<=0)throw new HttpError(403,'GitHub authorization expired.');
        const old=cookies(req)[sessionName];if(old)sessions.delete(old);
        sessions.set(id,{token:credentials.access_token,user,csrf:random(),expires:now()+seconds*1000,checkedAt:now()});
        return redirect(res,'/',{'Set-Cookie':[cookie(sessionName,id,seconds),cookie('hub_login','',0)]});
      }
      let auth;
      try {auth=await requireSession(req);} catch(error) {
        if(error.status===401 && req.method==='GET' && (path==='/'||path==='/index.html'))return publicPage(res,401,'Sign in to view findings, validation evidence, and remediation progress.');
        throw error;
      }
      const {session,id,api}=auth;
      if(req.method==='POST' && path==='/auth/logout') {csrf(req,session);sessions.delete(id);return send(res,200,{signedOut:true},'application/json',{'Set-Cookie':cookie(sessionName,'',0)});}
      if(req.method==='GET' && path==='/dashboard-mode.json') return send(res,200,{authentication:'github',login:session.user.login,csrf:session.csrf});
      if(req.method==='GET' && (path==='/register.json'||path==='/activity.json')) {
        const snapshot=await loadSnapshot(api,config.hub);return send(res,200,path==='/activity.json'?snapshot.activity:snapshot);
      }
      if(req.method==='GET' && path.startsWith('/api/github/')) {
        const tail=path.slice('/api/github'.length);
        if(tail==='/actions/workflows/remediate.yml/runs' && url.search==='?per_page=20')return send(res,200,await api.get('/repos/'+config.hub+tail+url.search));
        if(/^\/actions\/runs\/[0-9]+\/attempts\/[0-9]+\/jobs$/.test(tail) && url.search==='?per_page=100')return send(res,200,await api.get('/repos/'+config.hub+tail+url.search));
        throw new HttpError(404,'Unknown API route.');
      }
      if(req.method==='POST' && path==='/api/fix') {
        csrf(req,session);const body=await jsonBody(req);
        if(!Number.isSafeInteger(body.issueNumber)||body.issueNumber<1||typeof body.key!=='string')throw new HttpError(400,'Invalid finding selection.');
        const {user}=await identity(session.token);
        const access=await api.get('/repos/'+config.hub+'/collaborators/'+encodeURIComponent(user.login)+'/permission');
        if(!['write','admin'].includes(access.permission))throw new HttpError(403,'Write access to the hub is required.');
        const issue=await api.get('/repos/'+config.hub+'/issues/'+body.issueNumber);
        const {record}=remediationRecord(issue,targets);
        if(record.key!==body.key)throw new HttpError(409,'The finding identity changed. Refresh the dashboard.');
        if(record.status!=='open')throw new HttpError(409,'This finding already has a fix or is awaiting verification.');
        const records=await readRegister(api,config.hub);
        const payload=await api.get('/repos/'+config.hub+'/actions/workflows/remediate.yml/runs?per_page=20');
        const progress=progressFor(record,records,payload.workflow_runs.map(normalizeRun).filter(Boolean));
        const workflowUrl='https://github.com/'+config.hub+'/actions/workflows/remediate.yml';
        if(['Running','Requested / queued','Refreshing register'].includes(progress.label))return send(res,202,{issueNumber:body.issueNumber,alreadyRequested:true,workflowUrl,runUrl:progress.run.url});
        const repository=await api.get('/repos/'+config.hub);
        const scope=packageScope(record), recent=requests.get(scope);
        if(recent && now()-recent<60000)return send(res,202,{issueNumber:body.issueNumber,alreadyRequested:true,workflowUrl});
        requests.set(scope,now()); // Lock before awaiting dispatch; retain on an ambiguous timeout.
        for(const [key,time] of requests)if(now()-time>60000)requests.delete(key);
        await api.post('/repos/'+config.hub+'/actions/workflows/remediate.yml/dispatches',{ref:repository.default_branch,inputs:{issue_number:String(body.issueNumber)}});
        return send(res,202,{issueNumber:body.issueNumber,workflowUrl});
      }
      if(req.method==='GET' && (path==='/'||assets.has(path))) {
        const file=path==='/'?'index.html':assets.get(path), type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8';
        return send(res,200,await readFile(new URL('../dashboard/'+file,import.meta.url)),type);
      }
      throw new HttpError(404,'Not found.');
    } catch(error) {
      // Never expose OAuth responses, tokens, or raw GitHub errors to the browser/logs.
      send(res,error.status || 502,{error:error.status?error.message:'GitHub could not complete the request. Check Actions before retrying a fix.'});
    }
  });
}
