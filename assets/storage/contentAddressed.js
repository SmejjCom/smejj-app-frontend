import { sha256Hex, toBytes } from "./checksum.js";

export function objectKeyForHash(sha256) {
  const hash = String(sha256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid SHA256 hash.");
  return `objects/sha256/${hash.slice(0, 2)}/${hash}`;
}

export async function createContentObject(path, content, contentType = "application/octet-stream") {
  const bytes = toBytes(content);
  const sha256 = await sha256Hex(bytes);
  return {
    path: normalizeRepoPath(path),
    sha256,
    objectKey: objectKeyForHash(sha256),
    size: bytes.byteLength,
    contentType,
    content
  };
}

export function normalizeRepoPath(path) {
  const value = String(path || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!value || value.includes("..") || value.startsWith("file:") || /^[A-Za-z]:\//.test(value)) {
    throw new Error("Unsafe file path.");
  }
  return value;
}

export function isImmutableObjectKey(key) {
  return /^objects\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/.test(String(key || ""));
}

