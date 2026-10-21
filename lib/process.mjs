import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
export function npmCommand(args) {
  if (process.platform !== 'win32') return ['npm', args];
  const cli = [join(process.env.APPDATA || '', 'npm/node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')].find(existsSync);
  if (!cli) throw new Error('Cannot find npm-cli.js');
  return [process.execPath, [cli, ...args]];
}
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options, shell: false });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(command + ' timed out')); }, options.timeout || 180000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
export async function git(args, options = {}) {
  const r = await run('git', args, options);
  if (r.code !== 0) throw new Error('git ' + args[0] + ' failed: ' + r.stderr);
  return r.stdout.trim();
}
