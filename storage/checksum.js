export async function sha256Hex(input) {
  const bytes = toBytes(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    throw new Error("Blob input must be converted with blobToBytes before hashing.");
  }
  return new TextEncoder().encode(String(input ?? ""));
}

export async function blobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

