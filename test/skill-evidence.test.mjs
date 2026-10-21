import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readSkill, assertSkillMatches, remediationPrompt } from '../lib/skill-evidence.mjs';

test('the actual skill text and version are sent to Codex in the prompt', async () => {
  const skill = await readSkill();
  const prompt = remediationPrompt({ skill, target: { directory: '.' } }, skill);
  assert.ok(prompt.endsWith(skill.content));
  assert.ok(prompt.includes(skill.sha256));
  assert.ok(skill.content.length > 200);
});

test('skill evidence rejects missing identity, a different skill, and changed instructions', async () => {
  const skill = await readSkill();
  for (const expected of [null, { ...skill, name: 'different-skill' }, { ...skill, path: 'other/SKILL.md' }, { ...skill, sha256: '0'.repeat(64) }]) {
    assert.throws(() => assertSkillMatches(expected, skill), /does not match/);
  }
});

test('the skill-read command prints the checked contents and fails before logging success on version drift', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hub-skill-evidence-'));
  try {
    const skill = await readSkill();
    const context = join(directory, 'context.json');
    const script = fileURLToPath(new URL('../scripts/read-remediation-skill.mjs', import.meta.url));
    await writeFile(context, JSON.stringify({ skill }));
    const read = spawnSync(process.execPath, [script, context], { encoding: 'utf8' });
    assert.equal(read.status, 0, read.stderr);
    assert.ok(read.stdout.includes(skill.content));
    assert.ok(read.stdout.includes('SKILL_READ name=' + skill.name + ' sha256=' + skill.sha256));
    await writeFile(context, JSON.stringify({ skill: { ...skill, sha256: '0'.repeat(64) } }));
    const mismatch = spawnSync(process.execPath, [script, context], { encoding: 'utf8' });
    assert.notEqual(mismatch.status, 0);
    assert.ok(!mismatch.stdout.includes('SKILL_READ'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
