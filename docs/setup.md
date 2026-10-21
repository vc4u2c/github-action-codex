# Set up the two-repository demo

## 1. Publish the repositories

The intended repositories are **vc4u2c/github-action-codex** and **vc4u2c/vulnerable-node-demo**, with **main** as the default branch. Both are independent repositories.

If publishing yourself, authenticate the GitHub CLI, then run the following from each corresponding folder after committing its files:

```sh
gh auth login -h github.com
# From github-action-codex:
gh repo create vc4u2c/github-action-codex --private --source=. --remote=origin --push
# From vulnerable-node-demo:
gh repo create vc4u2c/vulnerable-node-demo --private --source=. --remote=origin --push
```

These commands create private repositories. If you choose public repositories, all checked-in files and vulnerability issues will be publicly readable. Keep the demo app local; publishing its source does not require hosting the vulnerable application.

Enable Issues in the hub and GitHub Actions in both repositories. Keep the hub workflow and configuration changes limited to trusted maintainers.

Public targets can be scanned immediately without a GitHub App: the scanner uses read-only anonymous GitHub requests when HUB_APP_ID is unset. The hub's built-in workflow token maintains its register. Configure the App for private targets, higher API limits, remediation PRs, and reset PRs.

## 2. Create the hub GitHub App

Under your GitHub account's Developer settings, create a GitHub App. Set a homepage URL to the hub repository; a webhook is unnecessary for this demo.

Grant repository permissions:

| Permission | Access |
| --- | --- |
| Contents | Read and write |
| Pull requests | Read and write |
| Metadata | Read (automatic) |

Install it on the target repository only (and on any additional configured targets). Generate a private key. This key belongs only in the central hub's Actions secrets.

In **github-action-codex → Settings → Secrets and variables → Actions**, add:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | HUB_APP_ID | GitHub App ID |
| Secret | HUB_APP_PRIVATE_KEY | Complete PEM private key |
| Secret | OPENAI_API_KEY | OpenAI API project key with model access |
| Variable, optional | CODEX_MODEL | An available Codex-compatible model; omitted uses the action default |
| Variable, optional | PUBLISH_DASHBOARD | true only after Pages setup below |

The workflow requests read-only installation tokens for scans and target export, and write tokens only for publication. Central register writes use the hub's own GITHUB_TOKEN.

OpenAI API usage is billed separately from the local demo. Configure the key in GitHub Secrets; do not put it in source or issue bodies.

## 3. Configure immediate verification after merge

Create a **second, narrowly scoped notifier GitHub App**. This keeps the hub's target-write credential out of the application repository.

| Permission | Access |
| --- | --- |
| Actions | Read and write |
| Contents | Read |
| Metadata | Read (automatic) |

Install this notifier on the hub repository only. Disable its webhook; notifications are sent by the target workflow.

In **vulnerable-node-demo → Settings → Secrets and variables → Actions**, add:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | HUB_REPOSITORY | vc4u2c/github-action-codex |
| Variable | NOTIFIER_APP_ID | Notifier GitHub App ID |
| Secret | NOTIFIER_APP_PRIVATE_KEY | Notifier PEM private key |

The target workflow runs a separate notification job with no source checkout, after a push to main. It dispatches the central scan even if app tests failed: scan evidence still matters. PR events do not get notifier credentials.

The notifier is optional for initial setup; scheduled and manual scans still verify merged fixes. Without it, resolution occurs on the next scan rather than immediately after merge.

## 4. Configure the target

config/targets.json is already set to vc4u2c/vulnerable-node-demo. For another owner run:

```sh
npm run configure -- YOUR_OWNER
```

Each entry contains id, repository, directory, and ecosystem. directory identifies the folder holding both package.json and package-lock.json. Install the hub App on every listed target. Multiple owners need separate App installation jobs; this demo deliberately rejects that configuration.

## 5. Run the first scan

In the hub's Actions tab, run **Scan and reconcile register** on main.

Expected results:

- One central issue per package/advisory/manifest identity, labeled vulnerability-register.
- A readable Actions summary and a vulnerability-dashboard artifact containing site/ and raw scan evidence.
- Repeating the scan updates existing issues.
- A scan failure is visible and preserves existing findings.

The dependencies are deliberately old. On October 21, 2026 the demo produced six advisories, including a critical minimist advisory. Counts and severity may change with the advisory database.

## 6. Open and merge a remediation PR

Choose a central issue, such as the minimist finding. Run **Remediate vulnerability**, supplying the central issue number.

The workflow rescans the target, invokes the remediation skill through Codex, validates the resulting patch on a separate runner, and opens a PR in the target repository. Its link appears in the central issue. A subsequent scan refreshes the dashboard.

Review the PR and its **Application CI / test** result. Configure branch protection to require that check and a review if desired. The automation never merges PRs.

After merge, the notifier dispatches a scan of the target default branch. The register entry closes only if the advisory is absent. Other findings remain open. Reverting the dependency update reopens the existing entry on the next scan.

An already open remediation PR is reused; a closed unmerged PR allows a new attempt. A failed or empty Codex proposal creates no PR and leaves the finding open; details remain in the workflow run.

## Repeat without recreating repositories

Run **Reset demo** in the hub with target_id=node-demo after completing a remediation demonstration. Review and merge the reset PR; the central scanner will reopen the same finding issues. Reset preserves the GitHub configuration, issue history, and application workflows. See [the repeatable demo runbook](demo-runbook.md) for both local rehearsal and the GitHub presentation sequence.

## 7. Optional hosted dashboard

The Actions artifact and job summary work without hosting. To publish a browser dashboard:

1. In the hub's Pages settings, select **GitHub Actions** as the build source.
2. Confirm that Pages is available for your repository/account and that the resulting site's access rules fit your data.
3. Set the hub Actions variable **PUBLISH_DASHBOARD=true**.
4. Run the scan workflow. The pages job publishes the site and provides its URL.

Do not assume a private repository makes its Pages site private. The generated dashboard includes repository names, advisories, and issue links. The default is artifact-only until you enable publication.

To view a downloaded artifact locally, enter its site folder and run a static HTTP server, for example python -m http.server 4173 --bind 127.0.0.1.

## Troubleshooting

- **App token creation fails:** verify App ID, PEM key, installation owner, selected repositories, and requested permissions.
- **Scan cannot read a lockfile:** commit both manifests to the target's default branch; use lockfile version 2 or 3.
- **Registry failure:** findings remain open. Rerun the scan after connectivity recovers.
- **Codex fails:** verify OPENAI_API_KEY and optional CODEX_MODEL; read the propose job. Named permission profiles require a compatible Codex CLI.
- **Patch rejected:** read verify logs. The demo supports only the documented file types and dependency-field changes. Expand the contract intentionally for a different application.
- **No immediate close after merge:** check HUB_REPOSITORY and notifier credentials; run the central scanner manually.
- **Dashboard stale:** the dashboard is a snapshot of the last exported scan, with a visible timestamp. Rerun the scan.
- **GitHub CLI login expired:** run gh auth login -h github.com. This is unrelated to the repository GitHub App credentials.

The action references and Codex CLI are pinned by the supplied version-lock utility during initial setup. Review upgrades deliberately because permission-profile support is evolving.
