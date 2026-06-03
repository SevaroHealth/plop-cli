import { describe, it, expect } from "vitest";
import { parseArgs, resolveConfig, describeVisibility, ArgError, ConfigError } from "./cli.mjs";

describe("parseArgs", () => {
  it("requires --path for a deploy", () => {
    expect(() => parseArgs([])).toThrow(ArgError);
  });

  it("parses a basic deploy and defaults authMode to sevaro (private)", () => {
    const r = parseArgs(["--path", "./site"]);
    expect(r).toMatchObject({ command: "deploy", path: "./site", authMode: "sevaro", spaFallback: true });
  });

  it("--public opts into public visibility", () => {
    expect(parseArgs(["--path", "x", "--public"]).authMode).toBe("public");
  });

  it("--public overrides --auth-mode", () => {
    expect(parseArgs(["--path", "x", "--auth-mode", "sevaro", "--public"]).authMode).toBe("public");
  });

  it("rejects an invalid --auth-mode", () => {
    expect(() => parseArgs(["--path", "x", "--auth-mode", "nope"])).toThrow(ArgError);
  });

  it("rejects byo (config-editor only — the CLI can't supply OIDC config)", () => {
    expect(() => parseArgs(["--path", "x", "--auth-mode", "byo"])).toThrow(ArgError);
  });

  it("--spa-fallback false disables spa fallback", () => {
    expect(parseArgs(["--path", "x", "--spa-fallback", "false"]).spaFallback).toBe(false);
    expect(parseArgs(["--path", "x", "--spa-fallback", "true"]).spaFallback).toBe(true);
  });

  it("passes through --subdomain", () => {
    const r = parseArgs(["--path", "x", "--subdomain", "demo"]);
    expect(r.subdomain).toBe("demo");
  });

  it("recognizes login/logout commands without requiring --path", () => {
    expect(parseArgs(["login"]).command).toBe("login");
    expect(parseArgs(["logout"]).command).toBe("logout");
  });

  it("treats --help as help (no --path needed)", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });
});

describe("resolveConfig", () => {
  it("env vars override baked defaults", () => {
    const cfg = resolveConfig({
      PLOP_API_BASE: "https://plop.example.com",
      PLOP_TENANT_ID: "tenant",
      PLOP_CLIENT_ID: "client",
    });
    expect(cfg).toEqual({ apiBase: "https://plop.example.com", tenant: "tenant", clientId: "client" });
  });

  it("uses baked-in Sevaro defaults when no env is set", () => {
    const cfg = resolveConfig({});
    expect(cfg).toEqual({
      apiBase: "https://plop.sevaro.com",
      tenant: "2bc758d7-24d4-4458-a230-511ce238a604",
      clientId: "e0225328-87f3-4833-84e8-c78340e77d70",
    });
  });

  it("throws when a default is blanked and no env override is present", () => {
    const empty = { apiBase: "https://x", tenant: "", clientId: "" };
    expect(() => resolveConfig({ PLOP_CLIENT_ID: "c" }, empty)).toThrow(ConfigError);
    expect(() => resolveConfig({ PLOP_TENANT_ID: "t" }, empty)).toThrow(ConfigError);
  });
});

describe("describeVisibility", () => {
  it("maps auth modes to human-readable visibility", () => {
    expect(describeVisibility("public")).toMatch(/public/i);
    expect(describeVisibility("sevaro")).toMatch(/private/i);
  });
});
