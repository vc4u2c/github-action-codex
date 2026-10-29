export class GitHub {
  constructor(token, fetcher = fetch, { allowAnonymous = false } = {}) {
    if (!token && !allowAnonymous) throw new Error('Missing GitHub token');
    this.token = token; this.fetcher = fetcher;
  }
  async request(method, path, body) {
    if (!this.token && method !== 'GET') throw new Error('Anonymous GitHub access is read-only');
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Expected GitHub API path');
    const response = await this.fetcher('https://api.github.com' + path, {
      method, headers: { ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}), Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('GitHub ' + method + ' ' + path + ': ' + response.status + ' ' + (await response.text()).slice(0, 400));
    return response.status === 204 ? null : response.json();
  }
  async text(path) {
    if (!path.startsWith('/repos/') || !/\/actions\/jobs\/\d+\/logs$/.test(path)) throw new Error('Expected a job log path');
    const response=await this.fetcher('https://api.github.com'+path,{headers:{...(this.token?{Authorization:'Bearer '+this.token}:{}),Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error('Job logs unavailable: '+response.status);
    const reader=response.body.getReader(); let size=0; const chunks=[];
    try { while(true) {const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>32*1024*1024) throw new Error('Job log exceeds 32 MB'); chunks.push(value);} } finally {await reader.cancel();}
    return Buffer.concat(chunks).toString('utf8');
  }
  get(path) { return this.request('GET', path); }
  post(path, body) { return this.request('POST', path, body); }
  patch(path, body) { return this.request('PATCH', path, body); }
  async list(path) {
    const all = [];
    for (let page = 1; ; page++) {
      const batch = await this.get(path + (path.includes('?') ? '&' : '?') + 'per_page=100&page=' + page);
      if (!Array.isArray(batch)) throw new Error('Expected paginated GitHub list');
      all.push(...batch);
      if (batch.length < 100) return all;
    }
  }
}
