# plop-deploy

Publish a folder, zip, PDF, or HTML file to [plop](https://plop.sevaro.com)
straight from the terminal — the deployed site is **owned by you** (recorded
under your name, redeployable by you from the CLI or the dashboard).

## Install

`plop-deploy` ships as a **self-contained native binary** — no Node or Bun
required to run it.

```bash
curl -fsSL https://raw.githubusercontent.com/SevaroHealth/plop-cli/main/install.sh | bash
```

The installer detects your OS/arch (macOS/Linux, arm64/x64), downloads the
matching binary from the latest GitHub Release, and drops `plop-deploy` in
`~/.local/bin` (override with `PLOP_BIN_DIR`). Add that dir to your PATH if it
isn't already.

You can also grab a binary straight from the
[GitHub Releases](https://github.com/SevaroHealth/plop-cli/releases) (tagged
`cli-v*`), and verify it against the published `SHA256SUMS`:

```bash
shasum -a 256 -c SHA256SUMS --ignore-missing
```

## First deploy (one-time login, ~30s)

```bash
plop-deploy --path ./my-site --subdomain my-demo
```

The first run has no cached login, so it **opens your default browser** to the
Microsoft sign-in page (and also prints the URL in case the browser doesn't
launch). Sign in with your **normal Sevaro account** (same SSO as the
dashboard) and approve. The browser tab confirms success and hands the code
back to a short-lived `http://localhost` listener the CLI started; the CLI
caches a refresh token and finishes the deploy:

```
Deployed: https://my-demo.plop.sevaro.com/
Visibility: private (Sevaro login required)
Files: 12
```

This is the OAuth **authorization-code + PKCE** flow (the same one `az login`
and `gh auth login` use) — deliberately *not* device code, which Sevaro's
tenant blocks via Conditional Access.

## Every deploy after that (silent)

No browser — the token refreshes from the cache automatically:

```bash
plop-deploy --path ./my-site --subdomain my-demo
```

The silent login lasts roughly 90 days of inactivity, then the browser sign-in
repeats once. Run `plop-deploy logout` to forget the cached login.

## Private by default

A deployed site is **private** (`--auth-mode sevaro` — viewers must sign in with
Sevaro SSO) unless you explicitly opt in to a public, world-readable site:

```bash
plop-deploy --path ./my-site --subdomain my-demo --public
```

The CLI always prints the resolved visibility after deploying so it's never a
surprise.

## Updating an existing site

To update a deployment, deploy again with the **same `--subdomain`**. The
content is swapped atomically (no downtime), and `created_by` / `created_at` are
preserved.

> ⚠️ **Options are applied in full on every deploy — they are not remembered
> from the previous one.** The CLI always sends an auth mode (default `sevaro`)
> and SPA-fallback (default on), so a redeploy **without** `--public` flips a
> previously-public site back to private. Re-pass the flags you want each time:
>
> ```bash
> plop-deploy --path ./dist --subdomain my-demo --public
> ```

You can only update a site **you own** (you created it) — or as an admin.

## Options

| Flag | Default | Description |
|---|---|---|
| `--path <folder\|file>` | — (required) | A directory, or a `.zip`/`.pdf`/`.html` file. Directories are zipped automatically. |
| `--subdomain <name>` | auto-generated | Target subdomain. Omit to get a random `adjective-noun` name. |
| `--public` | off | Publish a world-readable site (alias for `--auth-mode public`). |
| `--auth-mode <mode>` | `sevaro` | `public` \| `sevaro`. (BYO OIDC is config-editor-only — the CLI can't supply OIDC config.) |
| `--spa-fallback <bool>` | `true` | Route unknown paths to `index.html`. |
| `login` / `logout` | — | Sign in (cache the token) / forget it. |

Max upload size is 75 MB (matches the backend).

## Configuration

The Sevaro tenant/client/API values are **baked in** (`lib/cli.mjs` `DEFAULTS`) —
end users set nothing. They are public identifiers (not secrets) and can be
overridden by env for dev/other environments:

| Env var | Baked default | Notes |
|---|---|---|
| `PLOP_API_BASE` | `https://plop.sevaro.com` | plop API base URL |
| `PLOP_TENANT_ID` | `2bc758d7-24d4-4458-a230-511ce238a604` | Entra tenant id |
| `PLOP_CLIENT_ID` | `e0225328-87f3-4833-84e8-c78340e77d70` | Entra app (client) id — the dashboard's |

There are **no secrets** — authorization-code + PKCE is a public-client flow.

## Token cache location

| OS | Path |
|---|---|
| macOS / Linux | `$XDG_CONFIG_HOME/plop/msal-cache.json` or `~/.config/plop/msal-cache.json` |
| Windows | `%APPDATA%\plop\msal-cache.json` |

On POSIX the file is locked to mode `0600` (best-effort; on Windows the per-user
profile directory ACLs apply).

## One-time Entra setup

The dashboard app registration needs a **`http://localhost` redirect URI** under
the *Mobile and desktop applications* platform (and *Allow public client flows*
enabled) so the browser sign-in can redirect back to the CLI's loopback server.
See [docs/entra-agent-setup.md](./docs/entra-agent-setup.md).

## Develop

```bash
npm install
npm test                 # vitest (48 cases)
npm run test:coverage    # 80% gate

# Run without compiling (Node):
node plop-deploy.mjs --help
```

## Build & release

Binaries are cross-compiled with [Bun](https://bun.sh) (a build-time tool only —
not a user dependency):

```bash
npm run build:binaries           # all targets → dist/plop-deploy-<os>-<arch>
node scripts/build-binaries.mjs darwin-arm64   # a single target
```

Targets: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`.

Releasing is automated: push a tag `cli-vX.Y.Z` and the `release-cli` GitHub
Actions workflow runs the tests, cross-compiles, and publishes a GitHub Release
with the binaries that `install.sh` downloads.
