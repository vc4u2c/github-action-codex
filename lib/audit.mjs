import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { npmCommand, run } from './process.mjs';
import { manifestPath } from './config.mjs';
export function findingKey(target, packageName, advisoryId) {
  return createHash('sha256').update([target.repository.toLowerCase(), manifestPath(target), packageName, advisoryId].join('|')).digest('hex').slice(0, 24);
}
export function normalizeAudit(report, target, lock = {}) {
  if (report?.error || report?.auditReportVersion !== 2 || !report.vulnerabilities ||
      Array.isArray(report.vulnerabilities) || !Number.isInteger(report.metadata?.vulnerabilities?.total)) {
    throw new Error('Incomplete or unsupported audit report; findings will not be closed');
  }
  const findings = new Map();
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (!Array.isArray(vulnerability.via) || !vulnerability.via.length || !Array.isArray(vulnerability.nodes)) throw new Error('Malformed audit entry');
    for (const advisory of vulnerability.via) {
      if (typeof advisory === 'string') {
        if (!report.vulnerabilities[advisory]) throw new Error('Incomplete transitive advisory');
        continue;
      }
      const advisoryId = advisory.url?.match(/GHSA-[a-z0-9-]+/i)?.[0] || String(advisory.source || '');
      if (!advisoryId || !['info', 'low', 'moderate', 'high', 'critical'].includes(advisory.severity)) throw new Error('Malformed advisory');
      const key = findingKey(target, name, advisoryId);
      findings.set(key, { key, targetId: target.id, repository: target.repository, directory: target.directory,
        manifest: manifestPath(target), package: name, advisoryId, title: advisory.title || name,
        url: advisory.url || '', severity: advisory.severity, range: advisory.range || vulnerability.range,
        direct: vulnerability.isDirect,
        installedVersions: [...new Set(vulnerability.nodes.map(n => lock.packages?.[n]?.version).filter(Boolean))],
        locations: vulnerability.nodes, fixAvailable: vulnerability.fixAvailable || false });
    }
  }
  const total = report.metadata.vulnerabilities.total;
  if (total < 0 || total !== Object.keys(report.vulnerabilities).length || (total > 0 && !findings.size)) throw new Error('Inconsistent audit totals');
  return [...findings.values()];
}
export async function auditManifests(packageJson, packageLock, target) {
  const folder = await mkdtemp(join(tmpdir(), 'vulnerability-audit-'));
  try {
    JSON.parse(packageJson);
    const lock = JSON.parse(packageLock);
    if (![2, 3].includes(lock.lockfileVersion)) throw new Error('Use lockfile version 2 or 3');
    await writeFile(join(folder, 'package.json'), packageJson);
    await writeFile(join(folder, 'package-lock.json'), packageLock);
    const [command, args] = npmCommand(['audit', '--json', '--ignore-scripts', '--registry=https://registry.npmjs.org', '--fetch-retries=1', '--fetch-timeout=30000']);
    const result = await run(command, args, { cwd: folder });
    if (![0, 1].includes(result.code)) throw new Error('npm audit failed (exit ' + result.code + '): ' + result.stderr.slice(0, 500));
    let report;
    try { report = JSON.parse(result.stdout); } catch { throw new Error('npm audit returned invalid JSON'); }
    return { report, findings: normalizeAudit(report, target, lock) };
  } finally { await rm(folder, { recursive: true, force: true }); }
}
export async function auditLocal(directory, target) {
  const [pkg, lock] = await Promise.all(['package.json', 'package-lock.json'].map(n => readFile(join(directory, n), 'utf8')));
  return auditManifests(pkg, lock, target);
}
export async function auditRemote(api, target) {
  const repo = await api.get('/repos/' + target.repository);
  const commit = await api.get('/repos/' + target.repository + '/commits/' + encodeURIComponent(repo.default_branch));
  const files = await Promise.all(['package.json', 'package-lock.json'].map(async name => {
    const file = await api.get('/repos/' + target.repository + '/contents/' + manifestPath(target, name) + '?ref=' + commit.sha);
    if (file.encoding !== 'base64' || file.type !== 'file') throw new Error('Unable to read ' + name);
    return Buffer.from(file.content, 'base64').toString('utf8');
  }));
  const audit = await auditManifests(...files, target);
  return { ...audit, target, sha: commit.sha, branch: repo.default_branch, scannedAt: new Date().toISOString(), success: true };
}
