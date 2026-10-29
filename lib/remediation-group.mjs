import { createHash } from 'node:crypto';
export const samePackage = (a, b) => a.repository.toLowerCase() === b.repository.toLowerCase() && a.manifest === b.manifest && a.package === b.package;
export const groupKey = finding => createHash('sha256').update([finding.repository.toLowerCase(), finding.manifest, finding.package].join('\n')).digest('hex').slice(0, 24);
export function groupedFindings(finding, findings) {
  return findings.filter(f => samePackage(f, finding)).sort((a,b) => a.key.localeCompare(b.key));
}
export function existingFix(pulls, finding, records = [], base) {
  const prefix = 'codex/fix-' + groupKey(finding) + '-';
  return pulls.find(p => p.head.repo?.full_name === finding.repository && (!base || p.base?.ref === base) && (p.head.ref.startsWith(prefix) ||
    p.head.ref.startsWith('codex/fix-' + finding.key + '-') ||
    records.some(r => samePackage(r, finding) && r.remediation?.number === p.number && r.remediation?.groupKey === groupKey(finding))));
}
