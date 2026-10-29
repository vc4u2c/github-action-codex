# Demo runbook

[Architecture](architecture.md) | [Setup](setup.md) | [Implementation and evidence](implementation-guide.md)

Use the same repositories and register for every demonstration. Setup is already complete for the `vc4u2c` demo.

## Start with the current open PR

[Application PR #1](https://github.com/vc4u2c/vulnerable-node-demo/pull/1) is intentionally being kept open for the demo. It contains the Luna-generated minimist fix, passing checks, and links to the run. [Issue #6](https://github.com/vc4u2c/github-action-codex/issues/6) and the [dashboard](https://vc4u2c.github.io/github-action-codex/) show `pr-open`.

You can demonstrate the register, skill logs, verification, and PR review without merging. Re-running remediation for this finding reuses the existing PR and skips another Codex proposal. To show the agent working, open the [completed run](https://github.com/vc4u2c/github-action-codex/actions/runs/40803030409).

## Present the GitHub workflow

| Step | Action | What to show |
| --- | --- | --- |
| 1. Scan | In the hub's Actions tab, run **Scan and reconcile register** on main | Repository, severity, dates, status, and issue links in the dashboard |
| 2. Remediate | For a finding without an open fix PR, run **Remediate vulnerability** with its central issue number | The separate prepare, propose, verify, and publish jobs |
| 3. Show evidence | Open the propose and verify logs | Actual skill read, dependency edits, independent tests and audit |
| 4. Review PR | Open the application PR and its checks | The dependency diff and link back to the central register |
| 5. Merge when ready | Review and merge the PR | Default-branch CI and the separate `notify-hub` job |
| 6. Verify closure | Wait for the hub's requested scan and Pages deployment | Issue closes only after the advisory is confirmed absent; dashboard shows resolved |

**Stop after step 4 to preserve the open PR for presentation.** Scanning while the PR remains open does not merge it or mark its finding resolved.

If notification is unavailable, run **Scan and reconcile register** manually after merge. Other existing advisories can remain open; the demo fix targets one selected finding.

## Show the skill in the run logs

Open **Remediate vulnerability > the run > propose > Run Codex with the remediation skill**. Find the completed `read-remediation-skill.mjs` command, exit code 0, and its `SKILL_READ name=remediate-vulnerability sha256=...` output. Compare the hash with prepare's `SKILL_CONFIGURED` output.

The run artifacts preserve the exact instructions, context, Codex report, patch, and verification receipt. A skill name in a prompt alone is not proof that it ran. See the [evidence map](implementation-guide.md#how-to-verify-skill-use).

## Reset for the next demo

Complete or close open remediation PRs before resetting. Leave PR #1 open until you are ready to finish the current presentation.

1. In the hub, run **Reset demo** on main with `target_id=node-demo`.
2. Review the reset PR in the application repository and merge it.
3. Wait for the notifier and hub scan. The same finding issue reopens.
4. Run remediation again to demonstrate a new Codex-generated fix.

Reset restores the pinned baseline's manifests, `src/`, and `test/`, preserving workflows, documentation, Git history, and register history. It makes no OpenAI call and reuses an already open reset PR. Only targets with an explicit `demo.baselineCommit` can be reset.

## Local rehearsal without GitHub or OpenAI credentials

With both repositories cloned as siblings, run these commands from the hub:

```sh
npm run demo:reset
npm run dashboard
```

Open **http://127.0.0.1:4173**. In a second terminal, also in the hub:

```sh
npm run demo:fix
# Refresh: the minimist finding is resolved.
npm run demo:reset
# Refresh: the same finding is open again.
```

On Windows PowerShell, use `npm.cmd` if needed. The commands use `.work/demo-target`, an isolated copy of the baseline. They install dependencies with lifecycle scripts disabled, run tests and a real npm audit, and preserve local register history in `artifacts/local-register.json`. The sibling application checkout and GitHub PR remain unchanged.

`demo:fix` performs a scripted upgrade for rehearsal. The GitHub remediation workflow demonstrates the actual Codex agent. Advisory counts and severity come from the live npm database and may change.

To scan the sibling checkout explicitly, use `npm run demo -- ../vulnerable-node-demo`. For additional local verification of the patch gate, run `node scripts/verify-demo.mjs`; evidence is written to `artifacts/integration-verification.json`.

## Runner compatibility

Keep the remediation runner and Action versions documented in the [implementation guide](implementation-guide.md#5-the-codex-harness-and-remediation-skill). Validate changes before a presentation.

## Verified live example

The [implementation guide](implementation-guide.md#8-what-has-been-demonstrated) links the successful run, actual skill execution, independent test results, application CI, and current PR/register state.
