// Rehearse the lifecycle in a dedicated workspace; never reset the real app checkout.
import { mkdir, readFile, writeFile, lstat, realpath, readdir, unlink } from 'node:fs/promises';
import { resolve, join, dirname, sep } from 'node:path';
import { git, run, npmCommand } from '../lib/process.mjs';
import { demoTarget, isDemoPath } from '../lib/demo-reset.mjs';
const mode = process.argv[2];
if (!['reset', 'fix'].includes(mode)) throw new Error('Usage: node scripts/local-demo-cycle.mjs reset|fix');
const target = await demoTarget();
const workspace = resolve('.work/demo-target'), marker = join(workspace, '.demo-workspace.json');
await mkdir(dirname(workspace), { recursive: true });
if ((await realpath(dirname(workspace))) !== resolve('.work')) throw new Error('Demo workspace parent must not be a symlink');
await mkdir(workspace, { recursive: true });
if ((await lstat(workspace)).isSymbolicLink()) throw new Error('Demo workspace must not be a symlink');
const identity = { targetId: target.id, repository: target.repository, baselineCommit: target.demo.baselineCommit };
let initialized = false;
try {
  const existing = JSON.parse(await readFile(marker, 'utf8'));
  if (JSON.stringify(existing) !== JSON.stringify(identity)) throw new Error('Demo workspace belongs to another baseline');
  initialized = true;
} catch (error) { if (error.code !== 'ENOENT') throw error; }
if (mode === 'fix' && !initialized) throw new Error('Run npm run demo:reset first');
if (mode === 'reset') {
  const source = resolve('../vulnerable-node-demo');
  const gitOptions = { cwd: source };
  const safe = ['-c', 'safe.directory=' + source.replaceAll('\\', '/')];
  const paths = (await git([...safe, 'ls-tree', '-r', '--name-only', target.demo.baselineCommit], gitOptions)).split('\n').filter(isDemoPath);
  if (!paths.includes('package.json') || !paths.includes('package-lock.json')) throw new Error('Missing baseline manifests');
  const expected = new Set(paths);
  async function removeExtraDemoFiles(directory) {
    let entries;
    try { entries = await readdir(join(workspace, directory), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const relative = directory + '/' + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Refusing to traverse a symlink in the demo workspace');
      if (entry.isDirectory()) await removeExtraDemoFiles(relative);
      else if (!expected.has(relative)) {
        const file = resolve(workspace, relative);
        if (!file.startsWith(workspace + sep)) throw new Error('Reset path escapes demo workspace');
        await unlink(file);
      }
    }
  }
  for (const directory of ['src', 'test']) {
    try {
      if ((await lstat(join(workspace, directory))).isSymbolicLink()) throw new Error('Demo source/test directory must not be a symlink');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await removeExtraDemoFiles(directory);
  }
  for (const path of paths) {
    const file = resolve(workspace, path);
    if (!file.startsWith(workspace + sep)) throw new Error('Baseline path escapes demo workspace');
    await mkdir(dirname(file), { recursive: true });
    // Neither an existing parent symlink nor a file symlink may redirect a write.
    const parent = await realpath(dirname(file));
    if (parent !== workspace && !parent.startsWith(workspace + sep)) throw new Error('Demo file parent escapes workspace');
    try { if ((await lstat(file)).isSymbolicLink()) throw new Error('Demo file must not be a symlink'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeFile(file, (await git([...safe, 'show', target.demo.baselineCommit + ':' + path], gitOptions)) + '\n');
  }
  await writeFile(marker, JSON.stringify(identity, null, 2));
} else {
  const [command, args] = npmCommand(['install', '--save-exact', 'minimist@1.2.8', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
  const result = await run(command, args, { cwd: workspace });
  if (result.code !== 0) throw new Error(result.stderr);
}
const [command, args] = npmCommand(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
const install = await run(command, args, { cwd: workspace });
if (install.code !== 0) throw new Error(install.stderr);
const tests = await run(process.execPath, ['--test'], { cwd: workspace });
console.log(tests.stdout);
if (tests.code !== 0) throw new Error('Demo application tests failed');
const scan = await run(process.execPath, ['scripts/local-demo.mjs', workspace]);
console.log(scan.stdout);
if (scan.code !== 0) throw new Error(scan.stderr || 'Demo scan failed');
console.log(mode === 'reset' ? 'Vulnerable baseline restored in the isolated workspace. Existing register history retained.' :
  'Scripted rehearsal fix applied to minimist. Use the GitHub remediation workflow to demonstrate Codex.');
