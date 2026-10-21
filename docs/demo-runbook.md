# Repeatable demo runbook

Use the same two repositories for every demonstration. Findings keep their identities and history across resets.

## Local rehearsal (no GitHub or OpenAI credentials)

From github-action-codex:

```sh
npm run demo:reset
npm run dashboard
```

Open http://127.0.0.1:4173. In a second terminal, from the same repository:

```sh
npm run demo:fix
# Refresh the dashboard: the minimist finding becomes resolved.
npm run demo:reset
# Refresh again: the same finding is open again.
```

Repeat fix/reset as many times as needed. demo:fix is a scripted minimist update for rehearsal; the GitHub workflow below demonstrates the actual Codex agent.

The commands use .work/demo-target, an isolated copy of the pinned application baseline. They do not modify the sibling app checkout. They install with lifecycle scripts disabled, run application tests, rescan, and regenerate the dashboard. The persistent local register stays in artifacts/local-register.json, preserving finding keys and first-seen dates.

After creating this workspace, npm run demo scans it by default. To scan the sibling repository explicitly, use npm run demo -- ../vulnerable-node-demo.

## GitHub demonstration

Prerequisite: complete docs/setup.md once, including the hub App, OpenAI key, and optional notifier.

1. Run **Scan and reconcile register** in the hub. Show the dashboard and the central minimist issue.
2. Run **Remediate vulnerability** with that issue number. Show the separate prepare, propose, verify, and publish jobs.
3. Open the resulting PR in the target repository. Show the dependency diff, tests, and link back to the central finding.
4. Review and merge. The notifier requests a scan; the finding closes only after verification. Without the notifier, run the central scan manually.
5. Before the next demonstration, run **Reset demo** in the hub with target_id=node-demo.
6. Review and merge its reset PR. It restores the vulnerable application and leaves workflows and documentation intact.
7. The next central scan reopens the same finding issue. Return to step 2.

Reset requires no OpenAI call. Repeated requests reuse an open reset PR. If the app already matches its baseline, reset makes no changes and requests a scan. Merge or close open remediation PRs before resetting, to avoid overlapping demonstrations.

## What resets

The baseline is pinned by commit SHA in the demo target's configuration. Reset restores package.json, package-lock.json, src/, and test/. It removes source/test files added since the baseline. It preserves workflows, documentation, all Git history, central register issues, and PR history.

Only targets with an explicit demo.baselineCommit can be reset. Ordinary scan targets are not resettable.

Dependency versions and application files return to the same baseline each time. Advisory counts and severity still follow the live npm advisory database; they are not fixed demo data. The pinned baseline commit must remain in the target repository's history.

If you intentionally replace the demo application, choose a new known vulnerable baseline commit and update config/targets.json. The local workspace marker prevents silently mixing baselines; use a separately named rehearsal workspace or archive the old .work/demo-target before initializing the new baseline.
