import test from 'node:test';
import assert from 'node:assert/strict';
import { demoTarget, planReset, resetRemote } from '../lib/demo-reset.mjs';
const target = { id: 'node-demo', repository: 'owner/vulnerable-node-demo', directory: '.', ecosystem: 'npm', demo: { baselineCommit: 'a'.repeat(40) } };
const blob = (path, sha) => ({ path, sha, mode: '100644', type: 'blob' });
const baseline = { tree: [blob('package.json', 'old-pkg'), blob('package-lock.json', 'old-lock'),
  blob('src/server.mjs', 'old-source'), blob('test/app.test.mjs', 'old-test'),
  blob('.github/workflows/ci.yml', 'old-ci'), blob('README.md', 'old-readme')] };
const fixed = { tree: [blob('package.json', 'new-pkg'), blob('package-lock.json', 'new-lock'),
  blob('src/server.mjs', 'new-source'), blob('test/app.test.mjs', 'new-test'),
  blob('test/added.test.mjs', 'new-test-file'), blob('.github/workflows/ci.yml', 'new-ci'), blob('README.md', 'new-readme')] };
function mockApi({ current = fixed, prs = [] } = {}) {
  const writes = [], root = '/repos/' + target.repository;
  return {
    writes,
    get: async path => {
      if (path === root) return { default_branch: 'main' };
      if (path === root + '/commits/main') return { sha: 'b'.repeat(40) };
      if (path.endsWith('/git/commits/' + target.demo.baselineCommit)) return { tree: { sha: 'baseline-tree' } };
      if (path.endsWith('/git/commits/' + 'b'.repeat(40))) return { tree: { sha: 'current-tree' } };
      if (path.endsWith('/git/trees/baseline-tree?recursive=1')) return baseline;
      if (path.endsWith('/git/trees/current-tree?recursive=1')) return current;
      throw new Error('Unexpected GET ' + path);
    },
    list: async () => prs,
    post: async (path, body) => {
      writes.push({ path, body });
      if (path.endsWith('/git/trees')) return { sha: 'reset-tree' };
      if (path.endsWith('/git/commits')) return { sha: 'reset-commit' };
      if (path.endsWith('/git/refs')) return {};
      if (path.endsWith('/pulls')) return { number: 9, html_url: 'https://github.com/owner/app/pull/9', ...body };
      throw new Error('Unexpected POST ' + path);
    },
  };
}
test('reset is opt-in and rejects ordinary targets', async () => {
  assert.equal(await demoTarget(target.id, [target]), target);
  await assert.rejects(demoTarget('node-demo', [{ ...target, demo: undefined }]), /explicitly configured/);
  await assert.rejects(demoTarget('node-demo', [{ ...target, directory: 'production' }]), /root-level/);
});
test('reset restores owned app files and removes added tests while preserving CI and docs', () => {
  const changes = planReset(baseline, fixed);
  assert.deepEqual(changes.map(e => e.path), ['package.json', 'package-lock.json', 'src/server.mjs', 'test/app.test.mjs', 'test/added.test.mjs']);
  assert.equal(changes.find(e => e.path === 'test/added.test.mjs').sha, null);
  assert.deepEqual(planReset(baseline, baseline), []);
});
test('incomplete baseline trees and symlinks cannot be reset into the app', () => {
  assert.throws(() => planReset({ ...baseline, truncated: true }, fixed), /Incomplete/);
  assert.throws(() => planReset(baseline, { ...fixed, truncated: true }), /Incomplete/);
  assert.throws(() => planReset({ tree: [] }, fixed), /must contain/);
  const unsafe = structuredClone(baseline); unsafe.tree[2].mode = '120000';
  assert.throws(() => planReset(unsafe, fixed), /ordinary/);
});
test('reset opens a reviewable PR without writing the default branch or changing register issues', async () => {
  const api = mockApi();
  const result = await resetRemote(api, target, '123');
  assert.equal(result.status, 'created');
  const ref = api.writes.find(w => w.path.endsWith('/git/refs'));
  assert.equal(ref.body.ref, 'refs/heads/codex/demo-reset-node-demo-123');
  const commit = api.writes.find(w => w.path.endsWith('/git/commits'));
  assert.deepEqual(commit.body.parents, ['b'.repeat(40)]);
  const pr = api.writes.find(w => w.path.endsWith('/pulls'));
  assert.equal(pr.body.base, 'main');
  assert.match(pr.body.body, /deliberately reintroduces/);
  assert.equal(api.writes.some(w => /issues|dispatches/.test(w.path)), false);
});
test('an already reset target is a no-op', async () => {
  const api = mockApi({ current: baseline });
  assert.equal((await resetRemote(api, target, '124')).status, 'already-baseline');
  assert.equal(api.writes.length, 0);
});
test('repeat reset requests reuse an existing open reset PR', async () => {
  const pr = { number: 9, head: { ref: 'codex/demo-reset-node-demo-123', repo: { full_name: target.repository } }, base: { ref: 'main' } };
  const api = mockApi({ prs: [pr] });
  const result = await resetRemote(api, target, '124');
  assert.equal(result.status, 'existing'); assert.equal(result.pr.number, 9);
  assert.equal(api.writes.length, 0);
});
test('open remediation PRs block resetting until reviewed or closed', async () => {
  const api = mockApi({ prs: [{ head: { ref: 'codex/fix-abc-123', repo: { full_name: target.repository } }, base: { ref: 'main' } }] });
  await assert.rejects(resetRemote(api, target, '125'), /Merge or close/);
  assert.equal(api.writes.length, 0);
});
