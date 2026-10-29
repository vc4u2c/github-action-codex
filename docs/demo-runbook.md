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

## Show the skill in the run logs

Open **Remediate vulnerability > the run > propose > Run Codex with the remediation skill**. Codex emits JSON events containing its commands and their output. Find the completed `read-remediation-skill.mjs` command and its `SKILL_READ name=remediate-vulnerability sha256=...` output, then inspect the dependency update and test commands that follow it. The prompt requires this read before edits; check the actual command event rather than treating a mention of the skill as proof of execution.

The prepare job logs `SKILL_CONFIGURED` and adds a run summary with an immutable link to the skill and its SHA-256. Its **remediation-context** artifact includes `SKILL.md`, `skill.json`, `prompt.md`, and `context.json`. The exact skill text is also included in the prompt sent to Codex. The **codex-report** artifact preserves Codex's final response, including the skill version and its account of the changes and tests. If Codex fails before a final response, inspect the Action logs; there may be no report artifact.

These records show the instructions supplied and observable tool activity. A claimed skill name alone does not prove compliance with every instruction. The separate verify job still determines whether the patch passes tests and removes the advisory.

## Runner compatibility

The four remediation jobs explicitly use `ubuntu-24.04`. During the `ubuntu-latest` migration, [run 40802770824](https://github.com/vc4u2c/github-action-codex/actions/runs/40802770824) received Ubuntu 26.04 and the pinned Codex Action stopped before making a model request: `Could not restrict access to /run/dbus/system_bus_socket`. Pinning the OS preserves the existing `drop-sudo` protection. Revalidate that protection before changing the runner OS or Action version. The OS label still receives GitHub image updates; it does not pin an immutable VM image.

## Verified live example

On October 28, 2026 (America/Chicago), [run 40803030409](https://github.com/vc4u2c/github-action-codex/actions/runs/40803030409) completed all four jobs using `gpt-6-luna` and created [application PR #1](https://github.com/vc4u2c/vulnerable-node-demo/pull/1). It updates minimist 1.2.5 to 1.2.8 in the two manifests; source and tests are unchanged.

- [Codex job logs](https://github.com/vc4u2c/github-action-codex/actions/runs/40803030409/job/123215431165): the completed `read-remediation-skill.mjs` command returned exit code 0 and `SKILL_READ` with the configured skill hash.
- [Independent verifier](https://github.com/vc4u2c/github-action-codex/actions/runs/40803030409/job/123215869300): both application tests passed, the selected advisory was absent, and no new advisory identities appeared. Five existing lodash advisories remain.
- [Application PR CI](https://github.com/vc4u2c/vulnerable-node-demo/actions/runs/40803240449): passed.
- [Register issue #6](https://github.com/vc4u2c/github-action-codex/issues/6) and the published dashboard: `pr-open`, linked to PR #1. Merge and rescan remain the next demonstration steps.

The Codex report records two HTTP-test socket failures inside the propose environment. The separate verifier and application CI passed those unchanged tests. The run artifacts preserve the report, proposal, skill/context, and verification receipt so this distinction is reviewable.
