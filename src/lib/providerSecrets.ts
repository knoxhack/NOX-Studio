import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient";
import { isDesktop, desktopSecrets } from "./desktopBridge";

export type GrokKeyStatus = {
  providerId: "grok";
  status: "Not configured" | "Verified" | "Saved" | "Invalid" | "Error";
  configured: boolean;
  source: "workspace-secret" | "server-env" | "request" | "local-memory" | "missing" | "desktop-encrypted";
  keyLast4?: string;
  verifiedModel?: string;
  verifiedAt?: string;
  error?: string;
};

let localGrokKey = "";

export async function getGrokKeyStatus(workspaceId: string): Promise<GrokKeyStatus> {
  if (isDesktop()) {
    return desktopSecrets.grokStatus();
  }

  if (!isSupabaseConfigured) {
    return localGrokKey
      ? {
          providerId: "grok",
          status: "Saved",
          configured: true,
          source: "local-memory",
          keyLast4: localGrokKey.slice(-4),
          verifiedModel: "local demo",
        }
      : defaultStatus();
  }

  const result = await invokeSecretFunction(workspaceId, { action: "status", workspaceId });
  return normalizeStatus(result);
}

export async function verifyGrokKey(workspaceId: string, apiKey: string): Promise<GrokKeyStatus> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { ...defaultStatus(), status: "Invalid", error: "Enter a Grok API key first." };
  }

  if (isDesktop()) {
    return desktopSecrets.verifyGrokKey(trimmed);
  }

  if (!isSupabaseConfigured) {
    return {
      providerId: "grok",
      status: trimmed.length >= 12 ? "Verified" : "Invalid",
      configured: trimmed.length >= 12,
      source: "request",
      keyLast4: trimmed.length >= 4 ? trimmed.slice(-4) : "",
      verifiedModel: trimmed.length >= 12 ? "local demo" : "",
      error: trimmed.length >= 12 ? "" : "That key is too short to use.",
    };
  }

  const result = await invokeSecretFunction(workspaceId, { action: "verify", workspaceId, apiKey: trimmed });
  return normalizeStatus(result);
}

export async function saveGrokKey(workspaceId: string, apiKey: string): Promise<GrokKeyStatus> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { ...defaultStatus(), status: "Invalid", error: "Enter a Grok API key first." };
  }

  if (isDesktop()) {
    return desktopSecrets.saveGrokKey(trimmed);
  }

  if (!isSupabaseConfigured) {
    localGrokKey = trimmed;
    return {
      providerId: "grok",
      status: "Saved",
      configured: true,
      source: "local-memory",
      keyLast4: trimmed.slice(-4),
      verifiedModel: "local demo",
      verifiedAt: new Date().toISOString(),
    };
  }

  const result = await invokeSecretFunction(workspaceId, { action: "save", workspaceId, apiKey: trimmed });
  return normalizeStatus(result);
}

export async function removeGrokKey(workspaceId: string): Promise<GrokKeyStatus> {
  if (isDesktop()) {
    return desktopSecrets.removeGrokKey();
  }

  if (!isSupabaseConfigured) {
    localGrokKey = "";
    return defaultStatus();
  }

  const result = await invokeSecretFunction(workspaceId, { action: "remove", workspaceId });
  return normalizeStatus(result);
}

async function invokeSecretFunction(workspaceId: string, body: Record<string, unknown>): Promise<Partial<GrokKeyStatus>> {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    return { ...defaultStatus(), status: "Error", error: "Supabase is not configured." };
  }

  const { data, error } = await supabase.functions.invoke<GrokKeyStatus>("manage-provider-secret", { body: { ...body, workspaceId } });
  if (error) {
    return { ...defaultStatus(), status: "Error", error: error.message || "Grok key action failed." };
  }
  return data ?? defaultStatus();
}

function normalizeStatus(value: Partial<GrokKeyStatus> | undefined): GrokKeyStatus {
  if (!value) return defaultStatus();
  const status = isKnownStatus(value.status) ? value.status : value.configured ? "Saved" : "Not configured";
  return {
    providerId: "grok",
    status,
    configured: Boolean(value.configured),
    source: isKnownSource(value.source) ? value.source : value.configured ? "workspace-secret" : "missing",
    keyLast4: value.keyLast4,
    verifiedModel: value.verifiedModel,
    verifiedAt: value.verifiedAt,
    error: value.error,
  };
}

function defaultStatus(): GrokKeyStatus {
  return {
    providerId: "grok",
    status: "Not configured",
    configured: false,
    source: "missing",
  };
}

function isKnownStatus(value: unknown): value is GrokKeyStatus["status"] {
  return value === "Not configured" || value === "Verified" || value === "Saved" || value === "Invalid" || value === "Error";
}

function isKnownSource(value: unknown): value is GrokKeyStatus["source"] {
  return value === "workspace-secret" || value === "server-env" || value === "request" || value === "local-memory" || value === "missing" || value === "desktop-encrypted";
}
