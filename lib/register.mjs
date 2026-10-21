const marker = /<!-- vulnerability-hub:v1 ([A-Za-z0-9+/=]+) -->/;
export const registerLabel = 'vulnerability-register';
export function decodeRecord(issue) {
  const match = issue.body?.match(marker);
  if (!match) return null;
  const record = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  if (!/^[a-f0-9]{24}$/.test(record.key) || !record.repository || !record.targetId) throw new Error('Malformed register issue #' + issue.number);
  return { ...record, issueNumber: issue.number, issueUrl: issue.html_url };
}
const cell = value => String(value ?? '').replace(/[\r\n|]/g, ' ');
export function issueBody(record) {
  const stored = { ...record };
  delete stored.issueNumber; delete stored.issueUrl;
  const rows = {
    Repository: record.repository, Manifest: record.manifest, Package: record.package,
    'Installed versions': record.installedVersions?.join(', '), Advisory: record.advisoryId,
    Severity: record.severity, Status: record.status, 'First detected': record.firstSeen,
    'Last detected': record.lastSeen, 'Last verified': record.lastVerified,
    Resolved: record.resolvedAt || '—', 'Scan commit': record.scanSha,
  };
  return '<!-- vulnerability-hub:v1 ' + Buffer.from(JSON.stringify(stored)).toString('base64') + ' -->\n' +
    '## ' + cell(record.title) + '\n\n| Field | Value |\n| --- | --- |\n' +
    Object.entries(rows).map(([k,v]) => '| ' + k + ' | ' + cell(v) + ' |').join('\n') +
    '\n\nAdvisory: ' + cell(record.url) + '\n\nRemediation PR: ' + cell(record.remediation?.url || 'Not created') +
    '\n\nRun **Remediate vulnerability** in this hub’s Actions tab and enter this issue number.\n' +
    'The hub closes this issue only after a complete scan confirms the advisory is absent.\n' +
    'Keep notes in comments; the scanner owns this issue body.\n';
}
export function reconcile(previous, scans) {
  const records = new Map(previous.map(r => [r.key, structuredClone(r)]));
  for (const scan of scans) {
    if (!scan.success) continue;
    const seen = new Set();
    for (const finding of scan.findings) {
      seen.add(finding.key);
      const old = records.get(finding.key);
      records.set(finding.key, { ...old, ...finding,
        firstSeen: old?.firstSeen || scan.scannedAt, lastSeen: scan.scannedAt,
        lastVerified: scan.scannedAt, scanSha: scan.sha, resolvedAt: null,
        status: old?.remediation?.state === 'open' ? 'pr-open' : 'open' });
    }
    for (const [key, record] of records) {
      const manifest = scan.target.directory === '.' ? 'package-lock.json' : scan.target.directory + '/package-lock.json';
      if (record.repository.toLowerCase() !== scan.target.repository.toLowerCase() || record.manifest !== manifest) continue;
      if (!seen.has(key)) records.set(key, { ...record, status: 'resolved',
        resolvedAt: record.resolvedAt || scan.scannedAt, lastVerified: scan.scannedAt, scanSha: scan.sha });
    }
  }
  return [...records.values()];
}
export async function readRegister(api, hub) {
  const issues = await api.list('/repos/' + hub + '/issues?state=all&labels=' + registerLabel);
  const records = issues.filter(i => !i.pull_request).map(decodeRecord).filter(Boolean);
  if (new Set(records.map(r => r.key)).size !== records.length) throw new Error('Duplicate register keys: reconcile duplicate issues manually');
  return records;
}
export async function refreshPullRequests(api, records) {
  return Promise.all(records.map(async record => {
    if (!record.remediation?.number) return record;
    const pr = await api.get('/repos/' + record.repository + '/pulls/' + record.remediation.number);
    const state = pr.merged_at ? 'merged' : pr.state;
    return { ...record, remediation: { ...record.remediation, state, mergedAt: pr.merged_at },
      status: record.status === 'resolved' ? 'resolved' : state === 'open' ? 'pr-open' : state === 'merged' ? 'awaiting-verification' : 'open' };
  }));
}
export async function saveRegister(api, hub, records) {
  const labels = await api.list('/repos/' + hub + '/labels');
  if (!labels.some(l => l.name === registerLabel)) await api.post('/repos/' + hub + '/labels', { name: registerLabel, color: 'd93f0b', description: 'Managed vulnerability register' });
  const saved = [];
  for (const record of records) {
    const body = { title: '[' + record.severity + '] ' + record.package + ': ' + record.advisoryId + ' (' + record.targetId + ')',
      body: issueBody(record), state: record.status === 'resolved' ? 'closed' : 'open',
      state_reason: record.status === 'resolved' ? 'completed' : 'reopened' };
    const issue = record.issueNumber
      ? await api.patch('/repos/' + hub + '/issues/' + record.issueNumber, body)
      : await api.post('/repos/' + hub + '/issues', { title: body.title, body: body.body, labels: [registerLabel] });
    saved.push({ ...record, issueNumber: issue.number, issueUrl: issue.html_url });
  }
  return saved;
}
