# Entra setup for the `plop-deploy` CLI

The [`plop-deploy`](../README.md) CLI signs users in with the **OAuth 2.0
authorization-code grant + PKCE**, opening the system browser and capturing the
redirect on a short-lived `http://localhost` loopback server — the same flow
`az login` and `gh auth login` use. A terminal thus obtains the user's own Entra
`id_token`, and each deploy is owned by the real user.

> **Why not device code?** The CLI originally used the device authorization
> grant (device code flow). Sevaro's tenant **blocks device code via a
> Conditional Access "authentication flows" policy** (a common, recommended
> hardening — device code is phishing-prone). The symptom is a successful
> sign-in that is then denied at the resource: *"Your sign-in was successful but
> does not meet the criteria to access this resource … an authentication flow
> that is restricted by your admin."* Authorization-code + PKCE is a different
> flow and is **not** caught by that policy — and it launches the browser for
> the user instead of making them copy a code.

It reuses the **existing dashboard app registration** (the one referenced by the
backend's `ENTRA_CLIENT_ID`), so the resulting `id_token` has `aud ===
ENTRA_CLIENT_ID` and identical claims to what the dashboard sends today. The
backend's `verifyIdToken` accepts it unchanged — **no backend, role, or
template changes are required.**

## The one required change

The app registration needs a **loopback redirect URI** registered as a
public-client (desktop) redirect, so the browser can hand the auth code back to
the CLI.

1. Microsoft Entra admin center → **App registrations** → the plop dashboard app
   (Application/client ID == `ENTRA_CLIENT_ID`).
2. **Authentication** → **Add a platform** → **Mobile and desktop applications**.
3. Add the redirect URI **`http://localhost`** (loopback; Entra matches it on
   any port, so the CLI's randomly-chosen port works). Save.
4. Still on **Authentication** → **Advanced settings** → **Allow public client
   flows** → **Yes**. Save.

That's it. No client secret is involved (public client). No new app role, no
exposed API, no audience change. The SPA redirect URIs the dashboard uses are
untouched — this only *adds* a desktop loopback redirect.

> If a broader Conditional Access control is also in play (e.g. *require a
> compliant/managed device* or a *location* restriction scoped to this app),
> that would block the browser flow too and must be handled separately by the CA
> admin — it's independent of the redirect-URI change above.

## Why this is safe

- The token is a normal user `id_token` for the same audience the backend
  already trusts; verification is unchanged (RS256, v2 issuer, `aud ===
  ENTRA_CLIENT_ID`).
- Ownership/authorization are unchanged: `publish` records `created_by =
  caller.oid` (the user) and `assertOwnerOrAdmin` already lets owners redeploy.
- A `http://localhost` redirect is only reachable from the user's own machine
  during the few seconds of an interactive sign-in; it does not widen who can
  sign in or what scopes are granted.

## Verifying

The tenant/client ids are baked into the CLI, so no env is needed:

```bash
plop-deploy login          # opens your browser; sign in once
plop-deploy --path ./some-folder --subdomain test-cli
```

Then confirm in the dashboard that `test-cli` is listed under **your** name and
is redeployable by you.

## Distribution

The CLI ships as a self-contained native binary installed via the
`curl … | bash` one-liner in [`../README.md`](../README.md) (cross-platform,
incl. Windows). The non-secret `PLOP_TENANT_ID` / `PLOP_CLIENT_ID` /
`PLOP_API_BASE` values are baked into `lib/cli.mjs` `DEFAULTS` so end users
set no env vars.
