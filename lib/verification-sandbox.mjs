import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { run } from './process.mjs';

const versions = JSON.parse(await readFile(new URL('../config/tool-versions.json', import.meta.url), 'utf8'));
export const verificationImage = versions.verificationImage;
if (!/^node:22-bookworm-slim@sha256:[a-f0-9]{64}$/.test(verificationImage)) throw new Error('Pin the verification image by digest');

export function assertTestsPassed(result) {
  // Node's TAP totals count skipped/todo tests too. Require an actual passing test.
  const count = name => Number([...result.stdout.matchAll(new RegExp('^# ' + name + ' ([0-9]+)\\r?$', 'gm'))].at(-1)?.[1] ?? NaN);
  if (result.code !== 0 || !(count('tests') > 0) || !(count('pass') > 0) || count('fail') !== 0 || count('cancelled') !== 0) {
    throw new Error('Application tests failed or no tests passed');
  }
}

export function printTestOutput(result) {
  // Application output is untrusted, including GitHub workflow-command syntax.
  const marker = randomUUID();
  if (process.env.GITHUB_ACTIONS) console.log('::stop-commands::' + marker);
  console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  if (process.env.GITHUB_ACTIONS) console.log('::' + marker + '::');
}

export async function runApplicationTests(checkout, directory = '.') {
  if (directory !== '.' && !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(directory)) throw new Error('Unsafe target directory');
  const source = resolve(checkout);
  if (/[\r\n,]/.test(source)) throw new Error('Unsupported Docker mount path');
  const id = 'hub-verify-' + randomUUID();
  const volume = id + '-work';
  const names = ['init', 'install', 'test'].map(phase => id + '-' + phase);
  const docker = async (args, timeout = 240000) => {
    const result = await run('docker', args, { timeout });
    if (result.code !== 0) throw new Error('Verification container failed: ' + JSON.stringify(result.stderr.slice(0, 2000)));
    return result;
  };
  const base = (name, network, user) => ['run', '--rm', '--name', name, '--platform', 'linux/amd64',
    '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', user,
    '--network', network, '--pids-limit=128', '--memory=1g', '--cpus=2',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456,mode=1777'];
  // No runner environment, credentials, Docker socket, hub, context, patch, or receipt is mounted.
  await docker(['pull', '--platform', 'linux/amd64', verificationImage]);
  await docker(['volume', 'create', '--label', 'vulnerability-hub=verification', volume]);
  try {
    // A trusted command makes this disposable volume writable by the non-root installer.
    await docker([...base(names[0], 'none', '0:0'), '--mount', 'type=volume,source=' + volume + ',target=/work',
      verificationImage, 'chmod', '0777', '/work']);
    const copy = "require('node:fs').cpSync('/source', '/work', {recursive:true, filter:p=>!['.git','node_modules'].includes(require('node:path').basename(p))})";
    const workdir = directory === '.' ? '/work' : '/work/' + directory;
    await docker([...base(names[1], 'bridge', '1000:1000'),
      '--mount', 'type=bind,source=' + source + ',target=/source,readonly',
      '--mount', 'type=volume,source=' + volume + ',target=/work', '--env', 'HOME=/tmp',
      verificationImage, 'sh', '-ec', 'node -e "$1"; cd "$2"; timeout 180 npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000',
      'install', copy, workdir]);
    // Stop the installer before tests. Tests see only a read-only copy and loopback networking.
    return await run('docker', [...base(names[2], 'none', '1000:1000'),
      '--mount', 'type=volume,source=' + volume + ',target=/work,readonly',
      '--workdir', workdir, '--env', 'HOME=/tmp', verificationImage,
      'timeout', '180', 'node', '--test', '--test-reporter=tap'], { timeout: 240000 });
  } finally {
    // Also remove containers after a timeout; killing the Docker client alone is insufficient.
    await run('docker', ['rm', '--force', ...names], { timeout: 30000 });
    await docker(['volume', 'rm', volume], 30000);
  }
}
