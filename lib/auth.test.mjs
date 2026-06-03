import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// Controllable fake for @azure/msal-node's PublicClientApplication.
const mockState = {};
vi.mock("@azure/msal-node", () => ({
  PublicClientApplication: class {
    constructor(config) {
      mockState.lastConfig = config;
    }
    getTokenCache() {
      return { getAllAccounts: async () => mockState.accounts ?? [] };
    }
    async acquireTokenSilent() {
      if (mockState.silentError) throw mockState.silentError;
      return mockState.silentResult;
    }
    async acquireTokenInteractive(req) {
      mockState.lastInteractiveRequest = req;
      // Exercise the openBrowser callback the way MSAL would.
      if (req.openBrowser) await req.openBrowser("https://login.microsoftonline.com/authorize?x=1");
      if (mockState.interactiveError) throw mockState.interactiveError;
      return mockState.interactiveResult;
    }
  },
}));

const { getIdToken, clearCache, createCachePlugin, openBrowser } = await import("./auth.mjs");

let tmp;
let cacheFile;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "plop-auth-test-"));
  cacheFile = path.join(tmp, "msal-cache.json");
  for (const k of Object.keys(mockState)) delete mockState[k];
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("getIdToken", () => {
  const base = { tenant: "tenant-guid", clientId: "client-guid", openBrowser: async () => {}, promptOutput: () => {} };

  it("returns the id_token silently when a cached account exists", async () => {
    mockState.accounts = [{ homeAccountId: "a" }];
    mockState.silentResult = { idToken: "SILENT_TOKEN" };
    const token = await getIdToken({ ...base, cacheFile });
    expect(token).toBe("SILENT_TOKEN");
    expect(mockState.lastConfig.auth.authority).toBe("https://login.microsoftonline.com/tenant-guid");
    expect(mockState.lastConfig.auth.clientId).toBe("client-guid");
  });

  it("falls back to interactive sign-in when there is no cached account", async () => {
    mockState.accounts = [];
    mockState.interactiveResult = { idToken: "BROWSER_TOKEN" };
    const token = await getIdToken({ ...base, cacheFile });
    expect(token).toBe("BROWSER_TOKEN");
    expect(mockState.lastInteractiveRequest).toBeTruthy();
  });

  it("falls back to interactive sign-in when silent acquisition throws", async () => {
    mockState.accounts = [{ homeAccountId: "a" }];
    mockState.silentError = new Error("interaction_required");
    mockState.interactiveResult = { idToken: "BROWSER_TOKEN" };
    const token = await getIdToken({ ...base, cacheFile });
    expect(token).toBe("BROWSER_TOKEN");
  });

  it("opens the browser with the authorize URL and prints it as a fallback", async () => {
    mockState.accounts = [];
    mockState.interactiveResult = { idToken: "T" };
    const opened = [];
    const messages = [];
    await getIdToken({
      ...base,
      cacheFile,
      openBrowser: async (url) => opened.push(url),
      promptOutput: (m) => messages.push(m),
    });
    expect(opened).toEqual(["https://login.microsoftonline.com/authorize?x=1"]);
    expect(messages.join("\n")).toContain("https://login.microsoftonline.com/authorize?x=1");
  });

  it("requests the dashboard login scopes", async () => {
    mockState.accounts = [];
    mockState.interactiveResult = { idToken: "T" };
    await getIdToken({ ...base, cacheFile });
    expect(mockState.lastInteractiveRequest.scopes).toEqual(["openid", "profile", "email"]);
  });

  it("writes the sign-in prompt to stderr by default", async () => {
    mockState.accounts = [];
    mockState.interactiveResult = { idToken: "T" };
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await getIdToken({ tenant: "t", clientId: "c", cacheFile, openBrowser: async () => {} });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("login.microsoftonline.com"));
  });

  it("throws when interactive sign-in returns no id_token", async () => {
    mockState.accounts = [];
    mockState.interactiveResult = { idToken: null };
    await expect(getIdToken({ ...base, cacheFile })).rejects.toThrow(/no.*token/i);
  });
});

