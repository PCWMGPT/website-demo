# Contact API (`/api`)

Azure Functions (Node.js, JavaScript) app that powers the website contact form.
One endpoint: **`POST /api/contact`**. It validates the submission, applies
spam protection, and emails the team via **Microsoft Graph `sendMail`** using
client-credentials auth. No SMTP, no third-party form service.

## Files
- `contact/function.json` — HTTP trigger (anonymous, POST, route `contact`).
- `contact/index.js` — validation, honeypot + timing + rate-limit guards, Graph send.
- `host.json`, `package.json` — Functions host + the single dependency (`@azure/identity`).

## Environment variables (never commit these)
| Name | Example |
|------|---------|
| `GRAPH_TENANT_ID` | your Entra tenant (directory) ID |
| `GRAPH_CLIENT_ID` | the registered app's client ID |
| `GRAPH_CLIENT_SECRET` | the app's client secret **value** |
| `MAIL_SENDER` | `team@pointercreek.com` |
| `MAIL_TO` | `team@pointercreek.com,clientservices@pointercreek.com` |

In production these live in **Azure Portal → Static Web App → Environment variables**
(see `SETUP_CONTACT_FORM.md`). Locally they live in `api/local.settings.json`,
which is git-ignored.

## Testing locally with the SWA CLI

```bash
# one-time installs
npm i -g @azure/static-web-apps-cli
npm i -g azure-functions-core-tools@4 --unsafe-perm true   # provides `func`
cd api && npm install && cd ..

# create api/local.settings.json (git-ignored) — see template below, fill in real values

# from the repo root:
#   website-demo repo →  swa start . --api-location api
#   pcwm-gpt repo     →  swa start website --api-location api
swa start . --api-location api
```

Then open the printed URL (usually `http://localhost:4280`), go to the Contact
page, and submit the form. The SWA CLI proxies `/api/contact` to the local
Functions host.

### `api/local.settings.json` template (do NOT commit)
```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "GRAPH_TENANT_ID": "<tenant-id>",
    "GRAPH_CLIENT_ID": "<client-id>",
    "GRAPH_CLIENT_SECRET": "<client-secret-value>",
    "MAIL_SENDER": "team@pointercreek.com",
    "MAIL_TO": "team@pointercreek.com,clientservices@pointercreek.com"
  }
}
```

Quick curl check (bypasses the front end; note the 3s timing guard needs `elapsedMs >= 3000`):
```bash
curl -s http://localhost:4280/api/contact -H 'Content-Type: application/json' \
  -d '{"name":"Test User","email":"you@example.com","message":"Hello","elapsedMs":4000,"page":"/contact.html"}'
# -> {"ok":true}
```
