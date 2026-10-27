#!/usr/bin/env node
import { parseArgs, resolveConfig, describeVisibility, ArgError, ConfigError } from "./lib/cli.mjs";
import { getIdToken, clearCache } from "./lib/auth.mjs";
import { resolveArtifact } from "./lib/archive.mjs";
import { runDeploy } from "./lib/deploy.mjs";
import { cacheFilePath } from "./lib/paths.mjs";

const HELP = `plop-deploy — publish a site to plop, owned by you.

Usage:
  plop-deploy --path <folder|file> [options]
  plop-deploy login      Sign in (opens your browser) and cache the token
  plop-deploy logout     Forget the cached login

Options:
  --path <folder|file>   What to deploy: a directory, or a .zip/.pdf/.html file (required)
  --subdomain <name>     Target subdomain (omit to auto-generate a name)
  --public               Make the site public (default: private, Sevaro login required)
  --auth-mode <mode>     public | sevaro   (default: sevaro)
  --spa-fallback <bool>  Route unknown paths to index.html (default: true)
  --description <text>   Short description shown in the Directory (max 200; "" clears)
  --listed               List the site in the Directory (needs --subdomain)
  --unlisted             Remove the site from the Directory
  -h, --help             Show this help

Sites are PRIVATE by default. Pass --public to publish a world-readable site.

Updating a site: deploy again with the same --subdomain. Only the content is
replaced — the site's visibility and SPA-fallback are preserved. Pass --public,
--auth-mode, --spa-fallback, --description, --listed or --unlisted to change a
setting. Directory listings are only for named (non-temporary) sites and are
only shown to people who can already open the site.

Sign-in opens your default browser (authorization code + PKCE). The token is
cached, so later deploys refresh silently with no browser.

Advanced: set PLOP_API_BASE to target a non-production plop stack.`;

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof ArgError) {
      process.stderr.write(`${err.message}\n\n${HELP}\n`);
      process.exitCode = 2;
      return;
    }
    throw err;
  }

  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const cfg = resolveConfig();

  if (parsed.command === "logout") {
    await clearCache();
    process.stdout.write("Logged out — cached login removed.\n");
    return;
  }

  if (parsed.command === "login") {
    await getIdToken(cfg);
    process.stdout.write(`Signed in. Token cached at ${cacheFilePath()}\n`);
    return;
  }

  // deploy
  const artifact = await resolveArtifact(parsed.path);
  try {
    const idToken = await getIdToken(cfg);
    const res = await runDeploy({
      apiBase: cfg.apiBase,
      idToken,
      subdomain: parsed.subdomain,
      authMode: parsed.authMode,
      spaFallback: parsed.spaFallback,
      listed: parsed.listed,
      description: parsed.description,
      filePath: artifact.filePath,
      filename: artifact.filename,
      contentType: artifact.contentType,
    });
    process.stdout.write(
      `\nDeployed: https://${res.host}/\n` +
        `Visibility: ${describeVisibility(res.authMode ?? parsed.authMode)}\n` +
        `Files: ${res.fileCount}\n`,
    );
  } finally {
    await artifact.cleanup();
  }
}

try {
  await main();
} catch (err) {
  const prefix = err instanceof ConfigError ? "Config error" : "Error";
  process.stderr.write(`${prefix}: ${err.message}\n`);
  process.exitCode = 1;
}
