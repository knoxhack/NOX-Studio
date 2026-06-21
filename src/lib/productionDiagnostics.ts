import { getSupabaseClient, getSupabaseRuntimeInfo } from "./supabaseClient";
import { assessProviderReadiness } from "./providerReadiness";
import type { Provider } from "../types";

export type DiagnosticStatus = "pass" | "warn" | "fail" | "info";

export type DiagnosticCheck = {
  id: string;
  label: string;
  status: DiagnosticStatus;
  detail: string;
};

export type ProductionDiagnosticsResult = {
  mode: "local" | "supabase";
  checkedAt: string;
  ready: boolean;
  summary: string;
  checks: DiagnosticCheck[];
};

export type ProductionDiagnosticsOptions = {
  workspaceId?: string;
};

const requiredTables = [
  "workspaces",
  "workspace_members",
  "projects",
  "scenes",
  "scene_beats",
  "assets",
  "generation_jobs",
  "publish_kits",
  "timeline_items",
  "characters",
  "worlds",
  "locations",
  "factions",
  "brand_kits",
  "provider_settings",
];

const generationFunctions = ["generate-concept", "generate-scene-prompt", "process-generation-job", "manage-provider-secret"];
const storageBuckets = ["nox-videos", "nox-images", "nox-audio", "nox-exports", "nox-brand"];

export async function runProductionDiagnostics(options: ProductionDiagnosticsOptions = {}): Promise<ProductionDiagnosticsResult> {
  const runtimeInfo = getSupabaseRuntimeInfo();
  const checkedAt = new Date().toISOString();
  const checks: DiagnosticCheck[] = [
    {
      id: "supabase-url",
      label: "Supabase URL",
      status: runtimeInfo.urlPresent ? "pass" : "warn",
      detail: runtimeInfo.urlPresent ? "VITE_SUPABASE_URL is present." : "VITE_SUPABASE_URL is not set; local demo mode is active.",
    },
    {
      id: "supabase-anon-key",
      label: "Supabase anon key",
      status: runtimeInfo.anonKeyPresent ? "pass" : "warn",
      detail: runtimeInfo.anonKeyPresent
        ? "VITE_SUPABASE_ANON_KEY is present."
        : "VITE_SUPABASE_ANON_KEY is not set; live Auth, RLS, Storage, and Edge Function checks cannot run.",
    },
  ];

  if (!runtimeInfo.configured) {
    return summarizeDiagnostics("local", checkedAt, [
      ...checks,
      {
        id: "local-mode",
        label: "Local-first fallback",
        status: "info",
        detail: "NOX Studio is using localStorage persistence and deterministic NOX Core fallbacks.",
      },
    ]);
  }

  const supabase = await getSupabaseClient();
  if (!supabase) {
    return summarizeDiagnostics("supabase", checkedAt, [
      ...checks,
      {
        id: "supabase-client",
        label: "Supabase client",
        status: "fail",
        detail: "Supabase env vars are present, but the browser client could not be created.",
      },
    ]);
  }

  const [authCheck, tableChecks, functionChecks, storageChecks, providerChecks, grokSecretCheck] = await Promise.all([
    checkAuthSession(supabase),
    checkTables(supabase),
    checkFunctions(supabase, options.workspaceId),
    checkStorageBuckets(supabase, options.workspaceId, checkedAt),
    checkProviderRoutes(supabase, options.workspaceId),
    checkGrokSecretStatus(supabase, options.workspaceId),
  ]);

  return summarizeDiagnostics("supabase", checkedAt, [...checks, authCheck, ...tableChecks, ...storageChecks, ...functionChecks, grokSecretCheck, ...providerChecks]);
}

