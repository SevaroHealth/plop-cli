#!/usr/bin/env node
// Cross-compile plop-deploy into self-contained native binaries with Bun.
// Bun is a build-time tool only — the produced binaries embed the runtime, so
// end users need neither Node nor Bun installed. Run from the cli/ dir:
//   node scripts/build-binaries.mjs           (build all targets)
//   node scripts/build-binaries.mjs darwin-arm64
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Targets we ship for the curl|bash installer (macOS + Linux, both arches).
const TARGETS = {
  "darwin-arm64": "bun-darwin-arm64",
  "darwin-x64": "bun-darwin-x64",
  "linux-x64": "bun-linux-x64",
  "linux-arm64": "bun-linux-arm64",
};

const requested = process.argv.slice(2);
const names = requested.length ? requested : Object.keys(TARGETS);

const distDir = path.join(cliDir, "dist");
if (!requested.length) rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

for (const name of names) {
  const bunTarget = TARGETS[name];
  if (!bunTarget) {
    console.error(`Unknown target "${name}". Known: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(1);
  }
  const outfile = path.join(distDir, `plop-deploy-${name}`);
  console.log(`building ${path.relative(cliDir, outfile)} (${bunTarget})`);
  execFileSync(
    "bun",
    ["build", "./plop-deploy.mjs", "--compile", `--target=${bunTarget}`, "--outfile", outfile],
    { cwd: cliDir, stdio: "inherit" },
  );
}

console.log(`\nDone. Binaries in ${path.relative(process.cwd(), distDir)}/`);
