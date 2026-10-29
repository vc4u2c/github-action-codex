import { publicationEvidence } from '../lib/validation-evidence.mjs';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { GitHub } from '../lib/github.mjs';
import { loadTargets } from '../lib/config.mjs';
import { assertContext, applyProposal } from '../lib/remediation.mjs';
import { decodeRecord, readRegister, saveRegister } from '../lib/register.mjs';
const context = JSON.parse(await readFile(process.argv[2], 'utf8'));
assertContext(context, await loadTargets());
if (context.hub !== process.env.GITHUB_REPOSITORY) throw new Error('Wrong hub');
const checkout = resolve(process.argv[3]), patch = process.argv[4];
const receipt = JSON.parse(await readFile(process.argv[5], 'utf8'));
const checked = await applyProposal(context, checkout, patch);
if (receipt.patchSha256 !== checked.patchSha256 || receipt.baseSha !== context.sha || receipt.findingKey !== context.finding.key) throw new Error('Verification receipt does not match the proposal');
const source = new GitHub(process.env.TARGET_TOKEN), register = new GitHub(process.env.GITHUB_TOKEN);
const root = '/repos/' + context.target.repository;
const required = (context.findings || [context.finding]).map(f => f.key);
if (!Array.isArray(receipt.resolvedKeys) || required.some(key => !receipt.resolvedKeys.includes(key)) ||
    receipt.resolvedKeys.some(key => !context.before.some(f => f.key === key))) throw new Error('Receipt is missing verified group findings');
const records = await readRegister(register, context.hub);
const linked = records.filter(r => r.repository === context.target.repository && r.manifest === context.finding.manifest && receipt.resolvedKeys.includes(r.key));
if (required.some(key => !linked.some(r => r.key === key))) throw new Error('Selected register entry changed identity');
const baseCommit = await source.get(root + '/git/commits/' + context.sha);
const tree = [];
for (const file of checked.files) {
  try {
    const content = await readFile(join(checkout, file));
    const blob = await source.post(root + '/git/blobs', { content: content.toString('base64'), encoding: 'base64' });
    tree.push({ path: file, mode: '100644', type: 'blob', sha: blob.sha });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    tree.push({ path: file, mode: '100644', type: 'blob', sha: null });
  }
}
const newTree = await source.post(root + '/git/trees', { base_tree: baseCommit.tree.sha, tree });
const commit = await source.post(root + '/git/commits', { message: 'fix: remediate ' + context.finding.package + ' ' + context.finding.advisoryId, tree: newTree.sha, parents: [context.sha] });
let publishedSha = commit.sha;
try { await source.post(root + '/git/refs', { ref: 'refs/heads/' + context.branch, sha: commit.sha }); }
catch (error) {
  if (!error.message.includes(': 422')) throw error;
  const ref = await source.get(root + '/git/ref/heads/' + context.branch);
  const existing = await source.get(root + '/git/commits/' + ref.object.sha);
  if (existing.tree.sha !== newTree.sha || existing.parents[0]?.sha !== context.sha) throw new Error('Existing remediation branch differs; refusing to overwrite');
  publishedSha = ref.object.sha;
}
const validation = publicationEvidence(context, receipt, checked, publishedSha, process.env);
const prs = await source.list(root + '/pulls?state=open&head=' + encodeURIComponent(context.target.repository.split('/')[0] + ':' + context.branch));
const pr = prs[0] || await source.post(root + '/pulls', {
  title: 'fix: remediate ' + context.finding.package + ' (' + required.length + (required.length === 1 ? ' advisory)' : ' advisories)'),
  head: context.branch, base: context.base,
  body: 'Addresses these verified register findings:\n' + linked.map(r => '- ' + r.advisoryId + ': ' + r.issueUrl).join('\n') + '\n\n' +
    'Codex applied the central remediation skill to the dependency finding at commit ' + context.sha + '.\n\n' +
    'Skill: ' + context.skill.name + ' (`' + context.skill.sha256 + '`). ' +
    'Inspect the workflow logs for the skill-read command; the remediation-context and codex-report artifacts preserve the supplied instructions and final response.\n\n' +
    'Independent validation: npm ci succeeded with lifecycle scripts disabled; application tests passed; ' +
    'a fresh npm audit confirmed every advisory in the selected package group is absent and introduced no new advisory keys.\n\n' +
    'Other existing findings may remain. Review the dependency and source diff before merging. ' +
    'After merge, the hub rescans the default branch before closing the register entry.\n\n' +
    'Validation: https://github.com/' + context.hub + '/actions/runs/' + process.env.GITHUB_RUN_ID,
});
const issue = await register.get('/repos/' + context.hub + '/issues/' + context.issueNumber);
const record = decodeRecord(issue);
if (record?.key !== context.finding.key) throw new Error('Register entry changed identity');
await saveRegister(register, context.hub, linked.map(r => ({ ...r, status: 'pr-open', remediation: { number: pr.number, url: pr.html_url, state: 'open', headSha: publishedSha, validation, groupKey: context.groupKey, resolvedKeys: receipt.resolvedKeys, patchSha256: checked.patchSha256 } })));
console.log('Remediation PR: ' + pr.html_url);
// The completion workflow refreshes the snapshot for every outcome.
