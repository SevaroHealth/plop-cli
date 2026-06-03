import os from "node:os";
import path from "node:path";

/**
 * Cross-platform per-user config directory for the plop CLI.
 *
 * Windows  → %APPDATA%\plop          (fallback ~\AppData\Roaming\plop)
 * macOS/*  → $XDG_CONFIG_HOME/plop    (fallback ~/.config/plop)
 *
 * Parameters are injectable so the platform branches can be unit-tested off
 * their native OS.
 *
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv, homedir?: string }} [opts]
 * @returns {string}
 */
export function configDir({ platform = process.platform, env = process.env, homedir = os.homedir() } = {}) {
  if (platform === "win32") {
    const base = env.APPDATA || path.join(homedir, "AppData", "Roaming");
    return path.join(base, "plop");
  }
  const base = env.XDG_CONFIG_HOME || path.join(homedir, ".config");
  return path.join(base, "plop");
}

/**
 * Absolute path to the MSAL token-cache file.
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv, homedir?: string }} [opts]
 * @returns {string}
 */
export function cacheFilePath(opts) {
  return path.join(configDir(opts), "msal-cache.json");
}
