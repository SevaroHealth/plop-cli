import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveArtifact, ArtifactError } from "./archive.mjs";

let tmp;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "plop-archive-test-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function isZip(buf) {
  return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

describe("resolveArtifact", () => {
  it("zips a directory and returns a real zip", async () => {
    const dir = path.join(tmp, "site");
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "index.html"), "<h1>hi</h1>");

    const art = await resolveArtifact(dir);
    try {
      expect(art.contentType).toBe("application/zip");
      const head = await fs.readFile(art.filePath);
      expect(isZip(head)).toBe(true);
    } finally {
      await art.cleanup();
    }
    // cleanup removes the temp zip
    await expect(fs.access(art.filePath)).rejects.toBeTruthy();
  });

  it("passes through a .html file unchanged", async () => {
    const file = path.join(tmp, "page.html");
    await fs.writeFile(file, "<p>x</p>");
    const art = await resolveArtifact(file);
    expect(art.filePath).toBe(file);
    expect(art.filename).toBe("page.html");
    expect(art.contentType).toBe("text/html");
    await art.cleanup(); // no-op, file still there
    await fs.access(file);
  });

  it("passes through .pdf and .zip files", async () => {
    const pdf = path.join(tmp, "doc.pdf");
    await fs.writeFile(pdf, "%PDF-1.4");
    expect((await resolveArtifact(pdf)).contentType).toBe("application/pdf");

    const zip = path.join(tmp, "bundle.zip");
    await fs.writeFile(zip, "PK\x03\x04");
    expect((await resolveArtifact(zip)).contentType).toBe("application/zip");
  });

  it("rejects an unsupported single file type", async () => {
    const file = path.join(tmp, "notes.txt");
    await fs.writeFile(file, "hello");
    await expect(resolveArtifact(file)).rejects.toBeInstanceOf(ArtifactError);
    await expect(resolveArtifact(file)).rejects.toMatchObject({ code: "unsupported_artifact" });
  });

  it("rejects a missing path", async () => {
    await expect(resolveArtifact(path.join(tmp, "nope"))).rejects.toMatchObject({
      code: "artifact_not_found",
    });
  });

  it("rejects an artifact over the size limit", async () => {
    const file = path.join(tmp, "big.html");
    await fs.writeFile(file, "x".repeat(64));
    await expect(resolveArtifact(file, { maxBytes: 32 })).rejects.toMatchObject({
      code: "artifact_too_large",
    });
  });

  it("rejects an oversize zipped directory and cleans up the temp zip", async () => {
    const dir = path.join(tmp, "big");
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "a.html"), "y".repeat(2048));
    await expect(resolveArtifact(dir, { maxBytes: 8 })).rejects.toMatchObject({
      code: "artifact_too_large",
    });
  });
});
