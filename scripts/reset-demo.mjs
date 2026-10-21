import { appendFile } from 'node:fs/promises';
import { GitHub } from '../lib/github.mjs';
import { demoTarget, resetRemote } from '../lib/demo-reset.mjs';
const target = await demoTarget(process.env.TARGET_ID || 'node-demo');
const result = await resetRemote(new GitHub(process.env.TARGET_TOKEN), target, process.env.GITHUB_RUN_ID);
console.log(result.pr ? 'Reset PR: ' + result.pr.html_url : 'Demo already matches the vulnerable baseline.');
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, '# Reset demo\n\n' +
    (result.pr ? '[' + result.pr.title + '](' + result.pr.html_url + ')\n\nMerge this PR, then wait for the central scan to reopen the existing findings.' :
      'The target is already at the vulnerable baseline. A central scan has been requested.') + '\n');
}
if (result.status === 'already-baseline') {
  const hub = process.env.GITHUB_REPOSITORY, api = new GitHub(process.env.GITHUB_TOKEN);
  const repo = await api.get('/repos/' + hub);
  await api.post('/repos/' + hub + '/actions/workflows/scan.yml/dispatches', { ref: repo.default_branch });
}
