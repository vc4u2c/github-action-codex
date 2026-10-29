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
  const response = await fetch('register.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load the register');
  const data = await response.json();
  $('#mode').textContent = data.mode === 'local' ? 'Local scan · preview' : 'GitHub register';
  $('#updated').textContent = 'Snapshot ' + new Date(data.generatedAt).toLocaleString();
  $('#request-help').hidden = data.mode !== 'github';
  const active = data.findings.filter(f => f.status !== 'resolved');
  const metrics = [['Active findings', active.length, ''], ['Critical / high', active.filter(f => ['critical','high'].includes(f.severity)).length, 'danger'],
    ['PRs in review', active.filter(f => f.status === 'pr-open').length, ''], ['Verified resolved', data.findings.length - active.length, 'good']];
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
    for (const f of records) {
      const row = node('tr'), finding = node('td'); finding.append(node('strong', f.package), node('small', f.title), link(f.advisoryId, f.url));
      const sev = node('td'); sev.append(badge(f.severity, f.severity));
      const repo = node('td'); repo.append(node('span', f.repository), node('small', f.manifest));
      const state = node('td'); state.append(badge(f.status, f.status));
      const dates = node('td'); dates.append(node('span', date(f.firstSeen)), node('small', f.resolvedAt ? 'Resolved ' + date(f.resolvedAt) : 'Still active'));
      const links = node('td', undefined, 'links');
      if (f.issueUrl) links.append(link('Register #' + f.issueNumber, f.issueUrl));
      if (f.status === 'open' && f.issueUrl) {
        const request = link('Request fix', f.issueUrl + '#request-fix');
        request.classList.add('request-fix'); links.append(request);
      }
      if (f.remediation?.url) links.append(link((f.status === 'pr-open' ? 'Review PR #' : 'PR #') + f.remediation.number, f.remediation.url));
      if (!links.childNodes.length) links.append(node('span', 'Local preview', 'muted'));
      row.append(finding, sev, repo, state, dates, links); $('#findings').append(row);
    }
    $('#count').textContent = records.length + ' findings'; $('#empty').hidden = records.length > 0;
  }
  for (const id of ['search','status','severity']) $('#' + id).addEventListener('input', render);
  render();
}
boot().catch(error => { $('#error').hidden = false; $('#error').textContent = error.message + '. Generate a scan and serve this folder over HTTP.'; $('#mode').textContent = 'Unavailable'; });
