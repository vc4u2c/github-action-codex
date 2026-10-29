# Setup guide

[Architecture](architecture.md) | [Implementation guide](implementation-guide.md) | [Demo runbook](demo-runbook.md)

These steps reproduce the two-repository installation. The existing `vc4u2c` demo is already configured; use the [runbook](demo-runbook.md) to operate it. Its fix PR can remain open while you demonstrate the workflow and review evidence.

## What you will configure

| Item | Location |
| --- | --- |
| Hub repository | Scanner, register, dashboard, and remediation workflow |
| Application repository | Node.js app, tests, and fix PRs |
| Remediation GitHub App | Installed on the application; key stored in the hub |
| Notifier GitHub App | Installed on the hub; key stored in the application |
| OpenAI API key | Hub Actions secret |
| GitHub Pages | Hub dashboard, optional |

The dashboard's **Request fix** button opens the remediation workflow on GitHub. Click **Run workflow**, enter the register issue number shown below the button, and click **Run workflow** again. The requester needs write, maintain, or admin access to the hub. Ticking **Request a Codex fix** on the register issue remains an alternative. This uses the existing workflow token and requires no additional App, secret, or website login integration. See the [register request steps](demo-runbook.md#request-a-fix-from-the-register).

## 1. Prepare a new workspace

You need Git, Node.js 22 or newer, the GitHub CLI (`gh`), and permission to create repositories and install GitHub Apps under the chosen account. Remediation also needs an OpenAI API project key with available API quota. Scanning and reset do not call OpenAI. GitHub-hosted remediation runners use Docker to isolate application verification. A local Docker engine with Linux containers is needed only if you run `verify-demo.mjs` or the container regression checks locally.

The commands below use **PowerShell**. Keep the same terminal open so the variables remain available. Replace `YOUR_GITHUB_USER_OR_ORG` with the owner of your new repositories. This example keeps the two repository names shown below; choose an account where those names are available.

```powershell
$DemoOwner = "YOUR_GITHUB_USER_OR_ORG"
$HubRepo = "$DemoOwner/github-action-codex"
$AppRepo = "$DemoOwner/vulnerable-node-demo"
gh auth login -h github.com

New-Item -ItemType Directory -Path vulnerability-hub-demo
Set-Location vulnerability-hub-demo
git clone https://github.com/vc4u2c/github-action-codex.git
git clone https://github.com/vc4u2c/vulnerable-node-demo.git
```

**Checkpoint:** the two repositories are sibling folders. Cloning retains the target's baseline commit and history, which the reset feature needs.

## 2. Publish your copies and configure the target

Run this only in the new clones from step 1. The commands point their `origin` remotes at your new repositories. They create public repositories, so the source, register issues, and dashboard data are public. For private installations, use `--private` and review Pages availability/access for your account.

```powershell
Set-Location vulnerable-node-demo
git remote remove origin
gh repo create $AppRepo --public --source=. --remote=origin --push

Set-Location ../github-action-codex
npm.cmd run configure -- $DemoOwner
git add config/targets.json
git commit -m "Configure application target"
git remote remove origin
gh repo create $HubRepo --public --source=. --remote=origin --push
```

The configure command only changes `config/targets.json`. If you use different repository names, edit that file directly. Both repositories should have **main** as their default branch, Actions enabled, and the hub should have Issues enabled. Organization policy must permit the actions and workflow permissions used here.

**Checkpoint:** `config/targets.json` points to your application repo, both repos exist on GitHub, and **Hub CI** passes. The hub has no npm runtime dependencies to install.

## 3. Create the Remediation App

In the chosen account's **Settings > Developer settings > GitHub Apps**, choose **New GitHub App**. Use a unique name such as `YOUR-OWNER-vulnerability-remediator` and the hub repository URL as its homepage.

This App is used for installation authentication. Leave OAuth/user authorization and callback URLs unused, and turn off **Webhook > Active**. For a single-owner installation, choose **Only on this account**. Select these repository permissions:

| Permission | Access |
| --- | --- |
| Contents | Read and write |
| Pull requests | Read and write |
| Metadata | Read, automatic |

Create the App. Record its numeric **App ID**, generate a private key, then choose **Install App > Only select repositories > vulnerable-node-demo**.

Store these in the **hub repository**, under **Settings > Secrets and variables > Actions**:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `HUB_APP_ID` | This Remediation App's ID |
| Secret | `HUB_APP_PRIVATE_KEY` | Its complete downloaded PEM private key |

You can use the UI, or these commands from the hub folder. Replace the PEM path with the downloaded file's location; keep the key outside the repository.

```powershell
gh variable set HUB_APP_ID --repo $HubRepo --body (Read-Host "Remediation App ID")
Get-Content -LiteralPath "C:/secure/remediation-app.private-key.pem" -Raw | gh secret set HUB_APP_PRIVATE_KEY --repo $HubRepo
```

**Checkpoint:** the App installation lists the application repository, while its ID/key are configured in the hub. Scan/prepare request read-only tokens; publish/reset request write tokens.

See GitHub's [App registration guide](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app) for the account settings UI.

## 4. Create the Notifier App

Create a second App named, for example, `YOUR-OWNER-vulnerability-notifier`. Use the same homepage and no webhook/OAuth flow. Grant these repository permissions:

| Permission | Access |
| --- | --- |
| Actions | Read and write |
| Contents | Read |
| Metadata | Read, automatic |

Generate its private key and install this App on **github-action-codex only**. Store the following in the **application repository**:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `HUB_REPOSITORY` | `YOUR_OWNER/github-action-codex` |
| Variable | `NOTIFIER_APP_ID` | This Notifier App's ID |
| Secret | `NOTIFIER_APP_PRIVATE_KEY` | Its complete PEM private key |

