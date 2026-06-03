import { promises as fs, createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import archiver from "archiver";

// Mirrors the backend's upload ceiling (api/upload-url/handler.mjs MAX_BYTES).
export const MAX_BYTES = 75 * 1024 * 1024;

const PASSTHROUGH_TYPES = {
  ".zip": "application/zip",
  ".pdf": "application/pdf",
  ".html": "text/html",
  ".htm": "text/html",
};

export class ArtifactError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "ArtifactError";
    this.code = code;
  }
}

/**
 * Zip a directory's contents (entries at the archive root, not nested under
 * the directory name) into a temp file using the pure-JS `archiver` — never
 * shells out to a `zip` binary, so it works on Windows too.
 *
 * @param {string} dir
 * @returns {Promise<{ filePath: string, cleanup: () => Promise<void> }>}
 */
async function zipDirectory(dir) {
  const filePath = path.join(os.tmpdir(), `plop-${crypto.randomBytes(8).toString("hex")}.zip`);
  const output = createWriteStream(filePath);
  const archive = archiver("zip", { zlib: { level: 6 } });

  const closed = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.on("warning", (err) => {
      if (err.code !== "ENOENT") reject(err);
    });
  });

  archive.pipe(output);
  archive.directory(dir, false);
  await archive.finalize();
  await closed;

  return {
    filePath,
    cleanup: () => fs.rm(filePath, { force: true }),
  };
}

/**
 * Resolve a user-supplied path into an uploadable artifact.
 * - Directory  → zipped to a temp file (caller must call `cleanup`).
 * - .zip/.pdf/.html(.htm) file → passed through unchanged (`cleanup` is a no-op).
 * Rejects unsupported types, missing paths, and anything over `maxBytes`.
 *
 * @param {string} inputPath
 * @param {{ maxBytes?: number }} [opts]
 * @returns {Promise<{ filePath: string, filename: string, contentType: string, cleanup: () => Promise<void> }>}
 */
export async function resolveArtifact(inputPath, { maxBytes = MAX_BYTES } = {}) {
  let stat;
  try {
    stat = await fs.stat(inputPath);
  } catch {
    throw new ArtifactError("artifact_not_found", `Path not found: ${inputPath}`);
  }

  if (stat.isDirectory()) {
    const { filePath, cleanup } = await zipDirectory(inputPath);
    const { size } = await fs.stat(filePath);
    if (size > maxBytes) {
      await cleanup();
      throw new ArtifactError(
        "artifact_too_large",
        `Zipped directory is ${size} bytes, over the ${maxBytes}-byte limit`,
      );
    }
    return { filePath, filename: "upload.zip", contentType: "application/zip", cleanup };
  }

  if (stat.isFile()) {
    const ext = path.extname(inputPath).toLowerCase();
    const contentType = PASSTHROUGH_TYPES[ext];
    if (!contentType) {
      throw new ArtifactError(
        "unsupported_artifact",
        `Unsupported file type "${ext || "(none)"}". Deploy a directory, or a .zip/.pdf/.html file.`,
      );
    }
    if (stat.size > maxBytes) {
      throw new ArtifactError(
        "artifact_too_large",
        `File is ${stat.size} bytes, over the ${maxBytes}-byte limit`,
      );
    }
    return {
      filePath: inputPath,
      filename: path.basename(inputPath),
      contentType,
      cleanup: async () => {},
    };
  }

  throw new ArtifactError("unsupported_artifact", `Not a file or directory: ${inputPath}`);
}
