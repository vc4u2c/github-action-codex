import test from 'node:test';
import assert from 'node:assert/strict';
import { findingKey, normalizeAudit } from '../lib/audit.mjs';
import { reconcile, decodeRecord, issueBody, readRegister, saveRegister } from '../lib/register.mjs';
import { validateTargets } from '../lib/config.mjs';
import { allowedPath, assertRemediated } from '../lib/remediation.mjs';
import { GitHub } from '../lib/github.mjs';
const target = { id: 'demo', repository: 'owner/app', directory: '.', ecosystem: 'npm' };
const advisory = { source: 123, name: 'minimist', title: 'Prototype pollution', severity: 'critical', url: 'https://github.com/advisories/GHSA-xvch-5gv4-984h', range: '<1.2.6' };
const report = { auditReportVersion: 2, vulnerabilities: { minimist: { name: 'minimist', isDirect: true, via: [advisory], nodes: ['node_modules/minimist'], fixAvailable: true } }, metadata: { vulnerabilities: { total: 1 } } };
const finding = normalizeAudit(report, target, { packages: { 'node_modules/minimist': { version: '1.2.5' } } })[0];
const scan = (findings, when = '2026-01-01T00:00:00Z', t = target) => ({ target: t, success: true, findings, scannedAt: when, sha: 'a'.repeat(40) });

