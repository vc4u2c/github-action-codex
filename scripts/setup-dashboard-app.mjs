// Local interactive setup. GitHub creation/installation always happens in the user's browser.
import http from 'node:http';
import { randomBytes, createSign } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveDashboardCredentials, loadDashboardCredentials } from '../lib/local-dashboard-credentials.mjs';
const hub=process.env.DASHBOARD_HUB || 'vc4u2c/github-action-codex';
if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(hub))throw Error('Invalid hub');
if(process.platform!=='win32')throw Error('Use the environment-variable setup in docs/dashboard-access.md on this platform.');
const stored=await loadDashboardCredentials();
if(stored.DASHBOARD_CLIENT_ID){console.log('Dashboard credentials already configured. Run npm run dashboard:secure and sign in.');process.exit(0);}
const owner=hub.split('/')[0], origin='http://127.0.0.1:4180', base='http://127.0.0.1:4181';
const session=randomBytes(24).toString('hex'),state=randomBytes(24).toString('hex');
let app,ready=false,busy=false;
const permissions={contents:'read',issues:'read',actions:'write'};
function gh(args,input,token) {
 const r=spawnSync('gh',args,{encoding:'utf8',input,windowsHide:true,timeout:30000,maxBuffer:4*1024*1024,
   env:{...process.env,GH_DEBUG:'',GH_PROMPT_DISABLED:'1',...(token?{GH_TOKEN:token,GITHUB_TOKEN:''}:{})}});
 if(r.error||r.status!==0)throw Error('GitHub setup request failed. Check gh sign-in and try again.');
 return r.stdout;
}
function api(path,method='GET',token) {return JSON.parse(gh(['api',path,'--method',method],undefined,token));}
const me=api('/user');if(me.login.toLowerCase()!==owner.toLowerCase())throw Error('Sign in to gh as the hub owner for this local demo setup.');
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function jwt() {
 const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),time=Math.floor(Date.now()/1000);
 const value=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iat:time-60,exp:time+300,iss:String(app.id)});
 return value+'.'+createSign('RSA-SHA256').update(value).sign(app.pem).toString('base64url');
}
const manifest={name:owner+'-vuln-dashboard-'+Date.now().toString(36),url:'https://github.com/'+hub,public:false,
 description:'GitHub sign-in and authorized vulnerability fix requests for the demo dashboard.',
 hook_attributes:{url:'https://github.com/'+hub,active:false},redirect_url:base+'/created',
 setup_url:base+'/installed?state='+state,callback_urls:[origin+'/auth/callback'],
 default_permissions:permissions,default_events:[],request_oauth_on_install:false};
function page(message='') {
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard sign-in setup</title><style>body{font:17px system-ui;max-width:800px;margin:50px auto;padding:24px;line-height:1.6}button,a{font:inherit}button{padding:12px}code{background:#eee}</style><h1>Connect dashboard sign-in</h1><p>'+esc(message)+'</p><p>This separate GitHub App signs you in and requests fixes as your GitHub identity. Install it only on <strong>'+esc(hub)+'</strong>. It can read contents/issues and dispatch Actions; it has no application-code write permission or OpenAI key.</p>'+
 (ready?'<p>Ready. <a href="'+origin+'">Open the protected dashboard</a> and choose <b>Sign in with GitHub</b>.</p>':app?'<p><a href="https://github.com/apps/'+esc(app.slug)+'/installations/new">Install the Dashboard App</a></p><p>Choose <b>Only select repositories</b>, then select '+esc(hub)+'.</p><form method="post" action="/verify?session='+session+'"><button>Verify installation and start dashboard</button></form>':'<form method="post" action="https://github.com/settings/apps/new?state='+state+'"><input type="hidden" name="manifest" value="'+esc(JSON.stringify(manifest))+'"><button>Create Dashboard App</button></form>')+
 '<p>The local OAuth credentials are encrypted for this Windows account using DPAPI. They are not committed or printed. The existing public Pages site stays unchanged until the protected dashboard is verified.</p></html>';
}
function send(res,status,body) {res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; frame-ancestors 'none'; base-uri 'none'"});res.end(body);}
async function finish() {
 const token=jwt(),install=api('/repos/'+hub+'/installation','GET',token);
 if(install.app_id!==app.id||install.suspended_at||install.account.login.toLowerCase()!==owner.toLowerCase()||install.repository_selection!=='selected')throw Error('Install this App on only the hub repository first.');
 for(const [name,value]of Object.entries(permissions))if(install.permissions[name]!==value)throw Error('App installation permissions do not match.');
 const access=api('/app/installations/'+install.id+'/access_tokens','POST',token);
 try {const repos=api('/installation/repositories?per_page=100','GET',access.token);if(repos.total_count!==1||repos.repositories[0].full_name!==hub)throw Error('Select only '+hub+' for this App.');}
 finally{gh(['api','/installation/token','--method','DELETE'],undefined,access.token);}
 const credentials={DASHBOARD_HUB:hub,DASHBOARD_ORIGIN:origin,DASHBOARD_ALLOWED_USERS:me.login,DASHBOARD_CLIENT_ID:app.client_id,DASHBOARD_CLIENT_SECRET:app.client_secret};
 await saveDashboardCredentials(credentials);
 if(!ready){const child=spawn(process.execPath,['scripts/dashboard-server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),windowsHide:true,detached:true,stdio:'ignore',env:{...process.env,...credentials}});child.unref();}
 ready=true;console.log('Dashboard App installed. Encrypted local credentials saved. Open '+origin+' to sign in.');
}
const server=http.createServer(async(req,res)=>{
 if(req.headers.host!=='127.0.0.1:4181')return send(res,403,'Invalid host');
 const url=new URL(req.url,base);
 try {
  if(req.method==='GET'&&url.pathname==='/'&&url.searchParams.get('session')===session)return send(res,200,page());
  if(req.method==='GET'&&url.pathname==='/created'){
   if(url.searchParams.get('state')!==state||!/^[A-Za-z0-9_-]{10,200}$/.test(url.searchParams.get('code')||''))return send(res,403,'Invalid setup callback');
   if(busy)return send(res,409,'Setup in progress');busy=true;
   try{if(!app){const result=api('/app-manifests/'+url.searchParams.get('code')+'/conversions','POST');
    if(result.owner?.login?.toLowerCase()!==owner.toLowerCase()||!result.client_id||!result.client_secret||!result.pem||!Number.isSafeInteger(result.id)||!/^[a-z0-9-]+$/.test(result.slug))throw Error('App identity did not match this setup.');app=result;}
    return send(res,200,page('App created. Install it on the hub repository.'));
   }finally{busy=false;}
  }
  const installed=req.method==='GET'&&url.pathname==='/installed'&&url.searchParams.get('state')===state;
  const verify=req.method==='POST'&&url.pathname==='/verify'&&url.searchParams.get('session')===session&&req.headers.origin===base;
  if((installed||verify)&&app){if(busy)return send(res,409,'Setup in progress');busy=true;try{await finish();return send(res,200,page('Ready to sign in.'));}finally{busy=false;}}
  send(res,403,'Open the setup link supplied in your terminal or chat.');
 }catch{send(res,400,page('Setup could not complete. Check the selected account, repository and installation, then retry.'));}
});
server.listen(4181,'127.0.0.1',()=>console.log('Dashboard setup: '+base+'/?session='+session));
setTimeout(()=>{server.close();process.exit(0);},3600000).unref();
