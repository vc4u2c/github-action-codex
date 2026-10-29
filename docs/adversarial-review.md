# Adversarial review

[Architecture](architecture.md) | [Implementation](implementation-guide.md) | [Demo runbook](demo-runbook.md)

Review date: **October 28, 2026 (America/Chicago)**. Scope: the central scanner/register lifecycle, patch verification, workflow credentials, skill evidence, and documentation. The review used code inspection, deliberately failing inputs, real Git patches, real npm audits, and container tests. This is a focused engineering review, not a guarantee of no defects or a full penetration test.

## Confirmed findings and fixes

| Finding | Reproduction and impact | Fix |
| --- | --- | --- |
| **High: application tests could change verification evidence** | A local test-only patch left minimist at 1.2.5, then rewrote the manifests during test execution. The old verifier audited those changed files and produced a passing receipt for the still-vulnerable patch. Tests also shared the host filesystem with the verifier. | Audit the pristine proposal before executing application code. Install and test in restricted containers. Tests receive a read-only disposable application copy; host context, patch, receipt, credentials, and Docker socket are unavailable. |
| **Medium: an all-skipped test suite counted as successful** | Node exits successfully and reports a positive test count when every test is skipped. The previous gate checked only exit code and test count. | Require a positive passing-test count and zero failures/cancellations, as well as a successful exit. A regression runs an actual skipped Node test suite. |

The application PR did not contain either attack: its patch changes only `package.json` and `package-lock.json`.

## Validation

- The original tampering reproduction was accepted before the fix and rejected afterward with `Selected vulnerability is still present`, before application execution and without a receipt.
- Docker regression tests attempted lockfile writes, host receipt reads/writes, access to the Docker socket, and access to a harmless host environment canary. Those attempts were blocked; local HTTP tests still passed. An uncaught lockfile-write attempt failed verification.
- The demo minimist update passed the revised verifier: both application tests passed, the selected advisory disappeared, and five unrelated lodash advisories remained. The patch SHA-256 was `cd7cdd50fbc90e4ece539286cfb2449ae9f3b27523d3b3089acdd9a8de606683`, matching the original proposal artifact.
- The local lifecycle rehearsal confirmed `open -> resolved -> open`. It did not merge or change application PR #1.
- The normal hub suite passed 29 tests; the opt-in Docker check was run separately and passed. Hub CI now runs the Docker regression checks on every push/PR.

The earlier [successful Codex run](https://github.com/vc4u2c/github-action-codex/actions/runs/40803030409) remains historical evidence of the proposal and skill read. It predates this verifier change. These checks did not rerun Codex or spend OpenAI API credits.

## Boundaries checked

The scanner reads manifests at a specific default-branch commit, rejects malformed reports, and checks branch movement before reconciliation. Failed scans preserve prior findings. Register tests cover recurrence, scope isolation, duplicate keys, and closed-issue pagination.

The proposal, verifier, and publisher use separate runners. Patch gates reject workflow/instruction changes, unsafe modes, removed test files, an unfixed selected advisory, and new advisory identities. The publisher checks the patch digest against its verification receipt and executes no application code. App credentials remain in the jobs that need them; the notifier job does not check out application code.

The new sandbox uses a digest-pinned Node image, non-root application processes, a read-only root filesystem, dropped Linux capabilities, no privilege escalation, bounded resources, and disposable storage. Tests have only loopback networking. See Docker's [container options](https://docs.docker.com/reference/cli/docker/container/run/) and [none network driver](https://docs.docker.com/engine/network/drivers/none/) for the underlying controls.

## Remaining limits

- `npm audit` checks known dependency advisories using package metadata. It is not source-code analysis, malware detection, or proof that all dependency metadata is authentic.
- Passing tests do not prove correctness. Existing test files must remain, but their assertions can change; source and test diffs still need human review. There is no automatic merge.
- Containers share the host kernel. This demo uses temporary GitHub-hosted runners; it is not a sandbox for arbitrary hostile multi-tenant workloads. Dependency installation has external network access, and no private-registry credentials are supplied.
- The skill's completed read command and hash are inspectable in the logs. The pipeline does not attest that a model followed every instruction.
- A shared Actions concurrency group serializes register writers and now queues up to 100 pending runs; overflow is cancelled. Scheduled scans recover missed notifications; GitHub and registry failures can delay updates.
- Both fix PRs have since merged, and the notifier-triggered [post-merge scan](https://github.com/vc4u2c/github-action-codex/actions/runs/40812486604) closed all six register findings. The live reset/reopen cycle remains unexercised; local lifecycle tests are separate evidence.

## Where `no-mistakes` fits

[kunchenguid/no-mistakes](https://github.com/kunchenguid/no-mistakes) provides a local Git gate with AI review, tests, documentation/lint checks, publication, PR creation, and CI monitoring. It is optional for this demo: the hub already owns proposal verification and PR publication. It could be evaluated for developers changing the hub on feature branches.

Its [Review documentation](https://kunchenguid.github.io/no-mistakes/reference/pipeline-steps/#review) requires concrete failure traces, review coverage, and fresh review after fixes, and describes AI review as probabilistic evidence. Those principles complement executable regression checks. The tool's worktree boundary is prompt guidance, so it does not replace the verifier's container isolation.

The `no-mistakes` CLI was **not installed or run** for this review. No result in this report is a `no-mistakes` certification. Adoption would be a separate change to the developer workflow, with an explicit agent/model configuration and publication policy.

## Repeat the checks

From the hub, run `npm test` for the normal suite. In PowerShell, with Docker running in Linux-container mode:

```powershell
$env:HUB_CONTAINER_TESTS = "true"
node --test test/verification-sandbox.test.mjs
Remove-Item Env:HUB_CONTAINER_TESTS
node scripts/verify-demo.mjs
```

The final command requires the sibling application repository to retain the pinned vulnerable baseline commit and access to the public npm registry. Its current checkout can be fixed; the verifier materializes the baseline in a new private folder. It works in a disposable workspace, writes `artifacts/integration-verification.json`, and leaves the sibling application checkout and GitHub PR unchanged. Use `npm.cmd` on Windows if `npm.ps1` is blocked.
