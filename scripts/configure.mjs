import { readFile, writeFile } from 'node:fs/promises';
const owner = process.argv[2];
if (!/^[A-Za-z0-9-]+$/.test(owner || '')) throw new Error('Usage: npm run configure -- YOUR_GITHUB_OWNER');
const config = JSON.parse(await readFile('config/targets.json', 'utf8'));
config.targets[0].repository = owner + '/vulnerable-node-demo';
await writeFile('config/targets.json', JSON.stringify(config, null, 2) + '\n');
console.log('Configured ' + config.targets[0].repository);
