import { encryptSecret, getGrokModelDefaults, resolveGrokRuntime, verifyGrokApiKey } from "../_shared/grok.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DbRow = Record<string, any>;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: corsHeaders });
  }

  try {
    const input = await request.json();
    if (input?.action === "health") {
      const runtime = await resolveGrokRuntime({
        workspaceId: asText(input.workspaceId),
        authorization: request.headers.get("authorization") ?? "",
      });
      return Response.json(
        {
          ok: true,
          function: "manage-provider-secret",
          provider: "grok",
          grokConfigured: runtime.configured,
          grokSource: runtime.source,
          grokTextModel: runtime.textModel,
          grokImageModel: runtime.imageModel,
          grokVideoModel: runtime.videoModel,
          grokStrict: runtime.strict,
          secretVaultConfigured: Boolean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") && Deno.env.get("NOX_SECRET_ENCRYPTION_KEY")),
        },
        { headers: corsHeaders },
      );
    }

    const action = asText(input?.action, "status");
    const workspaceId = asText(input?.workspaceId);
    if (!workspaceId) {
      return Response.json({ error: "workspaceId is required." }, { status: 400, headers: corsHeaders });
    }

    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization) {
      return Response.json({ error: "Authorization header is required." }, { status: 401, headers: corsHeaders });
    }

    const rest = getServiceRestConfig();
    const user = await fetchAuthenticatedUser(getAnonRestConfig(authorization));
    if (!user?.id) {
      return Response.json({ error: "Authenticated user could not be resolved." }, { status: 401, headers: corsHeaders });
    }
    await requireWorkspaceMember(rest, workspaceId, user.id);

    if (action === "status") {
      return Response.json(await getSecretStatus(rest, workspaceId), { headers: corsHeaders });
    }

    if (action === "verify") {
      const apiKey = asText(input.apiKey);
      const verification = await verifyGrokApiKey(apiKey);
      return Response.json(
        {
          providerId: "grok",
          status: verification.ok ? "Verified" : "Invalid",
          configured: verification.ok,
          verifiedModel: verification.model,
          error: verification.error,
          source: "request",
        },
        { status: verification.ok ? 200 : 400, headers: corsHeaders },
      );
    }

    if (action === "save") {
      const apiKey = asText(input.apiKey);
      const verification = await verifyGrokApiKey(apiKey);
      if (!verification.ok) {
        return Response.json(
          {
            providerId: "grok",
            status: "Invalid",
            configured: false,
            verifiedModel: verification.model,
            error: verification.error,
          },
          { status: 400, headers: corsHeaders },
        );
      }

      const encrypted = await encryptSecret(apiKey);
      const now = new Date().toISOString();
      await upsertSecret(rest, {
        workspace_id: workspaceId,
        provider_id: "grok",
        secret_kind: "api_key",
        encrypted_secret: encrypted.encryptedSecret,
        nonce: encrypted.nonce,
        key_last4: apiKey.slice(-4),
        status: "Verified",
        verified_model: verification.model,
        verified_at: now,
        created_by: user.id,
        updated_by: user.id,
        updated_at: now,
      });
      await upsertGrokProviderSettings(rest, workspaceId, {
        status: "Configured",
        keyLast4: apiKey.slice(-4),
        verifiedModel: verification.model,
        verifiedAt: now,
      });

      return Response.json(
        {
          providerId: "grok",
          status: "Saved",
          configured: true,
          keyLast4: apiKey.slice(-4),
          verifiedModel: verification.model,
          verifiedAt: now,
          source: "workspace-secret",
        },
        { headers: corsHeaders },
      );
    }

    if (action === "remove") {
      await deleteSecret(rest, workspaceId);
      await upsertGrokProviderSettings(rest, workspaceId, {
        status: "Not configured",
        keyLast4: "",
        verifiedModel: "",
        verifiedAt: "",
      });
      return Response.json(
        {
          providerId: "grok",
          status: "Not configured",
          configured: false,
          source: "missing",
        },
        { headers: corsHeaders },
      );
    }

    return Response.json({ error: `Unsupported action: ${action}.` }, { status: 400, headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Provider secret action failed." },
      { status: 500, headers: corsHeaders },
    );
  }
});

