import { promises as fs } from "node:fs";

/**
 * A failure at one of the three deploy steps. `step` is one of
 * "upload_url" | "upload" | "publish"; `code` is the backend's stable error
 * code (or http_<status>) so callers can map it to friendly copy.
 */
export class DeployError extends Error {
  /** @param {string} step @param {number} status @param {string} code @param {string} message */
  constructor(step, status, code, message) {
    super(message);
    this.name = "DeployError";
    this.step = step;
    this.status = status;
    this.code = code;
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function postJson(fetchImpl, url, idToken, body, step) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const payload = text ? safeJson(text) : null;
  if (!res.ok) {
    const code = payload?.error || `http_${res.status}`;
    throw new DeployError(step, res.status, code, payload?.message || payload?.detail || code);
  }
  return payload;
}

/**
 * Auth-agnostic plop deploy: the shared 3-step wire protocol
 * (upload-url → presigned S3 POST → publish). It takes an already-obtained
 * bearer token and knows nothing about how it was acquired.
 *
 * @param {{
 *   apiBase: string,
 *   idToken: string,
 *   subdomain?: string,
 *   authMode: "public" | "sevaro",
 *   spaFallback?: boolean,
 *   filePath: string,
 *   filename?: string,
 *   contentType?: string,
 *   fetchImpl?: typeof fetch,
 * }} params
 * @returns {Promise<object>} the publish response
 */
export async function runDeploy({
  apiBase,
  idToken,
  subdomain,
  authMode,
  spaFallback = true,
  filePath,
  filename = "upload",
  contentType,
  fetchImpl = fetch,
}) {
  // 1. Ask plop for a presigned upload target (also resolves an auto-gen name).
  const upload = await postJson(
    fetchImpl,
    `${apiBase}/api/upload-url`,
    idToken,
    subdomain ? { subdomain } : {},
    "upload_url",
  );

  // 2. Upload the artifact straight to S3 via the presigned POST. The file
  //    field MUST be appended last (S3 ignores form fields after "file").
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.presignedPost.fields)) {
    form.append(key, value);
  }
  const bytes = await fs.readFile(filePath);
  const blob = new Blob([bytes], contentType ? { type: contentType } : {});
  form.append("file", blob, filename);

  const uploadRes = await fetchImpl(upload.presignedPost.url, { method: "POST", body: form });
  if (!uploadRes.ok) {
    throw new DeployError("upload", uploadRes.status, "upload_failed", `S3 upload failed (${uploadRes.status})`);
  }

  // 3. Publish — extract/deploy and write the host config.
  return postJson(
    fetchImpl,
    `${apiBase}/api/publish`,
    idToken,
    {
      subdomain: upload.subdomain,
      uploadKey: upload.uploadKey,
      authMode,
      spaFallback,
      // `kind` is server-authoritative: publish derives it from the existing
      // config or the subdomain shape and ignores anything we send. We echo
      // the value upload-url already classified, purely informationally.
      kind: upload.kind,
    },
    "publish",
  );
}
