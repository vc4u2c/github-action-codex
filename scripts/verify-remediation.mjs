import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadTargets } from '../lib/config.mjs';
import { applyProposal, assertContext, assertRemediated } from '../lib/remediation.mjs';
import { auditLocal } from '../lib/audit.mjs';
import { runApplicationTests, assertTestsPassed, printTestOutput, verificationImage } from '../lib/verification-sandbox.mjs';
const context = JSON.parse(await readFile(process.argv[2], 'utf8'));
assertContext(context, await loadTargets());
const checkout = resolve(process.argv[3]), patch = process.argv[4], receipt = process.argv[5];
const checked = await applyProposal(context, checkout, patch);
const directory = resolve(checkout, context.target.directory);
// Audit the pristine proposal before executing any application code. Tests receive a
// disposable copy; they cannot rewrite the manifests, harness, or verification receipt.
const audit = await auditLocal(directory, context.target);
assertRemediated(context, audit.findings);
const tests = await runApplicationTests(checkout, context.target.directory);
printTestOutput(tests);
assertTestsPassed(tests);
await writeFile(receipt, JSON.stringify({ schema: 1, checks: {patch: 'passed', installation: 'passed', tests: 'passed', audit: 'passed'}, ...checked, baseSha: context.sha, findingKey: context.finding.key,
  resolvedKeys: context.before.filter(f => !audit.findings.some(a => a.key === f.key)).map(f => f.key),
  verifiedAt: new Date().toISOString(), remainingFindings: audit.findings.length, verificationImage }, null, 2));
console.log('Verified: tests pass, selected finding removed, no new advisory keys');
