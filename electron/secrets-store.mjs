import electron from "electron";
const { app, safeStorage } = electron;
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const DEFAULT_MODEL = "grok-4.3";

export function defaultStatus() {
  return {
    providerId: "grok",
    status: "Not configured",
    configured: false,
    source: "missing",
  };
}

function getSecretsDir() {
  return join(app.getPath("userData"), "secrets");
}

function getKeyPath() {
  return join(getSecretsDir(), "grok-key.bin");
}

function getMetaPath() {
  return join(getSecretsDir(), "grok-key-meta.json");
}

export async function getGrokStatus() {
  const meta = await readMeta();
  if (!meta) return defaultStatus();
  return {
    providerId: "grok",
    status: meta.status || "Saved",
    configured: true,
    source: "desktop-encrypted",
    keyLast4: meta.keyLast4,
    verifiedModel: meta.verifiedModel,
    verifiedAt: meta.verifiedAt,
    error: meta.error,
  };
}

export async function verifyGrokKey(apiKey) {
  const trimmed = (apiKey || "").trim();
  if (!trimmed) {
    return { ...defaultStatus(), status: "Invalid", error: "Enter a Grok API key first." };
  }
  if (trimmed.length < 12) {
    return { ...defaultStatus(), status: "Invalid", error: "That key is too short to use." };
  }

  try {
    const result = await fetchGrokModel(trimmed, DEFAULT_MODEL);
    if (result.ok) {
      return {
        providerId: "grok",
        status: "Verified",
        configured: true,
        source: "request",
        keyLast4: trimmed.slice(-4),
        verifiedModel: DEFAULT_MODEL,
        verifiedAt: new Date().toISOString(),
      };
    }
    const message = result.error || "Grok key verification failed.";
    return {
      providerId: "grok",
      status: "Invalid",
      configured: false,
      source: "request",
      keyLast4: trimmed.slice(-4),
      error: message,
    };
  } catch (err) {
    return {
      providerId: "grok",
      status: "Error",
      configured: false,
      source: "request",
      keyLast4: trimmed.slice(-4),
      error: err.message || "Verification request failed.",
    };
  }
}

export async function saveGrokKey(apiKey) {
  const status = await verifyGrokKey(apiKey);
  if (status.status === "Invalid" || status.status === "Error") {
    return status;
  }

  const trimmed = apiKey.trim();
  await ensureSecretsDir();
  const encrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(trimmed)
    : Buffer.from(trimmed, "utf8");
  await writeFile(getKeyPath(), encrypted);
  const meta = {
    providerId: "grok",
    status: status.status === "Verified" ? "Verified" : "Saved",
    keyLast4: trimmed.slice(-4),
    verifiedModel: status.verifiedModel,
    verifiedAt: status.verifiedAt,
    encryptedWith: safeStorage.isEncryptionAvailable() ? "safeStorage" : "none",
    savedAt: new Date().toISOString(),
  };
  await writeMeta(meta);

  return {
    ...status,
    source: "desktop-encrypted",
    status: meta.status,
  };
}

export async function removeGrokKey() {
  await ensureSecretsDir();
  try {
    await unlink(getKeyPath());
  } catch {
    // ignore
  }
  try {
    await unlink(getMetaPath());
  } catch {
    // ignore
  }
  return defaultStatus();
}

export async function loadGrokKey() {
  const keyPath = getKeyPath();
  if (!existsSync(keyPath)) return undefined;
  try {
    const encrypted = await readFile(keyPath);
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(encrypted);
    }
    return encrypted.toString("utf8");
  } catch (err) {
    console.error("Failed to load Grok key:", redactError(err));
    return undefined;
  }
}

async function fetchGrokModel(apiKey, model) {
  const url = `https://api.x.ai/v1/models/${model}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: "Invalid Grok API key." };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown error");
    return { ok: false, error: `xAI returned ${response.status}: ${text}` };
  }
  return { ok: true };
}

async function ensureSecretsDir() {
  await mkdir(getSecretsDir(), { recursive: true });
}

async function readMeta() {
  const metaPath = getMetaPath();
  if (!existsSync(metaPath)) return undefined;
  try {
    const raw = await readFile(metaPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function writeMeta(meta) {
  await ensureSecretsDir();
  await writeFile(getMetaPath(), JSON.stringify(meta, null, 2));
}

function redactError(err) {
  if (!err || !err.message) return err;
  return err.message.replace(/Bearer\s+[a-zA-Z0-9_-]{10,}/g, "Bearer [REDACTED]");
}
