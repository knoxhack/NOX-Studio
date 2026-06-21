const XAI_API_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_GROK_TEXT_MODEL = "grok-4.3";
const DEFAULT_GROK_IMAGE_MODEL = "grok-imagine-image-quality";
const DEFAULT_GROK_VIDEO_MODEL = "grok-imagine-video";

type DbRow = Record<string, any>;

type RuntimeOptions = {
  workspaceId?: string;
  authorization?: string;
  apiKey?: string;
};

type StructuredOutputRequest = RuntimeOptions & {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  developerPrompt: string;
  userPrompt: string;
  verbosity?: "low" | "medium" | "high";
};

type StructuredOutputResult<T> = {
  data?: T;
  source: "grok-chat" | "nox-core-fallback";
  model: string;
  error?: string;
};

export type GrokRuntime = {
  apiKey: string;
  configured: boolean;
  source: "workspace-secret" | "server-env" | "request" | "missing";
  textModel: string;
  imageModel: string;
  videoModel: string;
  strict: boolean;
};

export function getGrokModelDefaults() {
  return {
    textModel: Deno.env.get("NOX_GROK_TEXT_MODEL") ?? DEFAULT_GROK_TEXT_MODEL,
    imageModel: Deno.env.get("NOX_GROK_IMAGE_MODEL") ?? DEFAULT_GROK_IMAGE_MODEL,
    videoModel: Deno.env.get("NOX_GROK_VIDEO_MODEL") ?? DEFAULT_GROK_VIDEO_MODEL,
  };
}

export async function resolveGrokRuntime(options: RuntimeOptions = {}): Promise<GrokRuntime> {
  const models = getGrokModelDefaults();
  const requestedKey = options.apiKey?.trim() ?? "";
  if (requestedKey) {
    return {
      apiKey: requestedKey,
      configured: true,
      source: "request",
      strict: isGrokStrict(),
      ...models,
    };
  }

  const workspaceKey = await getWorkspaceGrokSecret(options.workspaceId, options.authorization);
  if (workspaceKey) {
    return {
      apiKey: workspaceKey,
      configured: true,
      source: "workspace-secret",
      strict: isGrokStrict(),
      ...models,
    };
  }

  const envKey = Deno.env.get("XAI_API_KEY") ?? Deno.env.get("NOX_GROK_API_KEY") ?? "";
  return {
    apiKey: envKey,
    configured: Boolean(envKey),
    source: envKey ? "server-env" : "missing",
    strict: isGrokStrict(),
    ...models,
  };
}

