import { appendFile } from 'node:fs/promises';
import { loadTargets } from '../lib/config.mjs';
const targets = await loadTargets();
const owners = new Set(targets.map(t => t.repository.split('/')[0]));
if (owners.size !== 1) throw new Error('This demo uses one GitHub App installation owner; split scans by installation for multiple owners');
const values = { owner: [...owners][0], repositories: [...new Set(targets.map(t => t.repository.split('/')[1]))].join(',') };
await appendFile(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k,v]) => k + '=' + v).join('\n') + '\n');
