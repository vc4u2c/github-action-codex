import { packageScope } from './activity.js';

export const validationChecks = ['patch', 'installation', 'tests', 'audit'];
export function verificationForRun(run) {
  const job = run?.jobs?.find(j => j.name === 'verify');
  if (!job) return {label: 'Unavailable', kind: 'open', detail: 'Open the run for verification evidence.'};
  if (job.conclusion === 'skipped') return {label: 'Not run', kind: 'open', detail: 'Verification was skipped in this run.', url: job.url};
  if (job.conclusion === 'success') return {label: 'Passed', kind: 'resolved', detail: 'Patch checks, installation, tests and fresh audit passed.', url: job.url};
  if (job.status !== 'completed') return {label: job.status === 'in_progress' ? 'Running' : 'Pending', kind: 'running', detail: job.step || 'Waiting for the independent verifier.', url: job.url};
  return {label: 'Failed', kind: 'failed', detail: job.step || job.conclusion || 'Verification did not complete successfully.', url: job.url};
}

export function validationForFinding(finding, findings, runs, scans) {
  const since = Date.parse(finding.cycleStartedAt || finding.firstSeen);
  const group = new Set(findings.filter(f => packageScope(f) === packageScope(finding)).map(f => f.issueNumber));
  const current = runs.filter(r => group.has(r.issueNumber) && Date.parse(r.createdAt) >= since)
    .sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id-a.id);
  const receipt = finding.remediation?.validation;
  let proposal = {label: 'Not run this cycle', kind: 'open', detail: 'Request a fix to run the independent verifier.'};
  const usable = receipt?.schema === 1 && Date.parse(receipt.verifiedAt) >= since &&
    receipt.resolvedKeys?.includes(finding.key) && receipt.patchSha256 === finding.remediation?.patchSha256 &&
    validationChecks.every(k => receipt.checks?.[k] === 'passed');
  if (usable) {
    proposal = receipt.headSha === finding.remediation.headSha
      ? {label: 'Passed', kind: 'resolved', detail: 'Patch checks, installation, tests and fresh audit passed for this PR commit.', url: receipt.runUrl, receipt}
      : {label: 'Needs revalidation', kind: 'failed', detail: 'The PR commit changed or could not be confirmed. Earlier proposal evidence does not cover the current commit.', url: receipt.runUrl};
  } else if (current.length) {
    const result = verificationForRun(current[0]);
    proposal = result.label === 'Passed'
      ? {...result, label: 'Job passed', kind: 'open', detail: 'Verifier job passed. No published receipt links this result to the current PR commit; inspect the run evidence.'}
      : result;
  }
  const scan = scans.find(s => s.target.repository.toLowerCase() === finding.repository.toLowerCase() &&
    (s.target.directory === '.' ? 'package-lock.json' : s.target.directory + '/package-lock.json') === finding.manifest);
  let main = {label: 'Unavailable', kind: 'open', detail: 'No scan evidence for this target.'};
  if (scan && !scan.success) main = {label: 'Scan failed', kind: 'failed', detail: 'Current state is unverified. ' + (scan.error || 'Open the scan run.')};
  else if (scan && scan.sha === finding.scanSha) {
    const present = scan.findings.some(f => f.key === finding.key);
    main = {label: present ? 'Advisory present' : 'Advisory absent', kind: present ? 'open' : 'resolved',
      detail: 'npm audit of main at ' + scan.sha.slice(0,12) + '. ' +
        (present && finding.status === 'pr-open' ? 'Merge and rescan are still required.' : 'Scanned ' + scan.scannedAt),
      url: 'https://github.com/' + finding.repository + '/commit/' + scan.sha, runUrl: scan.runUrl};
  }
  return {proposal, main};
}