export async function requestStructuredOutput<T>(request: StructuredOutputRequest): Promise<StructuredOutputResult<T>> {
  const runtime = await resolveGrokRuntime(request);

  if (!runtime.configured) {
    return handleGrokFallback<T>("XAI_API_KEY or saved Grok workspace key is not configured.", runtime.textModel, runtime.strict);
  }

  try {
    const response = await fetch(`${XAI_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: runtime.textModel,
        messages: [
          { role: "system", content: request.developerPrompt },
          { role: "user", content: request.userPrompt },
        ],
        temperature: 0.4,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: request.name,
            description: request.description,
            schema: request.schema,
            strict: true,
          },
        },
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = extractGrokError(payload) ?? `Grok request failed with HTTP ${response.status}.`;
      return handleGrokFallback<T>(message, runtime.textModel, runtime.strict);
    }

    const outputText = extractChatCompletionText(payload);
    if (!outputText) {
      return handleGrokFallback<T>("Grok returned no structured output text.", runtime.textModel, runtime.strict);
    }

    return {
      data: JSON.parse(outputText) as T,
      source: "grok-chat",
      model: runtime.textModel,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return handleGrokFallback<T>(message, runtime.textModel, runtime.strict);
  }
}

export async function verifyGrokApiKey(apiKey: string, model = getGrokModelDefaults().textModel) {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { ok: false, status: 400, model, error: "Grok API key is required." };
  }

  try {
    const response = await fetch(`${XAI_API_BASE_URL}/models/${encodeURIComponent(model)}`, {
      headers: {
        Authorization: `Bearer ${trimmed}`,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        model,
        error: extractGrokError(payload) ?? `Grok key verification failed with HTTP ${response.status}.`,
      };
    }
    return {
      ok: true,
      status: response.status,
      model: asText(payload.id, model),
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      model,
      error: error instanceof Error ? error.message : "Grok key verification failed.",
    };
  }
}

export async function requestGrokImage(prompt: string, options: RuntimeOptions = {}) {
  const runtime = await resolveGrokRuntime(options);
  if (!runtime.configured) throw new Error("Grok image generation needs XAI_API_KEY or a saved workspace key.");

  const response = await fetch(`${XAI_API_BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: runtime.imageModel,
      prompt,
      n: 1,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(extractGrokError(payload) ?? `Grok image generation failed with HTTP ${response.status}.`);
  return payload;
}

export async function requestGrokVideo(prompt: string, options: RuntimeOptions = {}) {
  const runtime = await resolveGrokRuntime(options);
  if (!runtime.configured) throw new Error("Grok video generation needs XAI_API_KEY or a saved workspace key.");

  const response = await fetch(`${XAI_API_BASE_URL}/video/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: runtime.videoModel,
      prompt,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(extractGrokError(payload) ?? `Grok video generation failed with HTTP ${response.status}.`);
  return payload;
}

export async function encryptSecret(secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getAesKey();
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret));
  return {
    encryptedSecret: bytesToBase64(new Uint8Array(encrypted)),
    nonce: bytesToBase64(iv),
  };
}

export async function decryptSecret(encryptedSecret: string, nonce: string) {
  const key = await getAesKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(nonce) },
    key,
    base64ToBytes(encryptedSecret),
  );
  return new TextDecoder().decode(decrypted);
}

async function getWorkspaceGrokSecret(workspaceId = "", authorization = "") {
  if (!workspaceId || !authorization) return "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!serviceRoleKey || !supabaseUrl || !anonKey) return "";

  const user = await fetchAuthenticatedUser(supabaseUrl, anonKey, authorization);
  if (!user?.id) return "";
  const headers = serviceHeaders(serviceRoleKey);
  const member = await fetch(`${supabaseUrl}/rest/v1/workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(user.id)}&select=workspace_id&limit=1`, {
    headers,
  });
  if (!member.ok) return "";
  const memberRows = await member.json().catch(() => []);
  if (!Array.isArray(memberRows) || !memberRows.length) return "";

  const secretResponse = await fetch(
    `${supabaseUrl}/rest/v1/workspace_provider_secrets?workspace_id=eq.${encodeURIComponent(workspaceId)}&provider_id=eq.grok&secret_kind=eq.api_key&status=eq.Verified&select=encrypted_secret,nonce&limit=1`,
    { headers },
  );
  if (!secretResponse.ok) return "";
  const rows = await secretResponse.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row?.encrypted_secret || !row?.nonce) return "";
  return decryptSecret(row.encrypted_secret, row.nonce);
}

async function fetchAuthenticatedUser(supabaseUrl: string, anonKey: string, authorization: string) {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization,
    },
  });
  if (!response.ok) return undefined;
  return (await response.json().catch(() => undefined)) as { id?: string; email?: string } | undefined;
}

function serviceHeaders(serviceRoleKey: string) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

function isGrokStrict() {
  return (Deno.env.get("NOX_GROK_STRICT") ?? "1") !== "0";
}

function handleGrokFallback<T>(message: string, model: string, strict: boolean): StructuredOutputResult<T> {
  if (strict) throw new Error(`Grok generation is strict and unavailable: ${message}`);
  return { source: "nox-core-fallback", model, error: message };
}

function extractGrokError(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const maybeError = (payload as { error?: { message?: unknown } | string }).error;
  if (typeof maybeError === "string") return maybeError;
  return typeof maybeError?.message === "string" ? maybeError.message : undefined;
}

function extractChatCompletionText(payload: unknown) {
  const choices = (payload as { choices?: unknown })?.choices;
  if (!Array.isArray(choices)) return "";
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  if (typeof content === "string") return content.trim();
  return "";
}

async function getAesKey() {
  const rawSecret = Deno.env.get("NOX_SECRET_ENCRYPTION_KEY") ?? "";
  if (!rawSecret) throw new Error("NOX_SECRET_ENCRYPTION_KEY is required for provider secret encryption.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawSecret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function asText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