function fakeSpawn() {
  const calls = [];
  const spawnImpl = (command, args) => {
    calls.push({ command, args });
    return { on() {}, unref() {} };
  };
  return { spawnImpl, calls };
}

describe("openBrowser", () => {
  it("uses `open` on macOS", async () => {
    const { spawnImpl, calls } = fakeSpawn();
    await openBrowser("https://x.test", { platform: "darwin", spawnImpl });
    expect(calls[0]).toEqual({ command: "open", args: ["https://x.test"] });
  });

  it("uses `cmd /c start` on Windows", async () => {
    const { spawnImpl, calls } = fakeSpawn();
    await openBrowser("https://x.test", { platform: "win32", spawnImpl });
    expect(calls[0]).toEqual({ command: "cmd", args: ["/c", "start", "", "https://x.test"] });
  });

  it("uses `xdg-open` on Linux", async () => {
    const { spawnImpl, calls } = fakeSpawn();
    await openBrowser("https://x.test", { platform: "linux", spawnImpl });
    expect(calls[0]).toEqual({ command: "xdg-open", args: ["https://x.test"] });
  });

  it("resolves (does not throw) when the browser fails to launch — the URL is printed as a fallback", async () => {
    const spawnImpl = () => ({
      on(event, cb) {
        if (event === "error") cb(new Error("ENOENT"));
      },
      unref() {},
    });
    await expect(openBrowser("https://x.test", { platform: "linux", spawnImpl })).resolves.toBeUndefined();
  });
});

describe("cache plugin", () => {
  it("loads an existing cache file via deserialize", async () => {
    await fs.writeFile(cacheFile, "SERIALIZED");
    const deserialize = vi.fn();
    const plugin = createCachePlugin(cacheFile);
    await plugin.beforeCacheAccess({ tokenCache: { deserialize } });
    expect(deserialize).toHaveBeenCalledWith("SERIALIZED");
  });

  it("tolerates a missing cache file", async () => {
    const deserialize = vi.fn();
    const plugin = createCachePlugin(cacheFile);
    await plugin.beforeCacheAccess({ tokenCache: { deserialize } });
    expect(deserialize).not.toHaveBeenCalled();
  });

  it("persists the cache (0600) when it changed", async () => {
    const plugin = createCachePlugin(cacheFile);
    await plugin.afterCacheAccess({ cacheHasChanged: true, tokenCache: { serialize: () => "NEWDATA" } });
    expect(await fs.readFile(cacheFile, "utf8")).toBe("NEWDATA");
    if (process.platform !== "win32") {
      const mode = (await fs.stat(cacheFile)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("does not write when the cache is unchanged", async () => {
    const plugin = createCachePlugin(cacheFile);
    await plugin.afterCacheAccess({ cacheHasChanged: false, tokenCache: { serialize: () => "X" } });
    await expect(fs.access(cacheFile)).rejects.toBeTruthy();
  });

  it("swallows a chmod failure (e.g. Windows)", async () => {
    vi.spyOn(fs, "chmod").mockRejectedValue(new Error("EPERM"));
    const plugin = createCachePlugin(cacheFile);
    await expect(
      plugin.afterCacheAccess({ cacheHasChanged: true, tokenCache: { serialize: () => "DATA" } }),
    ).resolves.toBeUndefined();
    expect(await fs.readFile(cacheFile, "utf8")).toBe("DATA");
  });
});

describe("clearCache", () => {
  it("removes the cache file and is idempotent", async () => {
    await fs.writeFile(cacheFile, "x");
    await clearCache(cacheFile);
    await expect(fs.access(cacheFile)).rejects.toBeTruthy();
    await expect(clearCache(cacheFile)).resolves.toBeUndefined();
  });
});