```powershell
gh variable set HUB_REPOSITORY --repo $AppRepo --body $HubRepo
gh variable set NOTIFIER_APP_ID --repo $AppRepo --body (Read-Host "Notifier App ID")
Get-Content -LiteralPath "C:/secure/notifier-app.private-key.pem" -Raw | gh secret set NOTIFIER_APP_PRIVATE_KEY --repo $AppRepo
```

**Checkpoint:** the Notifier App installation lists the hub, while its credentials are stored in the application. The application workflow uses this App to request a hub scan after a default-branch push.

This App is optional if manual/scheduled rescans are acceptable. Include it to demonstrate automatic verification after merge. GitHub creates each workflow's built-in `GITHUB_TOKEN`; you do not add it as a secret.

## 5. Configure the Codex model and API key

Create an [OpenAI API key](https://platform.openai.com/api-keys) in an organization with available [API billing/quota](https://platform.openai.com/settings/organization/billing/overview). Store it in the hub and select the model:

```powershell
gh secret set OPENAI_API_KEY --repo $HubRepo
gh variable set CODEX_MODEL --repo $HubRepo --body gpt-6-luna
```

Paste the key at the hidden `gh secret set` prompt. The model must be available to that key; `gpt-6-luna` is the model used in the verified example. See the [official OpenAI documentation](https://learn.chatgpt.com/docs/github-action) for the Codex Action's API-key setup.

**Checkpoint:** the hub has these settings. Listing secrets shows names, not values:

```powershell
gh secret list --repo $HubRepo
gh variable list --repo $HubRepo
```

Expected hub secrets: `HUB_APP_PRIVATE_KEY`, `OPENAI_API_KEY`. Expected hub variables: `HUB_APP_ID`, `CODEX_MODEL`.

## 6. Enable the dashboard

In the hub, open **Settings > Pages > Build and deployment**, then select **GitHub Actions** as the source. Set:

```powershell
gh variable set PUBLISH_DASHBOARD --repo $HubRepo --body true
```

The existing scan workflow handles deployment with `pages: write` and `id-token: write`. The expected project-site URL is `https://YOUR_OWNER.github.io/github-action-codex/` unless you configure a custom domain.

If you do not want hosting, leave `PUBLISH_DASHBOARD` unset. The scan still produces an Actions summary and downloadable dashboard artifact. A private source repository does not by itself guarantee a private Pages site.

**Checkpoint:** Pages is configured to use Actions. The first scan in the next step creates the site.

## 7. Run the first scan

From the configured hub checkout, run `npm.cmd run preflight -- --hub $HubRepo`. This read-only check validates repository access, workflow/configuration availability, secret names and baseline history; it does not inspect key values or call the model.

```powershell
gh workflow run scan.yml --repo $HubRepo --ref main
gh run list --repo $HubRepo --workflow scan.yml --limit 5
gh issue list --repo $HubRepo --label vulnerability-register
```

Wait for **Scan and reconcile register** to finish in the hub's Actions tab. Expect central issues, a run summary, the **vulnerability-dashboard** artifact, and a Pages deployment if enabled. Each issue should show package, severity, repository, dates, and `open` status.

**Checkpoint:** rerunning the scan updates the existing issues. Advisory counts follow the live npm database; they are not fixed demo data. If your cloned application's main branch already contains a fix, use the [reset workflow](demo-runbook.md#reset-for-the-next-demo) to restore its vulnerable baseline first.

## 8. Create a fix PR

Choose a central finding with an available fix, then enter its issue number:

```powershell
$IssueNumber = Read-Host "Central vulnerability issue number"
gh workflow run remediate.yml --repo $HubRepo --ref main -f "issue_number=$IssueNumber"
```

Follow **prepare > propose > verify > publish** in the hub. The propose job calls the OpenAI API. Inspect its completed `SKILL_READ` command, the verifier result, and the PR created in the application repository.

**Checkpoint:** the PR changes the dependency files, application CI passes, and the central issue/dashboard show `pr-open` with a PR link. An existing open remediation PR is reused; selecting the same finding again does not create another fix. You can leave this PR open for the demo.

## 9. Merge and verify closure when ready

Review the PR diff and passing application CI. When ready to demonstrate closure, merge it in the application repository. The default-branch push runs application CI and its separate `notify-hub` job, which requests the central scan.

**Checkpoint:** after a successful scan confirms the advisory is absent, the issue is closed with status `resolved` and the dashboard reflects it. If no notifier is configured, run `scan.yml` manually. If the scan fails or the advisory remains, the finding stays open.

Use the [demo runbook](demo-runbook.md) to restore the vulnerable baseline and repeat the cycle without recreating repositories or Apps.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| App-token creation fails | Correct App ID and matching PEM, correct installation repository, and repository permissions |
| Scan cannot read manifests | Both npm files are committed on main; directory is correct; lockfile version is 2 or 3 |
| API quota error | API organization/project behind the saved key has available quota; buying credits under another organization will not fund this key |
| Model unavailable | `CODEX_MODEL` is available to the saved API key |
| Codex fails on `/run/dbus/system_bus_socket` | Keep the remediation runner pin at `ubuntu-24.04`; see [runner details](implementation-guide.md#5-the-codex-harness-and-remediation-skill) |
| Codex reports HTTP-test socket errors | Read its report and the separate verifier result; a PR is published only if independent verification passes |
| Verify rejects the patch | Inspect its log for unsupported paths, package changes, test failures, or remaining/new advisories |
| Issue does not close after merge | Check application `notify-hub`, then the hub scan; the scan must confirm the advisory is absent |
| Dashboard is stale | Check the scan and Pages jobs plus the snapshot timestamp |
| Local GitHub CLI login expired | Run `gh auth login -h github.com`; this is separate from App credentials in Actions |
