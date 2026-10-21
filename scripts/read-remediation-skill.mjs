import { readFile } from 'node:fs/promises';
import { readSkill, assertSkillMatches } from '../lib/skill-evidence.mjs';
const context = JSON.parse(await readFile(process.argv[2], 'utf8'));
const skill = await readSkill();
assertSkillMatches(context.skill, skill);
console.log('SKILL_READ name=' + skill.name + ' sha256=' + skill.sha256);
console.log('Skill source: ' + skill.path);
console.log(skill.content);
