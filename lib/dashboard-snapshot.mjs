import { unzipSync } from 'fflate';

export function snapshotFromArchive(bytes, hub) {
  if (bytes.length > 32 * 1024 * 1024) throw new Error('Snapshot archive is too large');
  let found = 0;
  const files = unzipSync(bytes, {filter: file => {
    if (file.name !== 'site/register.json') return false;
    if (++found > 1 || file.originalSize > 10 * 1024 * 1024) throw new Error('Invalid snapshot entry');
    return true;
  }});
  if (!files['site/register.json']) throw new Error('Snapshot is missing');
  const snapshot = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(files['site/register.json']));
  if (snapshot.hub !== hub || snapshot.mode !== 'github' || !Array.isArray(snapshot.findings) || !Array.isArray(snapshot.scans)) throw new Error('Wrong snapshot identity');
  return snapshot;
}

export function snapshotLoader(fetcher = fetch) {
  let cached;
  return async (api, hub) => {
    const repo = await api.get('/repos/' + hub);
    const result = await api.get('/repos/' + hub + '/actions/workflows/scan.yml/runs?status=completed&branch=' + encodeURIComponent(repo.default_branch) + '&per_page=1');
    const run = result.workflow_runs?.[0];
    if (!run || run.head_repository?.full_name?.toLowerCase() !== hub.toLowerCase() || !['workflow_dispatch','schedule'].includes(run.event)) throw new Error('No completed trusted scan');
    const cacheKey = run.id + ':' + run.run_attempt + ':' + run.updated_at;
    if (cached?.key === cacheKey) return cached.value;
    const {artifacts} = await api.get('/repos/' + hub + '/actions/runs/' + run.id + '/artifacts?per_page=100');
    const artifact = artifacts.find(a => a.name === 'vulnerability-dashboard' && !a.expired);
    if (!artifact) throw new Error('Latest scan has no available snapshot; run a fresh scan');
    const response = await fetcher('https://api.github.com/repos/' + hub + '/actions/artifacts/' + artifact.id + '/zip', {
      headers: {Authorization: 'Bearer ' + api.token, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error('Snapshot download failed');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length; if (size > 32 * 1024 * 1024) throw new Error('Snapshot archive is too large');
      chunks.push(chunk);
    }
    const value = snapshotFromArchive(Buffer.concat(chunks), hub);
    cached = {key: cacheKey, value}; return value;
  };
}
