# Dashboard sign-in and validation

[Runbook](demo-runbook.md) | [Architecture](architecture.md) | [Setup](setup.md)

The dashboard supports two modes. The existing GitHub Pages demo is public and opens GitHub's workflow form. The protected Node server requires GitHub sign-in and submits the selected finding directly to the workflow. Installing the code alone does not protect the existing Pages URL.

## What the validation column means

Each finding shows two separate results:

| Result | Evidence |
| --- | --- |
| **Proposal: Passed** | The independent verifier accepted the patch, installed dependencies with scripts disabled, ran passing tests, and confirmed the selected package advisories were removed without new advisory identities. A published receipt binds this evidence to the patch digest and PR commit. Expand **Evidence** for the checks, commit, time and workflow link. |
| **Proposal: Not run this cycle** | No current-cycle verification evidence exists. A reset never inherits a previous cycle's passing result. |
| **Proposal: Needs revalidation** | The PR commit changed, or its current head could not be confirmed. Earlier evidence does not cover the current commit. |
| **Main branch: Advisory present** | The latest successful scan still found the advisory on main. A validated PR alone does not resolve it. |
| **Main branch: Advisory absent** | A successful scan of the displayed main commit found the advisory absent. |
| **Main branch: Scan failed** | The current scan did not establish the state. Previous register history is retained. |

The activity table also links each run's **Verifier job**. A successful run that reused a PR shows **Not run** when its verifier was skipped. Runs created before receipt linking was added show **Job passed**, with a link to the verifier and an explanation that no receipt links it to the current PR commit. New runs show the same limited result until the receipt is published. The dashboard does not infer validation from an overall green workflow result, a model report, or the existence of a PR.

## Set up protected mode locally on Windows

From the hub checkout, with `gh` signed in as the repository owner:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run dashboard:setup
```

Open the one-time local setup URL printed by the helper:

1. Click **Create Dashboard App** and confirm the registration on GitHub.
2. Click **Install the Dashboard App**. Choose **Only select repositories**, select `github-action-codex`, and install.
3. Return to the setup page. If needed, click **Verify installation and start dashboard**.
4. Open **http://127.0.0.1:4180** and click **Sign in with GitHub**. Authorize the App as `vc4u2c`.

This is a third, separate GitHub App. The existing Remediation and Notifier Apps retain their jobs. The Dashboard App is installed only on the hub, with **Contents read**, **Issues read**, **Actions write**, and the implicit **Metadata read** permission. It has no application repository write permission and no OpenAI credential. Its callback is `http://127.0.0.1:4180/auth/callback`.

The helper encrypts the OAuth client configuration using Windows DPAPI in ignored `.work/dashboard-credentials.dpapi`. Only that Windows account on that machine can decrypt it. The helper never prints credentials. The generated App private key is used only in memory to verify the installation; it is not needed by the dashboard at runtime. Setup and sign-in do not call OpenAI.

On subsequent demos:

```powershell
npm.cmd run dashboard:secure
```

If the dashboard is already running on port 4180, use that instance. The local server listens only on loopback. Restarting it signs users out; sign in again. The setup helper expires after one hour. Do not create another App if an existing one is already configured.

## How the direct button selects the vulnerability

In protected mode, **Request fix** sends `{ issueNumber, key }` for that row to the server. No manual issue-number entry is needed. The server:

1. Validates the session, allowed GitHub account, request origin and CSRF token.
2. Checks the user's current write/admin permission in the hub.
3. Reads the live issue and verifies its identity against `config/targets.json`.
4. Reuses an existing request or PR when applicable.
5. Dispatches `remediate.yml` on the hub's default branch with `inputs.issue_number`.

The workflow then independently reads that issue and performs its existing preparation, Codex proposal, verification and publication. The server never generates dependency fixes, edits the register or merges PRs. Requests are made with the signed-in user's GitHub App user token; tokens stay on the server, not in browser storage.

The protected server reads the latest completed scan's `vulnerability-dashboard` Actions artifact. It downloads only the bounded `site/register.json` entry in memory, validates the hub identity, and does not execute artifact files. It does not depend on a public Pages URL. Missing or expired artifacts produce an error; request a fresh scan. It does not fall back silently to an older clean scan after a newer failure.

## Hosting and access boundaries

The authenticated server protects HTML, JavaScript, JSON exports and API routes. Sessions use opaque HttpOnly, SameSite cookies, with Secure cookies on HTTPS hosts. OAuth uses browser-bound state and PKCE. The default viewing allowlist is the hub owner's GitHub login; additional logins must be explicitly configured. Write access is checked again for each fix request.

**The demo repositories and their issues remain public.** Protecting this dashboard does not make data already published in GitHub Issues, artifacts or the existing Pages site confidential. A confidential installation needs a private hub and deliberate removal of public copies. Repository visibility is a separate choice; the setup helper does not change it.

GitHub Pages access control is limited to eligible organization project sites on GitHub Enterprise Cloud; the current personal-account Pages site cannot be made private by adding a login form. See [GitHub Pages visibility](https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site).

After the protected URL and real sign-in have been verified, retire the old public Pages deployment if desired:

```powershell
gh variable set PUBLISH_DASHBOARD --repo vc4u2c/github-action-codex --body false
gh api --method DELETE repos/vc4u2c/github-action-codex/pages
```

This stops public dashboard publication and unpublishes the old site. Scans, register updates and dashboard artifacts continue. Update shared dashboard links to the protected URL. Do not treat disabling publication alone as removing a previously published site.

## Manual configuration or another host

Register a GitHub App with the permissions above, disabled webhooks, and the callback `<origin>/auth/callback`. Install it only on the hub. Supply these variables through the host's secret/configuration manager:

| Variable | Meaning |
| --- | --- |
| `DASHBOARD_CLIENT_ID` | The App's OAuth client ID, not its numeric App ID |
| `DASHBOARD_CLIENT_SECRET` | The App's OAuth client secret; keep it server-side |
| `DASHBOARD_HUB` | `OWNER/HUB` |
| `DASHBOARD_ORIGIN` | Exact HTTPS origin; local demo permits only `http://127.0.0.1:PORT` |
| `DASHBOARD_ALLOWED_USERS` | Comma-separated GitHub logins allowed to view the dashboard |
| `DASHBOARD_BIND` | Defaults to `127.0.0.1`; use the host's required bind address behind HTTPS |
| `PORT` | The host's assigned listening port; local demo defaults to 4180 |

Run `npm ci --ignore-scripts`, then `npm run dashboard:secure`. The reverse proxy must preserve the configured Host header and provide HTTPS. The server does not trust forwarded identity headers. Never place client secrets or tokens in frontend files.

Sessions and short duplicate-request locks are in memory and expire on restart. This implementation supports a single server instance. Multiple instances require shared session/request storage or equivalent coordination; GitHub remains the durable workflow queue. See [GitHub's login flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app) for the authentication protocol.

## Verification performed

Automated HTTP and browser checks exercise anonymous access denial, protected JSON, OAuth state and PKCE, account allowlisting, session expiration, CSRF, live write-permission checks, tampered finding identity, duplicate clicks, exact issue-number dispatch, sign-out, and mobile layout. These checks use a mocked OAuth provider/dispatch and do not spend model credit. The artifact reader was also checked against the real GitHub scan artifact. Real browser sign-in requires creating/installing the Dashboard App and authorizing it; it is a separate setup checkpoint.
