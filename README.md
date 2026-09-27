# website-demo

Static marketing site for Pointer Creek Wealth Management, deployed to Azure
Static Web Apps (`brave-dune-040d74a0f`). Pages are hand-authored HTML/CSS/JS
(no build step). The contact form is backed by an Azure Functions API in `/api`.

## Contact form API

`POST /api/contact` validates a submission and emails the team via Microsoft
Graph. Full details and the endpoint's env vars are in [`api/README.md`](api/README.md).
The one-time Microsoft 365 / Azure setup is in
[`SETUP_CONTACT_FORM.md`](SETUP_CONTACT_FORM.md).

## Testing locally with the SWA CLI

```bash
npm i -g @azure/static-web-apps-cli
npm i -g azure-functions-core-tools@4 --unsafe-perm true
cd api && npm install && cd ..

# create api/local.settings.json (git-ignored) with the Graph/mail values
# (template in api/README.md), then:
swa start . --api-location api
```

Open the printed URL (usually http://localhost:4280), go to the Contact page and
submit. `api/local.settings.json` holds local secrets and is git-ignored — never
commit it.
