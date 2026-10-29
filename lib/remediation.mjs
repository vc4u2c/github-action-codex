import { samePackage, groupKey } from './remediation-group.mjs';
import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { git } from './process.mjs';
import { findingKey } from './audit.mjs';
export function assertContext(context, targets) {
  const t = targets.find(t => t.id === context.target.id);
  if (!t || t.repository !== context.target.repository || t.directory !== context.target.directory ||
      context.finding.key !== findingKey(t, context.finding.package, context.finding.advisoryId) ||
      !/^[a-f0-9]{40}$/.test(context.sha) || !/^codex\/fix-[a-f0-9]{24}-[0-9]+$/.test(context.branch) ||
      !Number.isInteger(context.issueNumber) || context.issueNumber < 1) throw new Error('Invalid remediation context');
  if (context.findings && (!context.findings.length || context.groupKey !== groupKey(context.finding) ||
      !context.findings.some(f => f.key === context.finding.key) || new Set(context.findings.map(f => f.key)).size !== context.findings.length ||
      context.findings.some(f => !samePackage(f, context.finding) || f.key !== findingKey(t, f.package, f.advisoryId) || !context.before.some(b => b.key === f.key)))) throw new Error('Invalid package group');
  return t;
}
export function allowedPath(path, directory = '.') {
  const local = directory === '.' ? path : path.startsWith(directory + '/') ? path.slice(directory.length + 1) : '';
  return ['package.json', 'package-lock.json'].includes(local) ||
    /^(src|test)\/[a-zA-Z0-9_./-]+\.mjs$/.test(local) && !local.split('/').includes('..');
}
export const patchHash = content => createHash('sha256').update(content).digest('hex');
export async function applyProposal(context, checkout, patchFile) {
  const patch = await readFile(patchFile);
  if (!patch.length || patch.length > 2_000_000) throw new Error('Patch is empty or exceeds 2 MB');
  if (await git(['rev-parse', 'HEAD'], { cwd: checkout }) !== context.sha) throw new Error('Checkout is not the audited commit');
  // git apply protects .git and paths outside the work tree. Inspect staged modes/paths before executing code.
  await git(['apply', '--check', '--index', resolve(patchFile)], { cwd: checkout });
  await git(['apply', '--index', resolve(patchFile)], { cwd: checkout });
  const raw = await git(['diff', '--cached', '--raw', '--no-abbrev'], { cwd: checkout });
  const names = await git(['diff', '--cached', '--name-only'], { cwd: checkout });
  const files = names.split('\n').filter(Boolean);
  if (!files.length || files.some(p => !allowedPath(p, context.target.directory))) throw new Error('Patch changes a file outside the remediation allowlist');
  for (const line of raw.split('\n')) {
    const [oldMode, newMode] = line.split(' ');
    if (![ ':100644', ':000000' ].includes(oldMode) || !['100644', '000000'].includes(newMode)) throw new Error('Symlinks, executable files, and submodules are not allowed');
  }
  const prefix = context.target.directory === '.' ? '' : context.target.directory + '/';
  const original = JSON.parse(await git(['show', context.sha + ':' + prefix + 'package.json'], { cwd: checkout }));
  const proposed = JSON.parse(await readFile(join(checkout, prefix, 'package.json'), 'utf8'));
  for (const obj of [original, proposed]) for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'overrides']) delete obj[key];
  if (JSON.stringify(original) !== JSON.stringify(proposed)) throw new Error('Only dependency-related package.json fields may change');
  const beforeTests = (await git(['ls-tree', '-r', '--name-only', context.sha, '--', prefix + 'test'], { cwd: checkout })).split('\n').filter(Boolean);
  if (!beforeTests.length) throw new Error('Target must provide tests under test/');
  for (const test of beforeTests) if (!(await lstat(join(checkout, test))).isFile()) throw new Error('Existing test files must remain');
  return { files, patchSha256: patchHash(patch) };
}
export function assertRemediated(context, afterFindings) {
  const selected = new Set((context.findings || [context.finding]).map(f => f.key));
  if (afterFindings.some(f => selected.has(f.key))) throw new Error('Selected vulnerability is still present in the package group');
  const before = new Set(context.before.map(f => f.key));
  if (afterFindings.some(f => !before.has(f.key))) throw new Error('Remediation introduced a new advisory');
}
