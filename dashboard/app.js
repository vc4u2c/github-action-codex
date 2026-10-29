import { validationForFinding, verificationForRun, validationChecks } from './validation.js';
import { normalizeRun, jobDetails, progressFor, packageScope } from './activity.js';
const $ = selector => document.querySelector(selector);
const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
const date = value => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const badge = (text, kind) => node('span', text.replaceAll('-', ' '), 'badge ' + kind);
function link(text, url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return node('span', text);
    const a = node('a', text); a.href = parsed.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  } catch { return node('span', text); }
}
async function boot() {
  const modeResponse = await fetch('dashboard-mode.json', {cache:'no-store'});
  if (!modeResponse.ok) throw new Error('Could not load dashboard access mode');
  const access = await modeResponse.json(), protectedMode = access.authentication === 'github';
  $('#access').textContent = protectedMode ? 'Signed in as ' + access.login : 'Public demo';
  $('#logout').hidden = !protectedMode;
  $('#logout').addEventListener('click', async () => {
    const response = await fetch('/auth/logout', {method:'POST',headers:{'X-CSRF-Token':access.csrf}});
    if (response.ok) location.assign('/');
  });
  const requested = new Map();
  async function requestFix(finding) {
    const scope = packageScope(finding);
    if (requested.has(scope)) return;
    requested.set(scope, Date.now()); render();
    const status = $('#request-status'); status.hidden = false; status.replaceChildren(node('span','Requesting a fix for register #' + finding.issueNumber + '...'));
    try {
      const response = await fetch('/api/fix', {method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':access.csrf},
        body:JSON.stringify({issueNumber:finding.issueNumber,key:finding.key})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Request failed');
      status.replaceChildren(node('span',(result.alreadyRequested ? 'A fix is already requested' : 'Fix requested') + ' for register #' + result.issueNumber + '. '),link('View workflow',result.runUrl || result.workflowUrl));
    } catch(error) {
      requested.delete(scope); status.textContent = error.message + ' Check Actions before retrying.';
    } finally { render(); }
  }

  const response = await fetch('register.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load the register');
  const data = await response.json();
  $('#mode').textContent = data.mode === 'local' ? 'Local scan · preview' : 'GitHub register';
  $('#updated').textContent = 'Snapshot ' + new Date(data.generatedAt).toLocaleString();
  const workflowUrl = data.mode === 'github' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(data.hub || '')
    ? 'https://github.com/' + data.hub + '/actions/workflows/remediate.yml' : null;
  $('#request-help').hidden = !workflowUrl;
  if (protectedMode) $('#request-help').textContent = 'Request fix sends this finding to the workflow automatically. Your GitHub identity and write access are checked on the server. Codex proposes a PR; review and merge it to trigger verification on main.';
  let runs = data.activity?.runs || [];
  const active = data.findings.filter(f => f.status !== 'resolved');
  const metrics = [['Active findings', active.length, ''], ['Critical / high', active.filter(f => ['critical','high'].includes(f.severity)).length, 'danger'],
    ['PRs in review', new Set(active.filter(f => f.status === 'pr-open').map(f => f.remediation?.url)).size, ''], ['Verified resolved', data.findings.length - active.length, 'good']];
  for (const [label, value, cls] of metrics) { const card = node('article', undefined, 'stat ' + cls); card.append(node('p', label), node('strong', value)); $('#stats').append(card); }
  for (const scan of data.scans) {
    const row = node('div', undefined, 'target');
    const desc = node('div'); desc.append(node('strong', scan.target.repository), node('p', scan.target.directory + ' · npm dependencies', 'muted'));
    const evidence = node('div', undefined, 'evidence');
    evidence.append(badge(scan.success ? 'Scan complete' : 'Scan failed', scan.success ? 'resolved' : 'critical'),
      node('p', scan.success ? (scan.sha || '').slice(0, 12) + ' · ' + date(scan.scannedAt) : scan.error, 'muted'));
    row.append(desc, evidence); $('#targets').append(row);
  }
  const priority = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
  function render() {
    const query = $('#search').value.toLowerCase(), status = $('#status').value, severity = $('#severity').value;
    const records = data.findings.filter(f => (!query || [f.package, f.advisoryId, f.repository, f.title].join(' ').toLowerCase().includes(query)) &&
      (!severity || f.severity === severity) && (!status || (status === 'active' ? f.status !== 'resolved' : f.status === status)))
      .sort((a,b) => (a.status === 'resolved') - (b.status === 'resolved') || priority[a.severity] - priority[b.severity]);
    $('#findings').replaceChildren();
    const offered = new Set();
    for (const f of records) {
      const row = node('tr'), finding = node('td'); finding.append(node('strong', f.package), node('small', f.title), link(f.advisoryId, f.url));
      const sev = node('td'); sev.append(badge(f.severity, f.severity));
      const repo = node('td'); repo.append(node('span', f.repository), node('small', f.manifest));
      const state = node('td'); state.append(badge(f.status, f.status));
      const dates = node('td'); dates.append(node('span', date(f.firstSeen)), node('small', f.resolvedAt ? 'Resolved ' + date(f.resolvedAt) : 'Still active'));
      const progress = progressFor(f, data.findings, runs), activity = node('td',undefined,'activity');
      activity.append(badge(progress.label,progress.kind));
      if (progress.detail) activity.append(node('small',progress.detail));
      if (progress.run) activity.append(link('View run ↗',progress.run.url));
      const validation = node('td', undefined, 'validation');
      const evidence = validationForFinding(f, data.findings, runs, data.scans);
      for (const [title, check] of [['Proposal', evidence.proposal], ['Main branch', evidence.main]]) {
        const section = node('div'); section.append(node('small', title), badge(check.label, check.kind));
        const details = node('details'); details.append(node('summary', 'Evidence'), node('small', check.detail));
        if (check.receipt) {
          for (const name of validationChecks) details.append(node('small', name + ': passed'));
          details.append(node('small', 'Verified ' + check.receipt.verifiedAt), node('small', 'PR commit ' + check.receipt.headSha.slice(0,12)));
        }
        if (check.url) details.append(link(title === 'Proposal' ? 'Verification run' : 'Scanned commit', check.url));
        if (check.runUrl) details.append(link('Scan run', check.runUrl));
        section.append(details); validation.append(section);
      }
      const links = node('td', undefined, 'links');
      if (f.issueUrl) links.append(link('Register #' + f.issueNumber, f.issueUrl));
      const scope=packageScope(f), group=data.findings.filter(other=>other.status==='open' && packageScope(other)===scope);
      if (f.status === 'open' && (requested.has(scope) || ['Running','Requested / queued','Refreshing register'].includes(progress.label))) {
        links.append(node('small','Fix already requested'));
      } else if (f.status === 'open' && offered.has(scope)) {
        links.append(node('small','Shares the '+f.package+' fix'));
      } else if (f.status === 'open' && workflowUrl && Number.isSafeInteger(f.issueNumber) && f.issueNumber > 0) {
        const request = protectedMode ? node('button','Request fix') : link('Request fix', workflowUrl);
        request.classList.add('request-fix');
        request.title = (protectedMode ? 'Start a fix for register issue #' : 'Open GitHub Run workflow for register issue #') + f.issueNumber;
        if (protectedMode) {request.type='button';request.addEventListener('click',()=>requestFix(f));}
        links.append(request, node('small', (protectedMode ? 'Register #' : 'Enter issue #') + f.issueNumber),node('small','One PR for '+group.length+' package advisories'));
        offered.add(scope);
      }
      if (f.remediation?.url) links.append(link((f.status === 'pr-open' ? 'Review PR #' : 'PR #') + f.remediation.number, f.remediation.url));
      if (!links.childNodes.length) links.append(node('span', 'Local preview', 'muted'));
      row.append(finding, sev, repo, state, dates, activity, validation, links); $('#findings').append(row);
    }
    $('#count').textContent = records.length + ' findings'; $('#empty').hidden = records.length > 0;
  }
  for (const id of ['search','status','severity']) $('#' + id).addEventListener('input', render);
  function renderRuns() {
    $('#runs').replaceChildren();
    for (const run of runs.slice(0,20)) {
      const row=node('tr'), name=node('td'); name.append(link('#'+run.id+' / attempt '+run.attempt,run.url),node('small','Register #'+run.issueNumber));
      const result=node('td');result.append(badge(run.conclusion || run.status,run.conclusion==='failure'?'failed':run.conclusion==='success'?'resolved':'running'));
      const verification = verificationForRun(run), verified = node('td');
      verified.append(badge(verification.label, verification.kind), node('small', verification.detail));
      if (verification.url) verified.append(link('Verifier job', verification.url));
      const usage=node('td'); usage.append(node('span',run.usage ? run.usage.inputTokens.toLocaleString()+' input / '+run.usage.outputTokens.toLocaleString()+' output' : run.modelSkipped ? 'Not called' : 'Unavailable'),node('small',run.usage ? run.usage.cachedInputTokens.toLocaleString()+' cached input · '+(run.model || 'model in logs') : run.modelSkipped ? 'Proposal job skipped; existing PR or no current finding' : 'See run logs; this does not mean zero usage'));
      const duration=node('td',run.durationSeconds==null?'—':Math.round(run.durationSeconds/60*10)/10+' min');
      row.append(name,result,verified,usage,duration);$('#runs').append(row);
    }
    $('#no-runs').hidden=runs.length>0;
  }
  let busy=false, lastRefresh=0;
  async function refreshActivity() {
    if (!workflowUrl || busy || Date.now()-lastRefresh<15000 || document.hidden) return;
    busy=true; lastRefresh=Date.now(); $('#refresh-activity').disabled=true;
    const get=async path=>{const r=await fetch((protectedMode?'/api/github':'https://api.github.com/repos/'+data.hub)+path,{credentials:protectedMode?'same-origin':'omit',headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('GitHub '+r.status);return r.json();};
    try {
      const payload=await get('/actions/workflows/remediate.yml/runs?per_page=20');
      runs=payload.workflow_runs.map(normalizeRun).filter(Boolean).map(r=>({...runs.find(old=>old.id===r.id && old.attempt===r.attempt),...r}));
      // Fetch only a few changing job summaries; completed details/usage come from the scan snapshot.
      for (const run of runs.filter(r=>r.status==='in_progress' || (r.conclusion==='failure'&&!r.jobs)).slice(0,2)) {
        try {run.jobs=jobDetails((await get('/actions/runs/'+run.id+'/attempts/'+run.attempt+'/jobs?per_page=100')).jobs);} catch { /* run link remains available */ }
      }
      $('#activity-help').textContent='Live run status checked '+new Date().toLocaleTimeString()+'. Finding resolution and usage update after the next scan.';
    } catch {
      $('#activity-help').textContent='Live status unavailable (GitHub access or rate limit). Showing the last available data; use View run for current details.';
    } finally {busy=false;$('#refresh-activity').disabled=false;render();renderRuns();}
  }
  $('#activity-panel').hidden=!workflowUrl;
  $('#refresh-activity').addEventListener('click',refreshActivity);
  window.addEventListener('focus',refreshActivity);
  setInterval(refreshActivity,120000);
  render();renderRuns();await refreshActivity();
}
boot().catch(error => { $('#error').hidden = false; $('#error').textContent = error.message + '. Generate a scan and serve this folder over HTTP.'; $('#mode').textContent = 'Unavailable'; });
