export const packageScope = f => [f.repository.toLowerCase(), f.manifest, f.package].join(':');
export function normalizeRun(run) {
  const match=/^Remediate register issue #(\d+)$/.exec(run.display_title || run.name || '');
  if (!match || run.event !== 'workflow_dispatch' || !Number.isSafeInteger(run.id)) return null;
  return {id:run.id, attempt:run.run_attempt || 1, issueNumber:Number(match[1]), status:run.status,
    conclusion:run.conclusion, url:run.html_url, createdAt:run.run_started_at || run.created_at, updatedAt:run.updated_at};
}
export function jobDetails(jobs) {
  return jobs.map(j => ({name:j.name,status:j.status,conclusion:j.conclusion,url:j.html_url,
    startedAt:j.started_at,completedAt:j.completed_at,
    step:(j.steps || []).find(s=>s.conclusion==='failure' || s.conclusion==='timed_out' || s.status==='in_progress')?.name || null}));
}
export function progressFor(finding, findings, runs) {
  const base = finding.status === 'resolved' ? {label:'Resolved',kind:'resolved'} : finding.status === 'pr-open' ? {label:'PR ready',kind:'pr-open'} : null;
  const group=new Set(findings.filter(f=>packageScope(f)===packageScope(finding)).map(f=>f.issueNumber));
  const since=Date.parse(finding.cycleStartedAt || finding.firstSeen || 0);
  const rank=r=>r.status==='in_progress'?0:r.status==='completed'?2:1;
  const run=runs.filter(r=>group.has(r.issueNumber) && Date.parse(r.createdAt)>=since)
    .sort((a,b)=>rank(a)-rank(b) || Date.parse(b.createdAt)-Date.parse(a.createdAt) || b.id-a.id)[0];
  if (base) return {...base,run};
  if (!run) return {label:finding.status==='awaiting-verification'?'Verifying merge':'Not requested',kind:'open'};
  if (run.status!=='completed') {
    const job=run.jobs?.find(j=>j.status==='in_progress');
    return {label:run.status==='in_progress'?'Running':'Requested / queued',kind:'running',detail:job ? job.name+(job.step?' · '+job.step:'') : '',run};
  }
  if (run.conclusion==='success') return {label:'Refreshing register',kind:'running',run};
  const failed=run.jobs?.find(j=>['failure','timed_out','cancelled','action_required'].includes(j.conclusion));
  return {label:run.conclusion==='cancelled'?'Cancelled':'Failed',kind:'failed',
    detail:failed ? failed.name+' · '+(failed.step || failed.conclusion) : (run.conclusion || 'Open the run for details'),run};
}
