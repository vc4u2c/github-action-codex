import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadTargets } from '../lib/config.mjs';
import { auditLocal } from '../lib/audit.mjs';
import { reconcile } from '../lib/register.mjs';
import { buildDashboard, markdownSummary } from '../lib/dashboard.mjs';
const target = (await loadTargets())[0];
const directory = resolve(process.argv[2] || (existsSync('.work/demo-target/.demo-workspace.json') ? '.work/demo-target' : '../vulnerable-node-demo'), target.directory);
await mkdir('artifacts', { recursive: true });
let previous = [];
try { previous = JSON.parse(await readFile('artifacts/local-register.json', 'utf8')).findings; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
let scan;
try {
  const audit = await auditLocal(directory, target);
  scan = { target, success: true, sha: 'local-working-tree', scannedAt: new Date().toISOString(), findings: audit.findings };
  await writeFile('artifacts/local-audit.json', JSON.stringify(audit.report, null, 2));
} catch (error) {
  scan = { target, success: false, scannedAt: new Date().toISOString(), error: error.message };
}
const snapshot = { generatedAt: new Date().toISOString(), mode: 'local', hub: null, scans: [scan], findings: reconcile(previous, [scan]) };
await writeFile('artifacts/local-register.json', JSON.stringify(snapshot, null, 2));
await writeFile('artifacts/summary.md', markdownSummary(snapshot));
await buildDashboard(snapshot);
console.log(markdownSummary(snapshot));
console.log('Run npm run dashboard and open http://127.0.0.1:4173');
if (!scan.success) process.exitCode = 1;
