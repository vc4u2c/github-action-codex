import { readFile, appendFile } from 'node:fs/promises';
import { GitHub } from '../lib/github.mjs';
import { loadTargets } from '../lib/config.mjs';
import { authorizeFixRequest } from '../lib/fix-request.mjs';
const api = new GitHub(process.env.GITHUB_TOKEN), hub = process.env.GITHUB_REPOSITORY;
const issueNumber = await authorizeFixRequest({
  api, hub,
  actor: process.env.GITHUB_ACTOR, triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR || process.env.GITHUB_ACTOR,
  eventName: process.env.GITHUB_EVENT_NAME, event: JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')),
  targets: await loadTargets(),
});
const repository = await api.get('/repos/' + hub);
await api.post('/repos/' + hub + '/actions/workflows/remediate.yml/dispatches', {
  ref: repository.default_branch, inputs: { issue_number: String(issueNumber) },
});
const url = 'https://github.com/' + hub + '/actions/workflows/remediate.yml';
console.log('Requested remediation for register issue #' + issueNumber + ': ' + url);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
  'Remediation requested for [register issue #' + issueNumber + '](https://github.com/' + hub + '/issues/' + issueNumber + ').\n\n' +
  '[Follow Remediate vulnerability](' + url + '). Existing fix PRs are reused; nothing is merged automatically.\n');
