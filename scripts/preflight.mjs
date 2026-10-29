// Read-only readiness checks. Never reads secret values or calls the OpenAI API.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { run, npmCommand } from '../lib/process.mjs';
import { loadTargets } from '../lib/config.mjs';
const checks=[];
const check=async(name,fn)=>{try{const detail=await fn();checks.push({name,status:'PASS',detail:detail || 'Ready'});}catch(error){checks.push({name,status:'FAIL',detail:error.message});}};
const command=async(cmd,args)=>{const r=await run(cmd,args,{timeout:30000});if(r.code!==0)throw new Error(cmd+' failed; check installation, sign-in, and repository permissions');return r.stdout.trim();};
const gh=process.platform==='win32'?'gh.exe':'gh';
const api=async path=>JSON.parse(await command(gh,['api',path]));
const args=process.argv.slice(2), pos=args.indexOf('--hub');
const hub=pos>=0?args[pos+1]:await command(gh,['repo','view','--json','nameWithOwner','--jq','.nameWithOwner']);
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(hub || '')) throw new Error('Usage: node scripts/preflight.mjs --hub OWNER/HUB [--containers]');
await check('Node.js',()=>{if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22 or newer is required');return process.version;});
await check('npm',async()=>{const [cmd,argv]=npmCommand(['--version']);return command(cmd,argv);});
await check('Git',()=>command('git',['--version']));
await check('GitHub CLI sign-in',()=>command(gh,['api','user','--jq','.login']));
const targets=await loadTargets();
await check('Hub write access',async()=>{const repo=await api('repos/'+hub);if(!repo.permissions?.push)throw new Error('Write access to '+hub+' is required');return hub;});
const secretNames=async repo=>new Set((await api('repos/'+repo+'/actions/secrets?per_page=100')).secrets.map(s=>s.name));
const vars=async repo=>Object.fromEntries((await api('repos/'+repo+'/actions/variables?per_page=100')).variables.map(v=>[v.name,v.value]));
await check('Hub secret names',async()=>{const names=await secretNames(hub);for(const name of ['HUB_APP_PRIVATE_KEY','OPENAI_API_KEY'])if(!names.has(name))throw new Error('Missing '+name);return 'Required names exist; values and API credit are not inspected';});
await check('Hub variables / Pages',async()=>{const v=await vars(hub);if(!v.HUB_APP_ID || !v.CODEX_MODEL)throw new Error('Set HUB_APP_ID and CODEX_MODEL');if(v.PUBLISH_DASHBOARD==='true'){const pages=await api('repos/'+hub+'/pages');if(pages.build_type!=='workflow')throw new Error('Pages must use GitHub Actions');}return 'Model: '+v.CODEX_MODEL+'; Pages: '+(v.PUBLISH_DASHBOARD==='true'?'enabled':'artifact only');});
for (const name of ['scan.yml','remediate.yml','reset-demo.yml','refresh-after-remediation.yml']) await check('Workflow '+name,async()=>{const w=await api('repos/'+hub+'/actions/workflows/'+name);if(w.state!=='active')throw new Error('Workflow is disabled');});
for (const target of targets) {
 await check(target.id+' repository / manifests',async()=>{const repo=await api('repos/'+target.repository);if(!repo.permissions?.push)throw new Error('Write access is needed to review/merge the demo PRs');for(const file of ['package.json','package-lock.json']){const path=(target.directory==='.'?'':target.directory+'/')+file;const f=await api('repos/'+target.repository+'/contents/'+path+'?ref='+encodeURIComponent(repo.default_branch));if(f.type!=='file')throw new Error('Missing '+file);}return target.repository;});
 await check(target.id+' notifier',async()=>{const v=await vars(target.repository),names=await secretNames(target.repository);if(v.HUB_REPOSITORY!==hub || !v.NOTIFIER_APP_ID || !names.has('NOTIFIER_APP_PRIVATE_KEY'))throw new Error('Set matching HUB_REPOSITORY, NOTIFIER_APP_ID, NOTIFIER_APP_PRIVATE_KEY');});
 if(target.demo) await check(target.id+' reset baseline',async()=>{await api('repos/'+target.repository+'/git/commits/'+target.demo.baselineCommit);return target.demo.baselineCommit;});
 await check(target.id+' open PRs',async()=>{const prs=await api('repos/'+target.repository+'/pulls?state=open&per_page=100');return prs.length ? prs.length+' open PR(s); review before reset' : 'None; reset may be started';});
}
if(args.includes('--containers')) await check('Linux Docker engine',async()=>{const os=await command('docker',['info','--format','{{.OSType}}']);if(os!=='linux')throw new Error('Start Docker with Linux containers');return os;});
const report={checkedAt:new Date().toISOString(),hub,checks,limits:['No secrets are read; key validity, model access, billing credit and installation permissions are proven by actual workflow runs, not this check.','No workflows or paid model calls are started.']};
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/preflight.json',JSON.stringify(report,null,2));
for(const c of checks)console.log(c.status+' '+c.name+': '+c.detail);
console.log(report.limits.join('\n'));console.log('Evidence: artifacts/preflight.json');
if(checks.some(c=>c.status==='FAIL'))process.exitCode=1;
