import { loadTargets } from './config.mjs';

export async function demoTarget(id = 'node-demo', targets) {
  const target = (targets || await loadTargets()).find(t => t.id === id);
  if (!target?.demo?.baselineCommit || !/^[a-f0-9]{40}$/.test(target.demo.baselineCommit) || target.directory !== '.') {
    throw new Error('Reset requires an explicitly configured root-level demo target and pinned baseline commit');
  }
  return target;
}
export const isDemoPath = path => ['package.json', 'package-lock.json'].includes(path) || path.startsWith('src/') || path.startsWith('test/');

export function planReset(baseline, current) {
  if (baseline.truncated || current.truncated || !Array.isArray(baseline.tree) || !Array.isArray(current.tree)) {
    throw new Error('Incomplete Git tree; refusing reset');
  }
  const wanted = baseline.tree.filter(e => isDemoPath(e.path) && e.type !== 'tree');
  if (!wanted.some(e => e.path === 'package.json') || !wanted.some(e => e.path === 'package-lock.json') ||
      !wanted.some(e => e.path.startsWith('src/')) || !wanted.some(e => e.path.startsWith('test/'))) {
    throw new Error('Baseline must contain both manifests, application source, and tests');
  }
  if (wanted.some(e => e.type !== 'blob' || e.mode !== '100644')) throw new Error('Baseline must contain ordinary non-executable files');
  const previous = new Map(current.tree.filter(e => e.type !== 'tree').map(e => [e.path, e]));
  const expected = new Map(wanted.map(e => [e.path, e]));
  const changes = wanted.filter(e => previous.get(e.path)?.sha !== e.sha || previous.get(e.path)?.mode !== e.mode)
    .map(({ path, mode, type, sha }) => ({ path, mode, type, sha }));
  for (const e of previous.values()) {
    if (isDemoPath(e.path) && !expected.has(e.path)) changes.push({ path: e.path, mode: e.mode, type: e.type, sha: null });
  }
  return changes;
}

export async function resetRemote(api, target, runId) {
  await demoTarget(target.id, [target]);
  if (!/^\d+$/.test(String(runId))) throw new Error('Invalid reset run id');
  const root = '/repos/' + target.repository;
  const repository = await api.get(root);
  const open = await api.list(root + '/pulls?state=open');
  const prefix = 'codex/demo-reset-' + target.id + '-';
  const ownPulls = open.filter(p => p.head.repo?.full_name === target.repository && p.base.ref === repository.default_branch);
  const existing = ownPulls.find(p => p.head.ref.startsWith(prefix));
  if (existing) return { status: 'existing', pr: existing };
  if (ownPulls.some(p => p.head.ref.startsWith('codex/fix-'))) {
    throw new Error('Merge or close open remediation PRs for this target before resetting the demo');
  }
  const head = await api.get(root + '/commits/' + encodeURIComponent(repository.default_branch));
  const [baselineCommit, currentCommit] = await Promise.all([
    api.get(root + '/git/commits/' + target.demo.baselineCommit),
    api.get(root + '/git/commits/' + head.sha),
  ]);
  const [baseline, current] = await Promise.all([
    api.get(root + '/git/trees/' + baselineCommit.tree.sha + '?recursive=1'),
    api.get(root + '/git/trees/' + currentCommit.tree.sha + '?recursive=1'),
  ]);
  const changes = planReset(baseline, current);
  if (!changes.length) return { status: 'already-baseline' };
  const tree = await api.post(root + '/git/trees', { base_tree: currentCommit.tree.sha, tree: changes });
  const commit = await api.post(root + '/git/commits', {
    message: 'demo: restore intentionally vulnerable baseline', tree: tree.sha, parents: [head.sha],
  });
  const branch = prefix + runId;
  try { await api.post(root + '/git/refs', { ref: 'refs/heads/' + branch, sha: commit.sha }); }
  catch (error) {
    if (!error.message.includes(': 422')) throw error;
    const ref = await api.get(root + '/git/ref/heads/' + branch);
    const prior = await api.get(root + '/git/commits/' + ref.object.sha);
    if (prior.tree.sha !== tree.sha || prior.parents[0]?.sha !== head.sha) throw new Error('Reset branch differs; refusing to overwrite');
  }
  const pr = await api.post(root + '/pulls', {
    title: 'demo: reset vulnerable application for the next demonstration',
    head: branch, base: repository.default_branch,
    body: 'Restores the intentionally vulnerable demo manifests, source, and tests from commit ' +
      target.demo.baselineCommit + '.\n\nThis deliberately reintroduces the demo dependency vulnerabilities. ' +
      'Workflow files, documentation, register issues, and history are preserved.\n\n' +
      'Merge this PR to start the next demonstration. The normal default-branch notification requests a central rescan, ' +
      'which reopens the same finding issues. If notifications are not configured, run the hub scan manually. ' +
      'The reset itself does not mark findings open or resolved; scan evidence controls those transitions.',
  });
  return { status: 'created', pr, changedFiles: changes.map(e => e.path) };
}
