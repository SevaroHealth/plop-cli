import { parseArgs as nodeParseArgs } from "node:util";

// Non-secret Sevaro defaults so end users set no env vars at all. The tenant id
// and dashboard app (client) id are public identifiers — not secrets — and live
// committed in api/samconfig.toml (EntraTenantId / EntraClientId). Env vars
// override them for dev/other environments.
const DEFAULTS = {
  apiBase: "https://plop.sevaro.com",
  tenant: "2bc758d7-24d4-4458-a230-511ce238a604",
  clientId: "e0225328-87f3-4833-84e8-c78340e77d70",
};

const AUTH_MODES = new Set(["public", "sevaro"]);
const COMMANDS = new Set(["login", "logout"]);

export class ArgError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArgError";
  }
}

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Parse CLI arguments into a normalized command descriptor.
 * @param {string[]} argv argv after the node + script entries
 */
export function parseArgs(argv) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = nodeParseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        path: { type: "string" },
        subdomain: { type: "string" },
        "auth-mode": { type: "string" },
        public: { type: "boolean" },
        "spa-fallback": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (err) {
    throw new ArgError(err.message);
  }

  const command = COMMANDS.has(positionals[0]) ? positionals[0] : "deploy";
  const help = !!values.help;

  let authMode = "sevaro";
  if (values["auth-mode"]) {
    if (!AUTH_MODES.has(values["auth-mode"])) {
      throw new ArgError(`Invalid --auth-mode "${values["auth-mode"]}" (expected public or sevaro)`);
    }
    authMode = values["auth-mode"];
  }
  if (values.public) authMode = "public";

  const spaFallback = values["spa-fallback"] === undefined ? true : values["spa-fallback"] !== "false";

  if (command === "deploy" && !help && !values.path) {
    throw new ArgError("Missing required --path <folder|file>");
  }

  return { command, help, path: values.path, subdomain: values.subdomain, authMode, spaFallback };
}

/**
 * Resolve runtime config from env (overrides) + baked Sevaro defaults.
 * `defaults` is injectable so the missing-value guard stays testable.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ apiBase: string, tenant: string, clientId: string }} [defaults]
 */
export function resolveConfig(env = process.env, defaults = DEFAULTS) {
  const apiBase = env.PLOP_API_BASE || defaults.apiBase;
  const tenant = env.PLOP_TENANT_ID || defaults.tenant;
  const clientId = env.PLOP_CLIENT_ID || defaults.clientId;
  if (!tenant) throw new ConfigError("PLOP_TENANT_ID is not set and no default is baked in");
  if (!clientId) throw new ConfigError("PLOP_CLIENT_ID is not set and no default is baked in");
  return { apiBase, tenant, clientId };
}

/** Human-readable visibility for an auth mode, printed after a deploy. */
export function describeVisibility(authMode) {
  switch (authMode) {
    case "public":
      return "public (anyone with the link)";
    case "sevaro":
    default:
      return "private (Sevaro login required)";
  }
}
