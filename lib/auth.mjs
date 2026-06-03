import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PublicClientApplication } from "@azure/msal-node";
import { cacheFilePath } from "./paths.mjs";

// Same scopes the dashboard requests (web/src/lib/msal.ts) so the issued
// id_token carries identical claims (oid/name/email/roles). MSAL implicitly
// adds offline_access, which yields the refresh token that powers silent reuse.
export const LOGIN_SCOPES = ["openid", "profile", "email"];

/**
 * Open a URL in the user's default browser, cross-platform, without pulling in
 * an extra dependency (keeps the binary lean).
 *
 * Best-effort by design: a launch failure is swallowed, not thrown. MSAL
 * `await`s this before waiting on the loopback redirect, and the sign-in flow
 * prints the URL too — so if auto-launch fails the user can still paste it and
 * complete the flow. Throwing here would needlessly abort an otherwise-working
 * sign-in. The error handler also prevents an unhandled child `error` event
 * from crashing the process.
 *
 * @param {string} url
 * @param {{ platform?: string, spawnImpl?: typeof spawn }} [opts]
 * @returns {Promise<void>}
 */
export function openBrowser(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  let command;
  let args;
  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    // `start` is a cmd builtin; the empty "" is the (ignored) window title so a
    // quoted URL isn't mistaken for one.
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  return new Promise((resolve) => {
    const child = spawnImpl(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => resolve()); // launch failed; the printed URL is the fallback
    child.unref();
    resolve();
  });
}

/**
 * File-backed MSAL token cache. Persists refresh/account state so subsequent
 * runs refresh silently without another interactive sign-in.
 *
 * @param {string} cacheFile
 */
export function createCachePlugin(cacheFile) {
  return {
    async beforeCacheAccess(cacheContext) {
      try {
        const data = await fs.readFile(cacheFile, "utf8");
        cacheContext.tokenCache.deserialize(data);
      } catch {
        // No cache yet (first run) — start empty.
      }
    },
    async afterCacheAccess(cacheContext) {
      if (!cacheContext.cacheHasChanged) return;
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.writeFile(cacheFile, cacheContext.tokenCache.serialize(), "utf8");
      // Best-effort lockdown. chmod is a no-op/throws on Windows, where the
      // per-user profile directory ACLs already restrict access.
      try {
        await fs.chmod(cacheFile, 0o600);
      } catch {
        /* ignore — non-POSIX filesystem */
      }
    },
  };
}

const SIGNED_IN_PAGE =
  "<html><body style=\"font-family:system-ui;text-align:center;padding-top:3rem\">" +
  "<h2>Signed in to plop.</h2><p>You can close this tab and return to the terminal.</p>" +
  "</body></html>";
const SIGN_IN_FAILED_PAGE =
  "<html><body style=\"font-family:system-ui;text-align:center;padding-top:3rem\">" +
  "<h2>plop sign-in failed.</h2><p>Return to the terminal and try again.</p>" +
  "</body></html>";

/**
 * Acquire the user's Entra id_token for plop. Silent-first (from the cache),
 * falling back to an interactive **authorization-code + PKCE** sign-in that
 * opens the system browser and captures the redirect on a localhost loopback
 * server. This is a different authentication flow from device code (which many
 * tenants block via Conditional Access), and it launches the browser for the
 * user instead of making them copy a code.
 *
 * @param {{
 *   tenant: string,
 *   clientId: string,
 *   cacheFile?: string,
 *   scopes?: string[],
 *   openBrowser?: (url: string) => Promise<void>,
 *   promptOutput?: (message: string) => void,
 * }} params
 * @returns {Promise<string>} the raw id_token JWT
 */
export async function getIdToken({
  tenant,
  clientId,
  cacheFile = cacheFilePath(),
  scopes = LOGIN_SCOPES,
  openBrowser: openBrowserImpl = openBrowser,
  promptOutput = (message) => process.stderr.write(`${message}\n`),
}) {
  const pca = new PublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenant}`,
    },
    cache: { cachePlugin: createCachePlugin(cacheFile) },
  });

  const accounts = await pca.getTokenCache().getAllAccounts();
  if (accounts.length > 0) {
    try {
      const silent = await pca.acquireTokenSilent({ account: accounts[0], scopes });
      if (silent?.idToken) return silent.idToken;
    } catch {
      // Refresh expired/revoked — fall through to interactive sign-in.
    }
  }

  const result = await pca.acquireTokenInteractive({
    scopes,
    successTemplate: SIGNED_IN_PAGE,
    errorTemplate: SIGN_IN_FAILED_PAGE,
    openBrowser: async (url) => {
      promptOutput("Opening your browser to sign in. If it doesn't open, paste this URL:");
      promptOutput(url);
      await openBrowserImpl(url);
    },
  });
  if (!result?.idToken) throw new Error("interactive sign-in returned no id_token");
  return result.idToken;
}

/**
 * Forget the cached login (logout). Idempotent.
 * @param {string} [cacheFile]
 */
export async function clearCache(cacheFile = cacheFilePath()) {
  await fs.rm(cacheFile, { force: true });
}
