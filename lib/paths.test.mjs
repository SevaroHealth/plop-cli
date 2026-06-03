import { describe, it, expect } from "vitest";
import path from "node:path";
import { configDir, cacheFilePath } from "./paths.mjs";

const WIN_HOME = String.raw`C:\Users\jane`;
const WIN_APPDATA = String.raw`C:\Users\jane\AppData\Roaming`;

describe("configDir", () => {
  it("uses %APPDATA% plop on Windows", () => {
    const dir = configDir({
      platform: "win32",
      env: { APPDATA: WIN_APPDATA },
      homedir: WIN_HOME,
    });
    expect(dir).toBe(path.join(WIN_APPDATA, "plop"));
  });

  it("falls back to homedir AppData Roaming on Windows when APPDATA unset", () => {
    const dir = configDir({ platform: "win32", env: {}, homedir: WIN_HOME });
    expect(dir).toBe(path.join(WIN_HOME, "AppData", "Roaming", "plop"));
  });

  it("uses $XDG_CONFIG_HOME/plop on POSIX when set", () => {
    const dir = configDir({
      platform: "linux",
      env: { XDG_CONFIG_HOME: "/home/jane/.cfg" },
      homedir: "/home/jane",
    });
    expect(dir).toBe(path.join("/home/jane/.cfg", "plop"));
  });

  it("falls back to ~/.config/plop on POSIX when XDG unset", () => {
    const dir = configDir({ platform: "darwin", env: {}, homedir: "/Users/jane" });
    expect(dir).toBe(path.join("/Users/jane", ".config", "plop"));
  });
});

describe("cacheFilePath", () => {
  it("is msal-cache.json inside the config dir", () => {
    const file = cacheFilePath({ platform: "darwin", env: {}, homedir: "/Users/jane" });
    expect(file).toBe(path.join("/Users/jane", ".config", "plop", "msal-cache.json"));
  });
});
