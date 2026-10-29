# Repeatable demo runbook

[Five-minute presentation card](demo-quickstart.md) | [Architecture](architecture.md) | [Setup](setup.md) | [Implementation and evidence](implementation-guide.md)

This runbook uses the same two repositories, Apps, and issue identities on every cycle. Routine hub changes go directly to main. The remediation agent always proposes application changes through a PR; review and merge passing fixes. The workflow never merges its own PRs.

## 1. Check readiness

From the hub checkout in PowerShell:

```powershell
$HubRepo = "vc4u2c/github-action-codex"
$AppRepo = "vc4u2c/vulnerable-node-demo"
npm.cmd run preflight -- --hub $HubRepo
```

Expect PASS for GitHub access, workflow availability, secret **names**, variables, manifests, and baseline history. The report is saved to `artifacts/preflight.json`. Add `--containers` if you will run the local container verifier. The checker is read-only: it does not inspect secret values, spend OpenAI credit, start a workflow, or prove API billing/model access. A successful real remediation proves those runtime connections.

Open the [dashboard](https://vc4u2c.github.io/github-action-codex/), [hub Actions](https://github.com/vc4u2c/github-action-codex/actions), and [application PRs](https://github.com/vc4u2c/vulnerable-node-demo/pulls) in separate tabs. Review any open fix/reset PR before starting another cycle.

## 2. Restore the vulnerable baseline

If the dashboard already has the expected open baseline findings and there are no outstanding fix PRs, continue to step 3. Otherwise:

```powershell
gh workflow run reset-demo.yml --repo $HubRepo --ref main -f target_id=node-demo
gh run list --repo $HubRepo --workflow reset-demo.yml --limit 3
gh pr list --repo $AppRepo
```

Open the newly created **demo: reset vulnerable application** PR. It must restore only the baseline manifests, `src/`, and `test/`; review the diff and passing application tests, then merge it. This deliberately reintroduces known vulnerable dependencies in the demonstration source. It does not deploy a service and does not call Codex.

The application's push CI then runs `notify-hub`. Wait for its central **Scan and reconcile register** run and Pages job to succeed. Repeated reset requests reuse an existing reset PR; reset blocks while a fix PR is open. If already at baseline, reset only requests a scan.

**Checkpoint:** the same issue numbers reopen. Their first-detected dates remain intact, while the new cycle has a fresh timestamp. The pinned baseline currently produces six advisories across two package groups (lodash and minimist); live registry data may change these counts.

## 3. Request one package fix

On the dashboard, choose **Request fix** beside an open package. GitHub opens **Remediate vulnerability**. Click **Run workflow**, keep `main`, enter the issue number shown below the dashboard button, and submit. Write access to the hub is required.

Equivalent PowerShell:

```powershell
$IssueNumber = Read-Host "Register issue number shown for this package"
gh workflow run remediate.yml --repo $HubRepo --ref main -f "issue_number=$IssueNumber"
```

Alternatively, open a register issue and tick **Request a Codex fix**. The listener verifies the human's write access before dispatching the workflow. The checkbox is a request control, not a completion indicator; unticking it does not cancel a run.

**Checkpoint:** **Fix progress** changes to Requested / queued, then Running. Use **Refresh status** or **View run** to follow prepare -> propose -> verify -> publish. The dashboard reads public Actions status without a browser token; it refreshes on return to the tab and periodically while visible. Private repositories or API rate limits may require viewing progress directly in Actions. Finding resolution and usage come from scan snapshots.

A fix groups advisories by repository + manifest + package. Selecting another advisory from the same group reuses the open package PR rather than spending another model call. The verifier requires all advisories selected in that package group to disappear; unrelated packages stay for a later request.

## 4. Show the skill, usage, and independent verification

In **propose -> Run Codex with the remediation skill**, find the completed `read-remediation-skill.mjs` command, exit code 0, and `SKILL_READ name=remediate-vulnerability sha256=...`. Compare the hash with prepare's `SKILL_CONFIGURED`. A skill name appearing in the prompt alone is not execution evidence.

The context artifact contains the exact skill, grouped advisories, audited commit and related issues. The proposal is an untrusted patch. The separate verifier audits the pristine patch, installs with lifecycle scripts disabled, and runs tests in restricted containers before producing its receipt. The publisher uses a separate runner and App token to create the PR.

The dashboard's **Remediation activity**, `activity.json`, and scan summary show input/cached/output tokens, duration, and run/attempt links. Counts come from completed CLI turn events for the latest attempt, not an invoice or a hard spending cap. Unavailable logs/usage do not mean zero charge; interrupted turns may have usage that is not reported. Review actual charges in the API billing console. The proposal job has a 25-minute timeout and stops before calling the model after attempt 3; a new manual dispatch starts a new attempt budget. Do not repeatedly rerun an unexplained failure.

## 5. Review and merge the package PR

Confirm the PR links every verified advisory it fixes, changes only expected dependency/source/test files, and has passing application CI. Review and merge it. To reduce manifest conflicts, finish one package's merge and rescan before requesting the next package. An already-open PR is reused.

**Checkpoint:** the application push test and `notify-hub` succeed. The central scan closes only findings absent from the new default-branch audit. A closed-but-unmerged PR or a failed scan cannot resolve a finding. The dashboard's PR count counts distinct PRs, not advisory rows.

Repeat steps 3-5 for the remaining package groups. At the clean ending, the dashboard shows zero active findings and all detected findings resolved. No fix PR should remain open.

## 6. Repeat or recover

To demonstrate again, start at step 2. The reset does not delete issues, Apps, workflow evidence, or history. The new cycle ignores old failed run status when displaying current progress.

| Situation | Recovery |
| --- | --- |
| No progress after requesting | Check the issue-numbered Actions run. Refresh the dashboard. Confirm GitHub write access and main branch. |
| Queued run | Register writers run one at a time. `queue: max` holds up to 100 pending jobs; excess requests are cancelled. Check Actions rather than repeatedly requesting. |
| Failed prepare/propose/verify/publish | The dashboard links the failed run and step. Read its error, correct the cause, then retry deliberately. Never treat a failed run as a fix. |
| Quota/model/access error | Check the API project behind `OPENAI_API_KEY`, available credit, and `CODEX_MODEL`. Preflight checks names, not key validity. |
| Codex reports a local HTTP socket error | Read the separate verifier result. The PR is published only after independent tests pass. |
| PR conflicts | Preserve both intended upgrades, run tests/audit, push the resolution to that existing PR, and wait for CI before merge. |
| Merge did not close issues | Check app `notify-hub`, then the hub scan. If necessary run `gh workflow run scan.yml --repo $HubRepo --ref main`. |
| Dashboard or usage is stale | Check the scan/Pages jobs and snapshot timestamp. Every completed remediation requests a refresh, including failures; unavailable logs are explicitly marked. |
| Live Actions data unavailable | Public API rate limits/private-repo permissions do not change register truth. Open the linked Actions run; do not paste tokens into the dashboard. |
| Reset blocked | Merge or close outstanding remediation PRs first. Reuse any existing reset PR. |

## Local rehearsal without paid model calls

```powershell
npm.cmd run demo:reset
npm.cmd run dashboard
# Open http://127.0.0.1:4173, then in another terminal:
npm.cmd run demo:fix
npm.cmd run demo:reset
```

These commands use `.work/demo-target`, restore the pinned commit, run real npm audits/tests, and persist a local register. The fix is scripted for rehearsal; it is not a Codex run. The real application checkout and GitHub remain unchanged. Network access to the public npm registry is required.

For the actual independent verifier, with Docker running Linux containers:

```powershell
npm.cmd run demo:verify
```

This materializes the pinned vulnerable commit in a new private workspace, even when the sibling application's main branch is already fixed. It verifies a minimist patch in containers and checks open -> resolved -> open. Evidence is saved to `artifacts/integration-verification.json`; the sibling checkout is left unchanged.

[Implementation evidence](implementation-guide.md#8-what-has-been-demonstrated) records the actual live cycles. A local rehearsal and a live GitHub cycle are separate evidence.
