import { validationChecks } from '../dashboard/validation.js';

// Called only after the publisher has matched the receipt to the actual patch.
export function publicationEvidence(context, receipt, checked, headSha, env) {
  const runId = Number(env.GITHUB_RUN_ID), attempt = Number(env.GITHUB_RUN_ATTEMPT);
  if (receipt.schema !== 1 || !Number.isFinite(Date.parse(receipt.verifiedAt)) ||
      !validationChecks.every(key => receipt.checks?.[key] === 'passed') ||
      receipt.patchSha256 !== checked.patchSha256 || receipt.baseSha !== context.sha ||
      !/^[a-f0-9]{40}$/.test(headSha) || !Number.isSafeInteger(runId) || runId < 1 ||
      !Number.isSafeInteger(attempt) || attempt < 1) throw new Error('Incomplete validation evidence');
  return {schema: 1, checks: receipt.checks, verifiedAt: receipt.verifiedAt,
    baseSha: receipt.baseSha, headSha, patchSha256: receipt.patchSha256,
    resolvedKeys: receipt.resolvedKeys, remainingFindings: receipt.remainingFindings,
    verificationImage: receipt.verificationImage, runId, attempt,
    runUrl: 'https://github.com/' + context.hub + '/actions/runs/' + runId + '/attempts/' + attempt};
}
