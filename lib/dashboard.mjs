import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function buildDashboard(snapshot, destination = 'site') {
  await mkdir(destination, { recursive: true });
  for (const file of ['index.html', 'app.js', 'activity.js', 'style.css']) {
    await copyFile(fileURLToPath(new URL('../dashboard/' + file, import.meta.url)), destination + '/' + file);
  }
  await writeFile(destination + '/activity.json', JSON.stringify(snapshot.activity || {runs:[]},null,2));
  await writeFile(destination + '/register.json', JSON.stringify(snapshot, null, 2));
}
export function markdownSummary(snapshot) {
  const open = snapshot.findings.filter(f => f.status !== 'resolved');
  const safe = s => String(s).replace(/[|\r\n]/g, ' ');
  return '# Vulnerability hub\n\n' + open.length + ' active findings · ' +
    (snapshot.findings.length - open.length) + ' resolved\n\n' +
    '| Target | Scan | Commit |\n| --- | --- | --- |\n' +
    snapshot.scans.map(s => '| ' + safe(s.target.repository) + ' | ' + (s.success ? 'Complete' : 'FAILED — ' + safe(s.error)) + ' | ' + safe(s.sha || '—') + ' |').join('\n') +
    '\n\n| Severity | Package / advisory | Status | Register |\n| --- | --- | --- | --- |\n' +
    snapshot.findings.map(f => '| ' + f.severity + ' | ' + safe(f.package + ' / ' + f.advisoryId) + ' | ' + f.status + ' | ' +
      (f.issueUrl ? '[#' + f.issueNumber + '](' + f.issueUrl + ')' : 'Local preview') + ' |').join('\n') +
    '\n\n## Remediation runs and usage\n\n| Run / attempt | Result | Input tokens | Cached input | Output tokens |\n| --- | --- | --- | --- | --- |\n' +
    (snapshot.activity?.runs || []).map(r => '| ['+r.id+']('+r.url+') / '+r.attempt+' | '+safe(r.conclusion || r.status)+' | '+(r.usage?.inputTokens ?? 'unavailable')+' | '+(r.usage?.cachedInputTokens ?? 'unavailable')+' | '+(r.usage?.outputTokens ?? 'unavailable')+' |').join('\n') +
    '\n\nUsage comes from completed CLI turn events for the latest attempt; unavailable does not mean free. This is not an invoice.\n\nDownload the dashboard artifact, or open the configured GitHub Pages site.\n';
}
