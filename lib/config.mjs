import { readFile } from 'node:fs/promises';
export function validateTargets(config) {
  if (!Array.isArray(config.targets) || !config.targets.length) throw new Error('Configure at least one target');
  const ids = new Set(), scopes = new Set();
  for (const t of config.targets) {
    if (!/^[a-z0-9-]+$/.test(t.id) || ids.has(t.id)) throw new Error('Invalid or duplicate target id');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(t.repository)) throw new Error('Expected owner/repository');
    if (t.ecosystem !== 'npm') throw new Error('Only npm targets are supported');
    if (t.directory !== '.' && !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(t.directory)) throw new Error('Unsafe target directory');
    const scope = t.repository.toLowerCase() + ':' + t.directory;
    if (scopes.has(scope)) throw new Error('Duplicate target scope');
    ids.add(t.id); scopes.add(scope);
  }
  return config.targets;
}
export async function loadTargets(file = 'config/targets.json') {
  return validateTargets(JSON.parse(await readFile(file, 'utf8')));
}
export const manifestPath = (t, file = 'package-lock.json') => t.directory === '.' ? file : t.directory + '/' + file;
