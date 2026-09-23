# SharePoint → Website sync — setup

This connects the **Pointer Creek Web Content** SharePoint site to the website.
Drop a document in the SharePoint library and it publishes to the live site at a
fixed URL, with `resources.html`, `sitemap.xml`, and `llms.txt` updated
automatically.

- **Site:** `https://pointercreek.sharepoint.com/sites/Websitecontent`
- **Library:** `Documents`
- Files land on the site under `/docs/<filename>` and appear on the Resources page.

> ⚠️ Anything in that library becomes **public** on the website. Keep client,
> confidential, or internal-only files out of it.

## One-time: create the app registration (Microsoft 365 admin)

Do this in the Microsoft **Entra ID (Azure AD)** admin center for the
`pointercreek.onmicrosoft.com` tenant.

1. **Entra ID → App registrations → New registration.**
   - Name: `PCWM Website SharePoint Sync`
   - Supported account types: *Single tenant*
   - Register.
2. Copy the **Directory (tenant) ID** and the **Application (client) ID**.
3. **Certificates & secrets → New client secret** → copy the **secret value**
   immediately (you can't see it again).
4. **API permissions → Add a permission → Microsoft Graph → Application
   permissions → `Sites.Selected`** (least-privilege; recommended) **or**
   `Sites.Read.All` (simpler, reads all sites). Then **Grant admin consent**.
   - If you chose `Sites.Selected`, grant this app **read** on just the Web
     Content site (via Graph `sites/{id}/permissions`, or ask us to script it).

## One-time: add the three secrets to GitHub

Repo **`pcwmgpt/website-demo`** → **Settings → Secrets and variables → Actions
→ New repository secret**. Add:

| Name | Value |
|------|-------|
| `SP_TENANT_ID` | Directory (tenant) ID |
| `SP_CLIENT_ID` | Application (client) ID |
| `SP_CLIENT_SECRET` | the client secret value |

## Turn it on

- The workflow **SharePoint → website sync** runs automatically every 6 hours
  once the secrets exist.
- To run it immediately: repo **Actions** tab → *SharePoint → website sync* →
  **Run workflow**.

That's it. After it runs, the documents appear on the Resources page and the
site redeploys on Azure.
