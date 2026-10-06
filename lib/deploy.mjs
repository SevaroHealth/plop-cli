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
 * Look up the caller's own site by subdomain via GET /api/list?scope=mine.
 * `scope=mine` is available to every authenticated user (not admin-only) and
 * returns each owned site's authMode + spaFallback, so a content redeploy can
 * preserve them. Best-effort: any failure returns null and the caller falls
 * back to defaults (the publish response prints the resolved visibility, so a
 * fallback is never silent).
 */
async function findOwnedSite(fetchImpl, apiBase, idToken, subdomain) {
  try {
    const res = await fetchImpl(`${apiBase}/api/list?scope=mine`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return null;
    const data = safeJson(await res.text());
    return (data?.sites ?? []).find((s) => s.subdomain === subdomain) ?? null;
  } catch {
    return null;
  }
}

/**
 * Auth-agnostic plop deploy: the shared 3-step wire protocol
 * (upload-url → presigned S3 POST → publish). It takes an already-obtained
 * bearer token and knows nothing about how it was acquired.
 *
 * `authMode` / `spaFallback` are optional: when omitted, an existing target
 * site's current values are preserved (content-only update); a brand-new site
 * falls back to `sevaro` (private) + spaFallback on. Pass them to change a
 * setting.
 *
 * @param {{
 *   apiBase: string,
 *   idToken: string,
 *   subdomain?: string,
 *   authMode?: "public" | "sevaro",
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
  spaFallback,
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

  // 2.5 Resolve any unset config from the EXISTING site so a content redeploy
  //     preserves its current settings instead of resetting them. Only an
  //     explicitly-named subdomain can be an existing site; auto-gen names are
  //     always new, so skip the lookup (and the cost) for them.
  let resolvedAuthMode = authMode;
  let resolvedSpaFallback = spaFallback;
  if ((resolvedAuthMode === undefined || resolvedSpaFallback === undefined) && subdomain) {
    const existing = await findOwnedSite(fetchImpl, apiBase, idToken, subdomain);
    if (resolvedAuthMode === undefined) resolvedAuthMode = existing?.authMode;
    if (resolvedSpaFallback === undefined) resolvedSpaFallback = existing?.spaFallback;
  }
  // New site (or unresolved): private + spaFallback on. publish requires a
  // concrete authMode, so never send undefined.
  resolvedAuthMode ??= "sevaro";
  resolvedSpaFallback ??= true;

  // 3. Publish — extract/deploy and write the host config.
  return postJson(
    fetchImpl,
    `${apiBase}/api/publish`,
    idToken,
    {
      subdomain: upload.subdomain,
      uploadKey: upload.uploadKey,
      // The staged object has no extension; the original name lets publish
      // classify html/zip/pdf without relying on content sniffing.
      fileName: filename,
      authMode: resolvedAuthMode,
      spaFallback: resolvedSpaFallback,
      // `kind` is server-authoritative: publish derives it from the existing
      // config or the subdomain shape and ignores anything we send. We echo
      // the value upload-url already classified, purely informationally.
      kind: upload.kind,
    },
    "publish",
  );
}
