import { normalizeRun, jobDetails } from '../dashboard/activity.js';
export function parseUsage(log) {
  const total={inputTokens:0,cachedInputTokens:0,outputTokens:0,reasoningOutputTokens:0,completedTurns:0};
  for (const line of log.split('\n')) {
    const index=line.indexOf('{"type":');
    if (index<0) continue;
    let event; try {event=JSON.parse(line.slice(index));} catch {continue;}
    if (event.type!=='turn.completed' || !event.usage) continue;
    const u=event.usage;
    if (![u.input_tokens,u.output_tokens].every(n=>Number.isSafeInteger(n)&&n>=0)) continue;
    total.inputTokens+=u.input_tokens; total.outputTokens+=u.output_tokens; total.completedTurns++;
    for (const [from,to] of [['cached_input_tokens','cachedInputTokens'],['reasoning_output_tokens','reasoningOutputTokens']]) {
      if (Number.isSafeInteger(u[from]) && u[from]>=0) total[to]+=u[from];
    }
  }
  return total.completedTurns ? total : null;
}
export async function collectActivity(api, hub) {
  const payload=await api.get('/repos/'+hub+'/actions/workflows/remediate.yml/runs?per_page=20');
  const runs=[];
  for (const raw of payload.workflow_runs || []) {
    const run=normalizeRun(raw); if (!run) continue;
    try {
      const {jobs}=await api.get('/repos/'+hub+'/actions/runs/'+run.id+'/attempts/'+run.attempt+'/jobs?per_page=100');
      run.jobs=jobDetails(jobs);
      run.modelSkipped=jobs.some(j=>j.name==='propose' && j.conclusion==='skipped');
      const completed=jobs.filter(j=>j.completed_at).map(j=>Date.parse(j.completed_at));
      run.durationSeconds=run.status==='completed' && completed.length ? Math.max(0,Math.round((Math.max(...completed)-Date.parse(run.createdAt))/1000)) : null;
      const propose=jobs.find(j=>j.name==='propose' && j.status==='completed' && j.conclusion!=='skipped');
      if (propose) {
        const log=await api.text('/repos/'+hub+'/actions/jobs/'+propose.id+'/logs');
        run.usage=parseUsage(log);
        run.model=/\bmodel: (gpt-[a-zA-Z0-9_.-]+)/.exec(log)?.[1] || null;
      }
    } catch {run.detailsUnavailable=true;}
    runs.push(run);
  }
  return {collectedAt:new Date().toISOString(),runs};
}
