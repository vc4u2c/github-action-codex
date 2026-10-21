// Offline unit tests are separate. This integration exercise uses the npm registry.
import { mkdir, mkdtemp, cp, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { git, npmCommand, run } from '../lib/process.mjs';
import { loadTargets } from '../lib/config.mjs';
import { auditLocal } from '../lib/audit.mjs';
import { reconcile } from '../lib/register.mjs';
import assert from 'node:assert/strict';
const target = (await loadTargets())[0];
await mkdir('.work', { recursive: true });
const folder = await mkdtemp(join(resolve('.work'), 'integration-'));
const baseline = join(folder, 'baseline'), checkout = join(folder, 'verification');
await mkdir(baseline);
const source = resolve('../vulnerable-node-demo');
for (const file of ['package.json', 'package-lock.json', 'src', 'test', '.gitignore']) {
  await cp(join(source, file), join(baseline, file), { recursive: true });
}
await git(['init', '-b', 'main'], { cwd: baseline });
await git(['add', '.'], { cwd: baseline });
await git(['-c', 'user.name=Integration Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Vulnerable baseline'], { cwd: baseline });
const sha = await git(['rev-parse', 'HEAD'], { cwd: baseline });
const before = await auditLocal(baseline, target);
const finding = before.findings.find(f => f.package === 'minimist');
assert.ok(finding, 'Expected a minimist finding');
const context = { target, finding, before: before.findings, sha, base: 'main', issueNumber: 1,
  hub: 'vc4u2c/github-action-codex', branch: 'codex/fix-' + finding.key + '-123' };
const contextFile = join(folder, 'context.json'), patchFile = join(folder, 'proposal.patch'), receiptFile = join(folder, 'verification.json');
await writeFile(contextFile, JSON.stringify(context, null, 2));
const [command, args] = npmCommand(['install', '--save-exact', 'minimist@1.2.8', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
const install = await run(command, args, { cwd: baseline });
if (install.code !== 0) throw new Error(install.stderr);
await writeFile(patchFile, (await git(['diff', '--binary', 'HEAD'], { cwd: baseline })) + '\n');
await git(['clone', '--no-hardlinks', baseline, checkout]);
const result = await run(process.execPath, ['scripts/verify-remediation.mjs', contextFile, checkout, patchFile, receiptFile], { cwd: process.cwd() });
console.log(result.stdout);
if (result.code !== 0) throw new Error(result.stderr);
const after = await auditLocal(checkout, target);
const makeScan = findings => ({ target, success: true, findings, scannedAt: new Date().toISOString(), sha });
const initial = reconcile([], [makeScan(before.findings)]);
const resolved = reconcile(initial, [makeScan(after.findings)]);
assert.equal(resolved.find(f => f.key === finding.key).status, 'resolved');
const reopened = reconcile(resolved, [makeScan(before.findings)]);
assert.equal(reopened.find(f => f.key === finding.key).status, 'open');
assert.equal(JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).dependencies.minimist, '1.2.5');
const evidence = { ...JSON.parse(await readFile(receiptFile, 'utf8')), before: before.findings.length,
  after: after.findings.length, confirmedTransitions: ['open', 'resolved', 'open'],
  originalDemoUnchanged: true, workspace: folder };
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/integration-verification.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