async function checkAuthSession(supabase: Awaited<ReturnType<typeof getSupabaseClient>>): Promise<DiagnosticCheck> {
  if (!supabase) {
    return {
      id: "auth-session",
      label: "Auth session",
      status: "fail",
      detail: "Supabase client is unavailable.",
    };
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return {
      id: "auth-session",
      label: "Auth session",
      status: "fail",
      detail: error?.message ?? "No signed-in Supabase user is available for RLS checks.",
    };
  }

  return {
    id: "auth-session",
    label: "Auth session",
    status: "pass",
    detail: `Signed in as ${data.user.email ?? data.user.id}.`,
  };
}

async function checkTables(supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseClient>>>): Promise<DiagnosticCheck[]> {
  return Promise.all(
    requiredTables.map(async (table) => {
      const { error } = await supabase.from(table).select("*", { count: "exact", head: true });
      if (error) {
        return {
          id: `table-${table}`,
          label: `RLS table: ${table}`,
          status: "fail" as const,
          detail: error.message,
        };
      }

      return {
        id: `table-${table}`,
        label: `RLS table: ${table}`,
        status: "pass" as const,
        detail: "Reachable through the current authenticated session.",
      };
    }),
  );
}

async function checkStorageBuckets(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseClient>>>,
  activeWorkspaceId: string | undefined,
  checkedAt: string,
): Promise<DiagnosticCheck[]> {
  const workspace = await resolveWorkspaceId(supabase, activeWorkspaceId);
  if (!workspace.workspaceId) {
    return [
      {
        id: "storage-workspace",
        label: "Storage workspace",
        status: "fail",
        detail: workspace.error ?? "No workspace id is available for workspace-prefixed storage policy checks.",
      },
    ];
  }

  return Promise.all(
    storageBuckets.map(async (bucket) => {
      const path = `${workspace.workspaceId}/_diagnostics/${bucket}-${Date.now()}.json`;
      const body = new Blob([JSON.stringify({ bucket, checkedAt, source: "nox-production-diagnostics" })], {
        type: "application/json",
      });
      const upload = await supabase.storage.from(bucket).upload(path, body, {
        contentType: "application/json",
        upsert: true,
      });
      if (upload.error) {
        return {
          id: `storage-${bucket}`,
          label: `Storage bucket: ${bucket}`,
          status: "fail" as const,
          detail: `Upload check failed: ${upload.error.message}`,
        };
      }

      const signedUrl = await supabase.storage.from(bucket).createSignedUrl(path, 60);
      if (signedUrl.error || !signedUrl.data?.signedUrl) {
        await supabase.storage.from(bucket).remove([path]);
        return {
          id: `storage-${bucket}`,
          label: `Storage bucket: ${bucket}`,
          status: "fail" as const,
          detail: `Signed preview check failed: ${signedUrl.error?.message ?? "No signed URL returned."}`,
        };
      }

      const remove = await supabase.storage.from(bucket).remove([path]);
      if (remove.error) {
        return {
          id: `storage-${bucket}`,
          label: `Storage bucket: ${bucket}`,
          status: "fail" as const,
          detail: `Upload and signed preview worked, but cleanup failed: ${remove.error.message}`,
        };
      }

      return {
        id: `storage-${bucket}`,
        label: `Storage bucket: ${bucket}`,
        status: "pass" as const,
        detail: "Upload, signed preview, and cleanup succeeded for the active workspace path.",
      };
    }),
  );
}

async function resolveWorkspaceId(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseClient>>>,
  activeWorkspaceId?: string,
): Promise<{ workspaceId?: string; error?: string }> {
  if (activeWorkspaceId) return { workspaceId: activeWorkspaceId };

  const { data, error } = await supabase.from("workspaces").select("id").limit(1).maybeSingle();
  if (error) return { error: error.message };
  if (!data?.id) return { error: "No workspace row is visible to the current authenticated session." };
  return { workspaceId: String(data.id) };
}

type FunctionHealthResponse = {
  ok?: boolean;
  function?: string;
  grokConfigured?: boolean;
  grokSource?: string;
  grokTextModel?: string;
  grokImageModel?: string;
  grokVideoModel?: string;
  grokStrict?: boolean;
  secretVaultConfigured?: boolean;
  authRequired?: boolean;
  supabaseConfigured?: boolean;
};

