import { collectActivity } from '../lib/run-activity.mjs';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { loadTargets } from '../lib/config.mjs';
import { GitHub } from '../lib/github.mjs';
import { auditRemote } from '../lib/audit.mjs';
import { reconcile, readRegister, refreshPullRequests, saveRegister } from '../lib/register.mjs';
import { buildDashboard, markdownSummary } from '../lib/dashboard.mjs';
const hub = process.env.GITHUB_REPOSITORY;
if (!hub) throw new Error('GITHUB_REPOSITORY must identify the central hub');
const source = new GitHub(process.env.TARGET_TOKEN, fetch, { allowAnonymous: true });
const register = new GitHub(process.env.GITHUB_TOKEN);
const targets = await loadTargets();
const previous = await readRegister(register, hub);
const scans = [];
await mkdir('artifacts', { recursive: true });
for (const target of targets) {
  try {
    const result = await auditRemote(source, target);
    await writeFile('artifacts/audit-' + target.id + '.json', JSON.stringify(result.report, null, 2));
    // A result from an obsolete default-branch commit cannot resolve current findings.
    const current = await source.get('/repos/' + target.repository + '/commits/' + encodeURIComponent(result.branch));
    if (current.sha !== result.sha) throw new Error('Default branch moved during scan; retry required');
    const { report, ...scan } = result;
    scans.push(scan);
  } catch (error) {
    scans.push({ target, success: false, scannedAt: new Date().toISOString(), error: error.message });
  }
}
// Refresh only records in configured repositories. Removed targets retain history.
const configured = new Set(targets.map(t => t.repository.toLowerCase()));
const refreshed = [];
for (const record of previous) {
  try { refreshed.push(...(configured.has(record.repository.toLowerCase()) ? await refreshPullRequests(source, [record]) : [record])); }
  catch { refreshed.push(record); }
}
const findings = await saveRegister(register, hub, reconcile(refreshed, scans));
let activity;
try { activity=await collectActivity(register,hub); } catch { activity={runs:[],unavailable:true}; }
const snapshot = { activity, generatedAt: new Date().toISOString(), mode: 'github', hub, scans, findings };
await writeFile('artifacts/register.json', JSON.stringify(snapshot, null, 2));
await buildDashboard(snapshot);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdownSummary(snapshot));
console.log('Register: ' + findings.length + ' findings; failed scans: ' + scans.filter(s => !s.success).length);
if (scans.some(s => !s.success)) process.exitCode = 1;
