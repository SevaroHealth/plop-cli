import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDeploy, DeployError } from "./deploy.mjs";

let tmp;
let filePath;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "plop-deploy-test-"));
  filePath = path.join(tmp, "upload.zip");
  await fs.writeFile(filePath, "PK\x03\x04payload");
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body == null ? "" : JSON.stringify(body)),
  };
}

const UPLOAD_OK = {
  subdomain: "demo",
  host: "demo.plop.sevaro.com",
  kind: "custom",
  uploadKey: "demo.plop.sevaro.com__staging/_upload/abc123",
  presignedPost: {
    url: "https://s3.example.com/content-bucket",
    fields: { key: "demo.plop.sevaro.com__staging/_upload/abc123", policy: "POLICY", "x-amz-signature": "SIG" },
  },
  createdBy: "user-oid",
};

const PUBLISH_OK = {
  host: "demo.plop.sevaro.com",
  kind: "custom",
  authMode: "sevaro",
  deployedAt: "2026-05-30T00:00:00.000Z",
  fileCount: 1,
  configOnly: false,
  generation: "abc-1234",
  bytes: 11,
};

/** Build a fetch mock that returns queued responses in order and records calls. */
function mockFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses[calls.length - 1];
    if (!next) throw new Error(`unexpected call #${calls.length} to ${url}`);
    return next;
  };
  return { fetchImpl, calls };
}

describe("runDeploy", () => {
  it("runs upload-url → presigned POST → publish in order with auth", async () => {
    const { fetchImpl, calls } = mockFetch([
      jsonRes(200, UPLOAD_OK),
      jsonRes(204, null),
      jsonRes(200, PUBLISH_OK),
    ]);

    const result = await runDeploy({
      apiBase: "https://plop.sevaro.com",
      idToken: "TOKEN",
      subdomain: "demo",
      authMode: "sevaro",
      spaFallback: true,
      filePath,
      filename: "upload.zip",
      contentType: "application/zip",
      fetchImpl,
    });

    expect(result).toEqual(PUBLISH_OK);
    expect(calls).toHaveLength(3);

    // 1. upload-url
    expect(calls[0].url).toBe("https://plop.sevaro.com/api/upload-url");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Authorization).toBe("Bearer TOKEN");
    expect(JSON.parse(calls[0].init.body)).toEqual({ subdomain: "demo" });

    // 2. presigned multipart POST — fields forwarded + file part present
    expect(calls[1].url).toBe(UPLOAD_OK.presignedPost.url);
    const form = calls[1].init.body;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("key")).toBe(UPLOAD_OK.presignedPost.fields.key);
    expect(form.get("policy")).toBe("POLICY");
    expect(form.get("x-amz-signature")).toBe("SIG");
    expect(form.get("file")).toBeTruthy();
    // S3 requires the file field to be appended last; verify it is the final key.
    expect([...form.keys()].at(-1)).toBe("file");

    // 3. publish
    expect(calls[2].url).toBe("https://plop.sevaro.com/api/publish");
    expect(calls[2].init.headers.Authorization).toBe("Bearer TOKEN");
    expect(JSON.parse(calls[2].init.body)).toMatchObject({
      subdomain: "demo",
      uploadKey: UPLOAD_OK.uploadKey,
      authMode: "sevaro",
      spaFallback: true,
    });
  });

  it("uses the server-resolved subdomain when none was supplied (auto-gen)", async () => {
    const autoUpload = { ...UPLOAD_OK, subdomain: "happy-otter", kind: "auto" };
    const { fetchImpl, calls } = mockFetch([
      jsonRes(200, autoUpload),
      jsonRes(204, null),
      jsonRes(200, { ...PUBLISH_OK, host: "happy-otter.plop.sevaro.com", kind: "auto" }),
    ]);

    await runDeploy({
      apiBase: "https://plop.sevaro.com",
      idToken: "T",
      authMode: "sevaro",
      filePath,
      filename: "upload.zip",
      fetchImpl,
    });

    // upload-url body is empty when no subdomain requested
    expect(JSON.parse(calls[0].init.body)).toEqual({});
    // publish uses the resolved name
    expect(JSON.parse(calls[2].init.body).subdomain).toBe("happy-otter");
  });

  it("throws a DeployError tagged 'upload_url' with the server error code", async () => {
    const { fetchImpl } = mockFetch([jsonRes(422, { error: "invalid_subdomain" })]);
    await expect(
      runDeploy({ apiBase: "https://x", idToken: "T", subdomain: "Bad", authMode: "sevaro", filePath, fetchImpl }),
    ).rejects.toMatchObject({ step: "upload_url", code: "invalid_subdomain" });
  });

  it("throws a DeployError tagged 'upload' when the presigned POST fails", async () => {
    const { fetchImpl } = mockFetch([jsonRes(200, UPLOAD_OK), jsonRes(403, null)]);
    await expect(
      runDeploy({ apiBase: "https://x", idToken: "T", subdomain: "demo", authMode: "sevaro", filePath, fetchImpl }),
    ).rejects.toMatchObject({ step: "upload", code: "upload_failed" });
  });

  it("throws a DeployError tagged 'publish' on publish failure", async () => {
    const { fetchImpl } = mockFetch([
      jsonRes(200, UPLOAD_OK),
      jsonRes(204, null),
      jsonRes(403, { error: "not_owner" }),
    ]);
    await expect(
      runDeploy({ apiBase: "https://x", idToken: "T", subdomain: "demo", authMode: "sevaro", filePath, fetchImpl }),
    ).rejects.toBeInstanceOf(DeployError);
  });
});