type FunctionRuntimeHealth = {
  provider: string;
  configured: boolean;
  model: string;
  strict: boolean;
  strictEnv: string;
  missingSecretDetail: string;
};

async function checkFunctions(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseClient>>>,
  activeWorkspaceId?: string,
): Promise<DiagnosticCheck[]> {
  return Promise.all(
    generationFunctions.map(async (functionName) => {
      const { data, error } = await supabase.functions.invoke<FunctionHealthResponse>(functionName, {
        body: { action: "health", workspaceId: activeWorkspaceId },
      });
      if (error || !data?.ok) {
        return {
          id: `function-${functionName}`,
          label: `Edge Function: ${functionName}`,
          status: "fail" as const,
          detail: error?.message ?? "Health response did not include ok: true.",
        };
      }

      if (functionName === "process-generation-job") {
        return {
          id: `function-${functionName}`,
          label: `Edge Function: ${functionName}`,
          status: data.authRequired && data.supabaseConfigured ? "pass" as const : "fail" as const,
          detail:
            data.authRequired && data.supabaseConfigured
              ? "Authenticated Supabase job processor is deployed and can read its Supabase runtime settings."
              : "Job processor responded, but it did not report authenticated Supabase runtime readiness. Redeploy the current Edge Function.",
        };
      }

      const runtime = getFunctionRuntimeHealth(data);
      if (!runtime) {
        return {
          id: `function-${functionName}`,
          label: `Edge Function: ${functionName}`,
          status: "fail" as const,
          detail: "Function responded, but the deployed version does not report provider runtime metadata. Redeploy the current Edge Function.",
        };
      }

      if (functionName === "manage-provider-secret" && !data.secretVaultConfigured) {
        return {
          id: `function-${functionName}`,
          label: `Edge Function: ${functionName}`,
          status: "fail" as const,
          detail: "Provider secret manager needs SUPABASE_SERVICE_ROLE_KEY and NOX_SECRET_ENCRYPTION_KEY.",
        };
      }

      if (!runtime.configured) {
        return {
          id: `function-${functionName}`,
          label: `Edge Function: ${functionName}`,
          status: runtime.strict ? "fail" as const : "warn" as const,
          detail: runtime.strict
            ? `${runtime.provider} is required by ${runtime.strictEnv}, but ${functionName} does not have ${runtime.missingSecretDetail} configured.`
            : `${data.function ?? functionName} is deployed, but ${runtime.provider} is not configured; deterministic NOX Core fallback will be used.`,
        };
      }

      return {
        id: `function-${functionName}`,
        label: `Edge Function: ${functionName}`,
        status: "pass" as const,
        detail: `${data.function ?? functionName} responded with ${runtime.provider} model ${runtime.model}.`,
      };
    }),
  );
}

function getFunctionRuntimeHealth(data: FunctionHealthResponse): FunctionRuntimeHealth | undefined {
  if (typeof data.grokConfigured === "boolean" && typeof data.grokTextModel === "string") {
    return {
      provider: "Grok",
      configured: data.grokConfigured,
      model: data.grokTextModel,
      strict: Boolean(data.grokStrict),
      strictEnv: "NOX_GROK_STRICT",
      missingSecretDetail: "XAI_API_KEY or a saved Grok workspace key",
    };
  }

  return undefined;
}

async function checkGrokSecretStatus(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseClient>>>,
  activeWorkspaceId: string | undefined,
): Promise<DiagnosticCheck> {
  const workspace = await resolveWorkspaceId(supabase, activeWorkspaceId);
  if (!workspace.workspaceId) {
    return {
      id: "grok-secret-status",
      label: "Grok API key",
      status: "fail",
      detail: workspace.error ?? "No workspace id is available for Grok key status checks.",
    };
  }

  const { data, error } = await supabase.functions.invoke<{
    configured?: boolean;
    status?: string;
    source?: string;
    verifiedModel?: string;
    error?: string;
  }>("manage-provider-secret", {
    body: { action: "status", workspaceId: workspace.workspaceId },
  });

  if (error) {
    return {
      id: "grok-secret-status",
      label: "Grok API key",
      status: "fail",
      detail: error.message,
    };
  }

  return {
    id: "grok-secret-status",
    label: "Grok API key",
    status: data?.configured ? "pass" : "fail",
    detail: data?.configured
      ? `Grok key is ${data.status ?? "configured"} via ${data.source ?? "workspace"}${data.verifiedModel ? ` for ${data.verifiedModel}` : ""}.`
      : data?.error ?? "No saved Grok key or XAI_API_KEY is available.",
  };
}

