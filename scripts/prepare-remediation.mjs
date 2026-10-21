import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { readSkill, remediationPrompt } from '../lib/skill-evidence.mjs';
import { GitHub } from '../lib/github.mjs';
import { loadTargets } from '../lib/config.mjs';
import { auditRemote, findingKey } from '../lib/audit.mjs';
import { decodeRecord, saveRegister, registerLabel } from '../lib/register.mjs';
const hub = process.env.GITHUB_REPOSITORY;
const number = Number(process.env.ISSUE_NUMBER);
if (!Number.isSafeInteger(number) || number < 1) throw new Error('Enter a valid central register issue number');
const register = new GitHub(process.env.GITHUB_TOKEN), source = new GitHub(process.env.TARGET_TOKEN);
const issue = await register.get('/repos/' + hub + '/issues/' + number);
if (issue.pull_request || !issue.labels.some(l => l.name === registerLabel)) throw new Error('Issue is not a register entry');
const record = decodeRecord(issue), targets = await loadTargets();
const target = targets.find(t => t.id === record?.targetId && t.repository === record.repository && t.directory === record.directory);
if (!target || record.key !== findingKey(target, record.package, record.advisoryId)) throw new Error('Issue does not match an allowlisted target');
const scan = await auditRemote(source, target);
const finding = scan.findings.find(f => f.key === record.key);
async function output(values) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k,v]) => k + '=' + v).join('\n') + '\n');
}
async function requestScan() {
  const repo = await register.get('/repos/' + hub);
  await register.post('/repos/' + hub + '/actions/workflows/scan.yml/dispatches', { ref: repo.default_branch });
}
if (!finding) {
  console.log('Finding is absent in a fresh scan. Requesting register reconciliation.');
  await requestScan(); await output({ ready: 'false' });
} else {
  const open = await source.list('/repos/' + target.repository + '/pulls?state=open');
  const existing = open.find(p => p.head.repo?.full_name === target.repository && p.head.ref.startsWith('codex/fix-' + finding.key + '-'));
  if (existing) {
    await saveRegister(register, hub, [{ ...record, status: 'pr-open', remediation: { number: existing.number, url: existing.html_url, state: 'open' } }]);
    await requestScan(); await output({ ready: 'false' }); console.log('Existing PR: ' + existing.html_url);
  } else {
    const skill = await readSkill();
    const { content, ...skillIdentity } = skill;
    const context = { skill: skillIdentity, hubSha: process.env.GITHUB_SHA || null, target, finding, before: scan.findings, sha: scan.sha, base: scan.branch, issueNumber: number,
      issueUrl: issue.html_url, hub, branch: 'codex/fix-' + finding.key + '-' + (process.env.GITHUB_RUN_ID || Date.now()) };
    await mkdir('.work', { recursive: true });
    await writeFile('.work/context.json', JSON.stringify(context, null, 2));
    const prompt = remediationPrompt(context, skill);
    await writeFile('.work/SKILL.md', content);
    await writeFile('.work/skill.json', JSON.stringify(skillIdentity, null, 2));
    console.log('SKILL_CONFIGURED name=' + skill.name + ' sha256=' + skill.sha256);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const link = 'https://github.com/' + hub + '/blob/' + process.env.GITHUB_SHA + '/' + skill.path;
      await appendFile(process.env.GITHUB_STEP_SUMMARY, [
        '## Remediation skill', '',
        'Skill: [' + skill.name + '](' + link + ')', '',
        'SHA-256: `' + skill.sha256 + '`', '',
        'In **propose / Run Codex with the remediation skill**, inspect the completed command event for `read-remediation-skill.mjs` and its `SKILL_READ` output.', '',
        'The remediation-context artifact contains the exact skill and prompt. The codex-report artifact contains the final response.', '',
      ].join('\n'));
    }
    await writeFile('.work/prompt.md', prompt);
    await output({ ready: 'true', repository: target.repository, sha: scan.sha });
    console.log('Prepared ' + finding.package + ' / ' + finding.advisoryId);
  }
}
