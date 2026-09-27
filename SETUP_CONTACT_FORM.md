# Contact form — Microsoft 365 setup (manual steps)

The website contact form posts to an Azure Functions API (`/api/contact`) that
sends email through **Microsoft Graph** using an app registration with
**application** permission `Mail.Send`, locked down so it can send **only** as
`team@pointercreek.com`.

You do the steps below by hand (Azure Portal clicks with equivalent
PowerShell/CLI). Anywhere you see `<...>`, substitute the real value. **Do not
put secrets in the repo** — they go in the Static Web App's Environment
variables (step C).

Prerequisites: you're a **Global Administrator** (or Application + Exchange
admin) on the pointercreek.com Microsoft 365 tenant.

---

## A) Register the app + grant Mail.Send (application permission)

### Portal
1. **Entra admin center** → https://entra.microsoft.com → **Identity → Applications → App registrations → + New registration**.
2. Name: `PCWM Website Contact Form`. Supported account types: **Accounts in this organizational directory only (single tenant)**. Leave Redirect URI blank. **Register**.
3. On the app's **Overview**, copy **Application (client) ID** and **Directory (tenant) ID** — you'll need them in step C.
4. **API permissions → + Add a permission → Microsoft Graph → Application permissions** → search **Mail.Send** → check it → **Add permissions**.
5. Click **Grant admin consent for <tenant>** → **Yes**. The Mail.Send row should show **Granted**.

### PowerShell equivalent (Microsoft Graph PowerShell)
```powershell
Install-Module Microsoft.Graph -Scope CurrentUser   # once
Connect-MgGraph -Scopes "Application.ReadWrite.All","AppRoleAssignment.ReadWrite.All","Directory.ReadWrite.All"

$app = New-MgApplication -DisplayName "PCWM Website Contact Form" -SignInAudience "AzureADMyOrg"
$sp  = New-MgServicePrincipal -AppId $app.AppId

# Microsoft Graph app + the Mail.Send application role
$graph = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'"
$mailSend = $graph.AppRoles | Where-Object { $_.Value -eq "Mail.Send" -and $_.AllowedMemberTypes -contains "Application" }

New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id `
  -PrincipalId $sp.Id -ResourceId $graph.Id -AppRoleId $mailSend.Id

"TenantId : $((Get-MgContext).TenantId)"
"ClientId : $($app.AppId)"
```
(Admin consent is implied by the app-role assignment above; in the portal it shows as Granted.)

---

## B) Lock the app to ONLY send as team@pointercreek.com

By default, application `Mail.Send` can send as **any** mailbox in the tenant.
Restrict it with an **Exchange Online Application Access Policy** scoped to a
mail-enabled security group that contains only the sender mailbox.

### PowerShell (Exchange Online)
```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser   # once
Connect-ExchangeOnline -UserPrincipalName you@pointercreek.com

# 1) A mail-enabled security group whose only member is the sender mailbox
New-DistributionGroup -Name "PCWM Graph Senders" -Type Security `
  -PrimarySmtpAddress graph-senders@pointercreek.com
Add-DistributionGroupMember -Identity graph-senders@pointercreek.com `
  -Member team@pointercreek.com

# 2) The access policy: this AppId may only send as members of that group
New-ApplicationAccessPolicy -AppId <CLIENT_ID> `
  -PolicyScopeGroupId graph-senders@pointercreek.com `
  -AccessRight RestrictAccess `
  -Description "Website contact form may send only as team@pointercreek.com"
```

### Verify the restriction
```powershell
# Allowed (team@ is in the group) -> Access should be "Granted"
Test-ApplicationAccessPolicy -Identity team@pointercreek.com -AppId <CLIENT_ID>

# Any other mailbox -> Access should be "Denied"
Test-ApplicationAccessPolicy -Identity someoneelse@pointercreek.com -AppId <CLIENT_ID>
```
Policy changes can take a short while to propagate. After it's live, a Graph
`sendMail` as `team@pointercreek.com` succeeds; as anyone else it returns
`ErrorAccessDenied`.

> Alternative to the classic policy: **RBAC for Applications** (Exchange) with a
> custom management scope limited to `team@pointercreek.com` and the
> `Application Mail.Send` role. The access-policy approach above is simplest.

---

## C) Client secret + environment variables

### Create a client secret
- Portal: app → **Certificates & secrets → Client secrets → + New client secret** → description `swa`, expiry 12–24 months → **Add** → **copy the secret _Value_ immediately** (shown once).
- PowerShell:
  ```powershell
  $pw = Add-MgApplicationPassword -ApplicationId $app.Id `
        -PasswordCredential @{ DisplayName = "swa" }
  $pw.SecretText   # copy this once
  ```

### Add the 5 variables to the Static Web App
Azure Portal → your **Static Web App** (`brave-dune-040d74a0f`) → **Settings → Environment variables** → **Production** → add each, then **Save** (this restarts the managed functions):

| Name | Value |
|------|-------|
| `GRAPH_TENANT_ID` | `<tenant-id>` |
| `GRAPH_CLIENT_ID` | `<client-id>` |
| `GRAPH_CLIENT_SECRET` | `<secret-value>` |
| `MAIL_SENDER` | `team@pointercreek.com` |
| `MAIL_TO` | `team@pointercreek.com,clientservices@pointercreek.com` |

az CLI equivalent:
```bash
az staticwebapp appsettings set --name <swa-name> --setting-names \
  GRAPH_TENANT_ID=<tenant-id> \
  GRAPH_CLIENT_ID=<client-id> \
  GRAPH_CLIENT_SECRET=<secret-value> \
  MAIL_SENDER=team@pointercreek.com \
  MAIL_TO=team@pointercreek.com,clientservices@pointercreek.com
```
> `clientservices@pointercreek.com` must be a real, monitored mailbox/alias for it to receive the copy.

---

## D) Test end to end

1. Confirm the SWA deploy that includes `/api` finished (GitHub Actions → green run).
2. Visit the live **Contact** page, fill in the form, submit.
3. Expect the on-page message: *"Thank you — a member of our team will be in touch."*
4. Confirm the email lands in **both** `team@pointercreek.com` and `clientservices@pointercreek.com`, that **Reply** goes to the visitor's address, and the subject is `Website contact request – <name>`.
5. Negative checks:
   - Submitting in under 3 seconds → rejected (front end paces this; a raw fast POST returns `too_fast`).
   - Filling the hidden `company` field → silently accepted, no email.
   - More than 5 posts from one IP in 10 minutes → `429`.

### If email doesn't arrive
- **403 / ErrorAccessDenied** from Graph → the application access policy isn't matching; re-run the `Test-ApplicationAccessPolicy` checks in step B.
- **401 / invalid_client** → wrong `GRAPH_CLIENT_SECRET` (copied the ID instead of the value, or it expired).
- **500 `server`** in the response → an env var is missing; re-check step C and that you saved/restarted.
- Check **Static Web App → Functions → Monitor** (Application Insights) — logs record only outcome/error type, never message contents.
