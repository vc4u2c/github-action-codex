// Resolve maintained version tags to immutable commits. Run intentionally when updating tools.
import { readFile, writeFile } from 'node:fs/promises';
const files = ['.github/workflows/ci.yml', '.github/workflows/scan.yml', '.github/workflows/remediate.yml',
  '../vulnerable-node-demo/.github/workflows/ci.yml', '.github/workflows/reset-demo.yml'];
const pins = new Map();
for (const file of files) {
  let source = await readFile(file, 'utf8');
  const references = [...source.matchAll(/uses: ([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)@([a-zA-Z0-9.]+)(?: # (v[0-9.]+))?/g)];
  for (const match of references) {
    const repo = match[1], version = match[3] || match[2], key = repo + '@' + version;
    if (/^[a-f0-9]{40}$/.test(version)) continue;
    if (!pins.has(key)) {
      const response = await fetch('https://api.github.com/repos/' + repo + '/commits/' + version, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(key + ': HTTP ' + response.status);
      const commit = await response.json();
      if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error('Invalid commit SHA');
      pins.set(key, commit.sha);
    }
    source = source.replace(match[0], 'uses: ' + repo + '@' + pins.get(key) + ' # ' + version);
  }
  await writeFile(file, source);
}
const response = await fetch('https://registry.npmjs.org/@openai/codex/latest', { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error('Cannot resolve Codex CLI version');
const { version } = await response.json();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected stable Codex version');
let remediation = await readFile(files[2], 'utf8');
if (/          codex-version:/.test(remediation)) remediation = remediation.replace(/          codex-version: .*/, "          codex-version: '" + version + "'");
else remediation = remediation.replace('          permission-profile: remediation', "          codex-version: '" + version + "'\n          permission-profile: remediation");
await writeFile(files[2], remediation);
await writeFile('config/tool-versions.json', JSON.stringify({ resolvedAt: new Date().toISOString(), codex: version, actions: Object.fromEntries(pins) }, null, 2) + '\n');
console.log('Pinned ' + pins.size + ' action references and Codex CLI ' + version);