async function checkProviderRoutes(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseClient>>>,
  activeWorkspaceId: string | undefined,
): Promise<DiagnosticCheck[]> {
  const workspace = await resolveWorkspaceId(supabase, activeWorkspaceId);
  if (!workspace.workspaceId) {
    return [
      {
        id: "provider-workspace",
        label: "Provider routes",
        status: "fail",
        detail: workspace.error ?? "No workspace id is available for provider_settings checks.",
      },
    ];
  }

  const { data, error } = await supabase.from("provider_settings").select("*").eq("workspace_id", workspace.workspaceId).order("provider_id");
  if (error) {
    return [
      {
        id: "provider-settings",
        label: "Provider routes",
        status: "fail",
        detail: error.message,
      },
    ];
  }

  if (!data?.length) {
    return [
      {
        id: "provider-settings",
        label: "Provider routes",
        status: "fail",
        detail: "No provider_settings rows are visible for the active workspace.",
      },
    ];
  }

  return data.map((row) => {
    const provider = providerRowToProvider(row);
    const readiness = assessProviderReadiness(provider);
    return {
      id: `provider-${provider.id}`,
      label: `Provider route: ${provider.name}`,
      status: readinessToDiagnosticStatus(readiness.status),
      detail: `${readiness.routeLabel}: ${readiness.detail}`,
    };
  });
}

function summarizeDiagnostics(mode: ProductionDiagnosticsResult["mode"], checkedAt: string, checks: DiagnosticCheck[]): ProductionDiagnosticsResult {
  const failures = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  const ready = mode === "supabase" && failures === 0 && warnings === 0;

  return {
    mode,
    checkedAt,
    ready,
    checks,
    summary: ready
      ? "Supabase production path is reachable, including Grok-backed generation."
      : mode === "local"
        ? "Local demo mode is active; configure Supabase env vars to verify live production services."
        : `${failures} failed check${failures === 1 ? "" : "s"} and ${warnings} warning${warnings === 1 ? "" : "s"} found in the Supabase production path.`,
  };
}

function providerRowToProvider(row: Record<string, unknown>): Provider {
  return {
    id: asText(row.provider_id),
    name: asText(row.name, asText(row.provider_id, "Provider")),
    supportedTasks: asText(row.supported_tasks),
    speed: asText(row.speed),
    quality: asText(row.quality),
    enabled: Boolean(row.enabled),
    mode: asProviderMode(row.mode),
    apiEndpoint: asText(row.api_endpoint) || undefined,
    secretName: asText(row.secret_name) || undefined,
    webhookEnabled: Boolean(row.webhook_enabled),
    connectionStatus: asProviderConnectionStatus(row.connection_status),
    config: asObject(row.config),
  };
}

function readinessToDiagnosticStatus(status: ReturnType<typeof assessProviderReadiness>["status"]): DiagnosticStatus {
  if (status === "ready") return "pass";
  if (status === "blocked") return "fail";
  if (status === "warning") return "warn";
  return "info";
}

function asProviderMode(value: unknown): Provider["mode"] {
  return value === "API" || value === "Local" || value === "Manual" ? value : "Manual";
}

function asProviderConnectionStatus(value: unknown): Provider["connectionStatus"] {
  return value === "Configured" || value === "Secret missing" || value === "Error" || value === "Not configured"
    ? value
    : "Not configured";
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