test('identities are stable across versions, severity, and owner casing; distinct across manifests/repositories', () => {
  assert.equal(finding.key, findingKey({ ...target, repository: 'OWNER/APP' }, finding.package, finding.advisoryId));
  assert.notEqual(finding.key, findingKey({ ...target, directory: 'service' }, finding.package, finding.advisoryId));
  assert.notEqual(finding.key, findingKey({ ...target, repository: 'owner/other' }, finding.package, finding.advisoryId));
  const changed = structuredClone(report); changed.vulnerabilities.minimist.via[0].severity = 'high';
  assert.equal(normalizeAudit(changed, target)[0].key, finding.key);
  assert.deepEqual(finding.installedVersions, ['1.2.5']);
});
test('npm dependent summaries do not duplicate the underlying advisory', () => {
  const r = structuredClone(report);
  r.vulnerabilities.parent = { name: 'parent', via: ['minimist'], nodes: ['node_modules/parent'] };
  r.metadata.vulnerabilities.total = 2;
  assert.equal(normalizeAudit(r, target).length, 1);
});
test('missing, error, partial, and malformed reports fail instead of appearing clean', () => {
  for (const bad of [{}, { ...report, error: { code: 'ENETUNREACH' } }, { ...report, auditReportVersion: 1 },
    { ...report, vulnerabilities: {} }, { ...report, metadata: {} }]) assert.throws(() => normalizeAudit(bad, target));
  const r = structuredClone(report); r.vulnerabilities.minimist.via = ['missing'];
  assert.throws(() => normalizeAudit(r, target), /Incomplete/);
});
test('repeat scans update one finding and preserve its first-seen date', () => {
  const first = reconcile([], [scan([finding])]);
  const second = reconcile(first, [scan([{ ...finding, severity: 'high' }], '2026-01-02T00:00:00Z')]);
  assert.equal(second.length, 1); assert.equal(second[0].firstSeen, first[0].firstSeen);
  assert.equal(second[0].lastSeen, '2026-01-02T00:00:00Z'); assert.equal(second[0].severity, 'high');
});
test('failed scans never resolve existing findings', () => {
  const prior = reconcile([], [scan([finding])]);
  assert.deepEqual(reconcile(prior, [{ target, success: false, findings: [] }]), prior);
});
test('a successful scan only resolves findings in the scanned repository and manifest', () => {
  const other = { ...finding, key: 'b'.repeat(24), repository: 'owner/other' };
  const subdirectory = { ...finding, key: 'c'.repeat(24), manifest: 'service/package-lock.json' };
  const records = reconcile([], [scan([finding, other, subdirectory])]);
  const result = reconcile(records, [scan([], '2026-01-03T00:00:00Z')]);
  assert.equal(result[0].status, 'resolved');
  assert.equal(result[1].status, 'open'); assert.equal(result[2].status, 'open');
});
test('PR merge is insufficient: an advisory still present stays open; reappearance reopens the same record', () => {
  const [record] = reconcile([], [scan([finding])]);
  record.issueNumber = 12; record.remediation = { number: 5, state: 'merged', url: 'https://github.com/owner/app/pull/5' };
  const [stillOpen] = reconcile([record], [scan([finding])]);
  assert.equal(stillOpen.status, 'open');
  const [resolved] = reconcile([record], [scan([], '2026-01-03T00:00:00Z')]);
  assert.equal(resolved.status, 'resolved'); assert.ok(resolved.resolvedAt);
  const [reopened] = reconcile([resolved], [scan([finding], '2026-01-04T00:00:00Z')]);
  assert.equal(reopened.issueNumber, 12); assert.equal(reopened.status, 'open'); assert.equal(reopened.resolvedAt, null);
});
test('issue metadata round-trips without losing scan evidence', () => {
  const [record] = reconcile([], [scan([finding])]);
  const decoded = decodeRecord({ number: 7, html_url: 'https://github.com/owner/hub/issues/7', body: issueBody(record) });
  assert.equal(decoded.key, finding.key); assert.equal(decoded.issueNumber, 7); assert.equal(decoded.firstSeen, record.firstSeen);
  assert.equal(decodeRecord({ body: 'Ordinary user issue' }), null);
});
test('GitHub register create / deduplicate / close / reopen lifecycle uses the same issue', async () => {
  const issues = [];
  const api = {
    list: async path => path.includes('/labels') ? [{ name: 'vulnerability-register' }] : issues,
    post: async (path, body) => {
      assert.ok(path.endsWith('/issues'));
      const issue = { ...body, number: issues.length + 1, html_url: 'https://github.com/owner/hub/issues/1', state: 'open' };
      issues.push(issue); return issue;
    },
    patch: async (path, body) => {
      const issue = issues.find(i => path.endsWith('/' + i.number));
      Object.assign(issue, body); return issue;
    },
  };
  let records = await saveRegister(api, 'owner/hub', reconcile([], [scan([finding])]));
  records = await readRegister(api, 'owner/hub');
  await saveRegister(api, 'owner/hub', reconcile(records, [scan([finding])]));
  assert.equal(issues.length, 1);
  await saveRegister(api, 'owner/hub', reconcile(records, [scan([])]));
  assert.equal(issues[0].state, 'closed'); assert.equal(issues[0].state_reason, 'completed');
  records = await readRegister(api, 'owner/hub');
  await saveRegister(api, 'owner/hub', reconcile(records, [scan([finding])]));
  assert.equal(issues[0].state, 'open'); assert.equal(issues.length, 1);
});
test('duplicate register entries stop reconciliation', async () => {
  const [record] = reconcile([], [scan([finding])]);
  await assert.rejects(readRegister({ list: async () => [1,2].map(number => ({ number, body: issueBody(record) })) }, 'owner/hub'), /Duplicate/);
});
test('GitHub pagination reads closed findings beyond the first 100', async () => {
  const api = new GitHub('fake', async url => ({ ok: true, status: 200, json: async () => url.endsWith('page=1') ? Array.from({ length: 100 }, (_,i) => ({ number: i + 1 })) : [{ number: 101 }] }));
  assert.equal((await api.list('/repos/owner/hub/issues?state=all')).length, 101);
});
test('target config rejects traversal, duplicate scopes and unsupported ecosystems', () => {
  assert.deepEqual(validateTargets({ targets: [target] }), [target]);
  for (const t of [{ ...target, directory: '../escape' }, { ...target, repository: 'owner/app?x=1' }, { ...target, ecosystem: 'pip' }]) assert.throws(() => validateTargets({ targets: [t] }));
  assert.throws(() => validateTargets({ targets: [target, { ...target, id: 'other' }] }));
});
test('patch allowlist excludes instructions, workflows, nested traversal, and executable scripts', () => {
  for (const path of ['package.json', 'package-lock.json', 'src/server.mjs', 'test/app.test.mjs']) assert.ok(allowedPath(path));
  for (const path of ['.github/workflows/ci.yml', 'AGENTS.md', '.agents/skills/a/SKILL.md', 'src/../evil.mjs', 'src/install.sh']) assert.equal(allowedPath(path), false);
  assert.ok(allowedPath('app/package.json', 'app'));
  assert.equal(allowedPath('package.json', 'app'), false);
});
test('validation rejects an unfixed advisory or newly introduced advisory', () => {
  const context = { finding, before: [finding] };
  assertRemediated(context, []);
  assert.throws(() => assertRemediated(context, [finding]), /still present/);
  assert.throws(() => assertRemediated(context, [{ ...finding, key: 'new' }]), /new advisory/);
});
