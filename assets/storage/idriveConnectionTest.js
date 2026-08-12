import { createPresignedIdriveUrl } from "../../gatekeeper/presignIdrive.js";
import { assertFreePolicy, block, evaluateCostRisk, requireIdrivePresignConfig } from "../../gatekeeper/policy.js";
import { evaluateQuota } from "../../gatekeeper/quota.js";
import { createContentObject } from "./contentAddressed.js";
import { createIndexedDbStore } from "./indexedDbStore.js";
import { createMemoryOpfsStore } from "./opfsStore.js";
import { createLocalWorkspace } from "./localWorkspace.js";
import { sha256Hex } from "./checksum.js";

export async function runIdriveConnectionTest({
  env = {},
  fetchImpl = globalThis.fetch,
  metadataStore = createIndexedDbStore(),
  fileStore = createMemoryOpfsStore(),
  content = "smejj.com IDrive e2 presigned URL test\n",
  projectId = "project_idrive_connection_test",
  now = new Date()
} = {}) {
  const policy = assertFreePolicy();
  if (!policy.ok) return policy;

  const cost = evaluateCostRisk(env.IDRIVE_E2_COST_MODE || "free-safe-idrive-storage-only");
  if (!cost.ok) return cost;

  const config = requireIdrivePresignConfig(env);
  if (!config.ok) return config;

  const quota = evaluateQuota({ env, provider: "idrive-e2", operation: "presign-idrive" });
  if (!quota.ok) return quota;

  const workspace = createLocalWorkspace({ metadataStore, fileStore, onlineRef: { onLine: true } });
  const object = await createContentObject("storage/idrive-e2-test.txt", content, "text/plain; charset=utf-8");
  await workspace.createProject({ id: projectId, name: "IDrive e2 Connection Test" });

  const upload = await createPresignedIdriveUrl({
    env,
    operation: "upload",
    key: object.objectKey,
    contentType: object.contentType,
    contentLength: object.size
  });
  if (!upload.ok) return upload;
  const uploadCheck = validatePresignedEnvelope(upload, { expectedMethod: "PUT", now });
  if (!uploadCheck.ok) return uploadCheck;

  const putResponse = await fetchImpl(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: content
  });
  if (!putResponse.ok) return block(`idrive_upload_failed:${putResponse.status}`, 502);

  const download = await createPresignedIdriveUrl({
    env,
    operation: "download",
    key: object.objectKey
  });
  if (!download.ok) return download;
  const downloadCheck = validatePresignedEnvelope(download, { expectedMethod: "GET", now });
  if (!downloadCheck.ok) return downloadCheck;

  const getResponse = await fetchImpl(download.url, { method: download.method });
  if (!getResponse.ok) return block(`idrive_download_failed:${getResponse.status}`, 502);
  const downloaded = await getResponse.text();
  const downloadedSha256 = await sha256Hex(downloaded);
  if (downloadedSha256 !== object.sha256) return block("checksum_mismatch_blocked", 409);

  await workspace.saveFile(projectId, object.path, downloaded, object.contentType);
  const manifest = await workspace.getManifest(projectId);
  const restored = await workspace.restore(manifest);

  return {
    ok: true,
    upload: true,
    download: true,
    checksum: true,
    restore: restored.ok,
    objectKey: object.objectKey,
    sha256: object.sha256,
    manifestVersion: manifest.version,
    proxiedByWorker: false,
    secretsInBrowser: false
  };
}

export function validatePresignedEnvelope(envelope, { expectedMethod, now = new Date() } = {}) {
  if (!envelope?.ok) return block("presigned_url_missing_or_blocked");
  if (envelope.proxiedByWorker !== false) return block("worker_proxy_not_allowed");
  if (expectedMethod && envelope.method !== expectedMethod) return block("presigned_method_mismatch");
  if (!envelope.url || !/^https:\/\//.test(envelope.url)) return block("presigned_url_invalid");

  let url;
  try {
    url = new URL(envelope.url);
  } catch {
    return block("presigned_url_invalid");
  }
  const algorithm = url.searchParams.get("X-Amz-Algorithm");
  const signature = url.searchParams.get("X-Amz-Signature");
  const amzDate = url.searchParams.get("X-Amz-Date");
  const expires = Number(url.searchParams.get("X-Amz-Expires"));
  if (algorithm !== "AWS4-HMAC-SHA256" || !signature || !amzDate || !Number.isFinite(expires)) {
    return block("presigned_url_invalid");
  }
  if (isExpiredPresignedUrl({ amzDate, expires, now })) return block("presigned_url_expired");
  return { ok: true };
}

export function isExpiredPresignedUrl({ amzDate, expires, now = new Date() }) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(amzDate || ""));
  if (!match || !Number.isFinite(Number(expires))) return true;
  const [, year, month, day, hour, minute, second] = match;
  const created = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return now.getTime() > created + Number(expires) * 1000;
}
