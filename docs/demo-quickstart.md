# Five-minute demo card

[Full runbook](demo-runbook.md) | [Dashboard](https://vc4u2c.github.io/github-action-codex/) | [Setup](setup.md)

Prepare before presenting: run `npm run preflight`, then reset and scan using the full runbook. Reset intentionally restores vulnerable dependencies; it does not deploy the app. A fresh Codex run consumes API credit and can take several minutes, so keep a completed run available for a timed presentation.

| Minute | Show | Say |
| --- | --- | --- |
| 0-1 | Architecture and the two repositories | The hub owns detection, the register, and the harness. The child owns the application and fix PRs. |
| 1-2 | Dashboard after reset | npm audit created stable findings with severity and repository. Repeat scans update the same issues. |
| 2-3 | Request fix -> GitHub Run workflow | Enter the displayed issue number. One request fixes all advisories for that package. Show Requested, Running, and the run link. |
| 3-4 | Completed Codex and verifier jobs, then the PR | Find the completed SKILL_READ command. Codex proposes; separate jobs audit, test in containers, and publish the verified diff. |
| 4-5 | Merge, notifier, then resolved register | Merge alone does not close findings. A fresh main-branch scan confirms the fix and closes the same issues. |

If generation is still running, show a previously completed run and return to the live result later. Failure is visible in Fix progress with a run/failed-step link. Usage is listed per run/attempt; it is operational telemetry, not an invoice.

For the clean ending, remediate and merge one package at a time until no active findings remain. To present again, use **Reset demo**, merge its PR, and wait for the automatic scan. Do not create new repositories, Apps, or register issues.
