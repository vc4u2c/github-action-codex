import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../lib/process.mjs';
import { applyProposal } from '../lib/remediation.mjs';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hub-patch-test-'));
  const source = join(root, 'source'), checkout = join(root, 'checkout');
  await mkdir(join(source, 'test'), { recursive: true });
  await writeFile(join(source, 'test/app.test.mjs'), 'import "node:test";\n');
  const pkg = { name: 'fixture', scripts: { test: 'node --test' }, dependencies: { minimist: '1.2.5' } };
  await writeFile(join(source, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  await git(['init', '-b', 'main'], { cwd: source });
  await git(['add', '.'], { cwd: source });
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline'], { cwd: source });
  const sha = await git(['rev-parse', 'HEAD'], { cwd: source });
  await git(['clone', '--no-hardlinks', source, checkout]);
  return { root, source, checkout, pkg, context: { sha, target: { directory: '.' } } };
}
async function patch(f) {
  const path = join(f.root, 'change.patch');
  await git(['add', '-N', '.'], { cwd: f.source });
  await writeFile(path, (await git(['diff', '--binary', 'HEAD'], { cwd: f.source })) + '\n');
  return path;
}
test('a real dependency-only git patch passes the independent file gate', async () => {
  const f = await fixture(); f.pkg.dependencies.minimist = '1.2.8';
  await writeFile(join(f.source, 'package.json'), JSON.stringify(f.pkg, null, 2) + '\n');
  const result = await applyProposal(f.context, f.checkout, await patch(f));
  assert.deepEqual(result.files, ['package.json']); assert.match(result.patchSha256, /^[a-f0-9]{64}$/);
});
test('a real patch that disables the test script is rejected', async () => {
  const f = await fixture(); f.pkg.scripts.test = 'echo skip';
  await writeFile(join(f.source, 'package.json'), JSON.stringify(f.pkg, null, 2) + '\n');
  await assert.rejects(applyProposal(f.context, f.checkout, await patch(f)), /dependency-related/);
});
test('a real patch that modifies a workflow is rejected', async () => {
  const f = await fixture();
  await mkdir(join(f.source, '.github/workflows'), { recursive: true });
  await writeFile(join(f.source, '.github/workflows/backdoor.yml'), 'name: unwanted\n');
  await assert.rejects(applyProposal(f.context, f.checkout, await patch(f)), /allowlist/);
});
