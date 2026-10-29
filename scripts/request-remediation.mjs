import { readFile, appendFile } from 'node:fs/promises';
import { GitHub } from '../lib/github.mjs';
import { loadTargets } from '../lib/config.mjs';
import { requestRemediation } from '../lib/fix-request.mjs';
const api = new GitHub(process.env.GITHUB_TOKEN), hub = process.env.GITHUB_REPOSITORY;
const issueNumber = await requestRemediation({
  api, hub,
  actor: process.env.GITHUB_ACTOR, triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR || process.env.GITHUB_ACTOR,
  eventName: process.env.GITHUB_EVENT_NAME, event: JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')),
  targets: await loadTargets(),
});
if (issueNumber === null) {
  console.log('No new fix request; nothing dispatched.');
  process.exit(0);
}
const url = 'https://github.com/' + hub + '/actions/workflows/remediate.yml';
console.log('Requested remediation for register issue #' + issueNumber + ': ' + url);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
  'Remediation requested for [register issue #' + issueNumber + '](https://github.com/' + hub + '/issues/' + issueNumber + ').\n\n' +
  '[Follow Remediate vulnerability](' + url + '). Existing fix PRs are reused; nothing is merged automatically.\n');