async function getSecretStatus(rest: RestConfig, workspaceId: string) {
  const rows = await fetchRows(
    rest,
    "workspace_provider_secrets",
    `workspace_id=eq.${encodeURIComponent(workspaceId)}&provider_id=eq.grok&secret_kind=eq.api_key&select=key_last4,status,verified_model,verified_at,updated_at&limit=1`,
  );
  const saved = rows[0];
  if (saved?.status === "Verified") {
    return {
      providerId: "grok",
      status: "Saved",
      configured: true,
      source: "workspace-secret",
      keyLast4: asText(saved.key_last4),
      verifiedModel: asText(saved.verified_model),
      verifiedAt: asText(saved.verified_at),
      updatedAt: asText(saved.updated_at),
    };
  }

  const runtime = await resolveGrokRuntime();
  return {
    providerId: "grok",
    status: runtime.configured ? "Verified" : "Not configured",
    configured: runtime.configured,
    source: runtime.source,
    keyLast4: "",
    verifiedModel: runtime.configured ? runtime.textModel : "",
    verifiedAt: "",
  };
}

async function upsertSecret(rest: RestConfig, row: DbRow) {
  const response = await fetch(`${rest.url}/rest/v1/workspace_provider_secrets`, {
    method: "POST",
    headers: {
      ...restHeaders(rest),
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error(await restError(response, "Provider secret save failed."));
}

async function deleteSecret(rest: RestConfig, workspaceId: string) {
  const response = await fetch(
    `${rest.url}/rest/v1/workspace_provider_secrets?workspace_id=eq.${encodeURIComponent(workspaceId)}&provider_id=eq.grok&secret_kind=eq.api_key`,
    {
      method: "DELETE",
      headers: restHeaders(rest),
    },
  );
  if (!response.ok) throw new Error(await restError(response, "Provider secret removal failed."));
}

async function upsertGrokProviderSettings(rest: RestConfig, workspaceId: string, metadata: DbRow) {
  const models = getGrokModelDefaults();
  const response = await fetch(`${rest.url}/rest/v1/provider_settings`, {
    method: "POST",
    headers: {
      ...restHeaders(rest),
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      workspace_id: workspaceId,
      provider_id: "grok",
      name: "Grok",
      supported_tasks: "Story, prompts, continuity, metadata, images, and videos",
      speed: "Fast",
      quality: "High",
      enabled: true,
      mode: "API",
      api_endpoint: "https://api.x.ai/v1",
      secret_name: "",
      webhook_enabled: false,
      connection_status: metadata.status,
      config: {
        secretSource: metadata.status === "Configured" ? "workspace-secret" : "missing",
        keyLast4: metadata.keyLast4,
        verifiedModel: metadata.verifiedModel,
        verifiedAt: metadata.verifiedAt,
        textModel: models.textModel,
        imageModel: models.imageModel,
        videoModel: models.videoModel,
      },
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(await restError(response, "Grok provider settings update failed."));
}

async function requireWorkspaceMember(rest: RestConfig, workspaceId: string, userId: string) {
  const rows = await fetchRows(
    rest,
    "workspace_members",
    `workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&select=workspace_id&limit=1`,
  );
  if (!rows.length) throw new Error("The current user is not a member of this workspace.");
}

async function fetchAuthenticatedUser(rest: RestConfig) {
  const response = await fetch(`${rest.url}/auth/v1/user`, {
    headers: {
      apikey: rest.anonKey,
      authorization: rest.authorization,
    },
  });
  if (!response.ok) return undefined;
  return (await response.json().catch(() => undefined)) as { id?: string; email?: string } | undefined;
}

async function fetchRows(rest: RestConfig, table: string, query: string) {
  const response = await fetch(`${rest.url}/rest/v1/${table}?${query}`, {
    headers: restHeaders(rest),
  });
  if (!response.ok) throw new Error(await restError(response, `Read failed for ${table}.`));
  return (await response.json()) as DbRow[];
}

type RestConfig = {
  url: string;
  anonKey: string;
  authorization: string;
};

function getAnonRestConfig(authorization: string): RestConfig {
  return {
    url: getRequiredEnv("SUPABASE_URL"),
    anonKey: getRequiredEnv("SUPABASE_ANON_KEY"),
    authorization,
  };
}

function getServiceRestConfig(): RestConfig {
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return {
    url: getRequiredEnv("SUPABASE_URL"),
    anonKey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
  };
}

function restHeaders(rest: RestConfig) {
  return {
    apikey: rest.anonKey,
    authorization: rest.authorization,
    "Content-Type": "application/json",
  };
}

async function restError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return asText(body.message, asText(body.error, fallback));
  } catch {
    return fallback;
  }
}

function getRequiredEnv(key: string) {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`${key} is required for provider secret management.`);
  return value;
}

function asText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
