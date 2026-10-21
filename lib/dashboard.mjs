import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function buildDashboard(snapshot, destination = 'site') {
  await mkdir(destination, { recursive: true });
  for (const file of ['index.html', 'app.js', 'style.css']) {
    await copyFile(fileURLToPath(new URL('../dashboard/' + file, import.meta.url)), destination + '/' + file);
  }
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
    '\n\nDownload the dashboard artifact, or open the configured GitHub Pages site.\n';
}
