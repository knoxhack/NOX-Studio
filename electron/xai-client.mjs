const DEFAULT_TEXT_MODEL = "grok-4.3";
const DEFAULT_IMAGE_MODEL = "grok-imagine-image-quality";
const DEFAULT_VIDEO_MODEL = "grok-imagine-video";
const BASE_URL = "https://api.x.ai/v1";

export function getDefaultModels() {
  return {
    text: DEFAULT_TEXT_MODEL,
    image: DEFAULT_IMAGE_MODEL,
    video: DEFAULT_VIDEO_MODEL,
  };
}

function redactHeaders(headers) {
  const copy = { ...headers };
  if (copy.Authorization) copy.Authorization = "Bearer [REDACTED]";
  return copy;
}

function makeClient(apiKey) {
  if (!apiKey) throw new Error("Grok API key is not configured.");
  return {
    apiKey,
    async request(path, options = {}) {
      const url = `${BASE_URL}${path}`;
      const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      };
      const response = await fetch(url, {
        ...options,
        headers,
      });
      const text = await response.text().catch(() => "{}");
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
      if (!response.ok) {
        const errorMessage = data?.error?.message || data?.error || `xAI ${options.method || "GET"} ${path} returned ${response.status}`;
        throw new Error(errorMessage);
      }
      return data;
    },
  };
}

export async function generateStructuredText(apiKey, { prompt, schema, model = DEFAULT_TEXT_MODEL, temperature = 0.7 }) {
  const client = makeClient(apiKey);
  const response_format = schema
    ? {
        type: "json_object",
        schema,
      }
    : { type: "json_object" };

  const payload = {
    model,
    messages: [
      { role: "system", content: "You are a helpful assistant that always returns valid JSON." },
      { role: "user", content: prompt },
    ],
    response_format,
    temperature,
  };

  const startedAt = Date.now();
  const data = await client.request("/chat/completions", { method: "POST", body: JSON.stringify(payload) });
  const elapsedMs = Date.now() - startedAt;

  const choice = data.choices?.[0];
  const rawContent = choice?.message?.content || "";
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    parsed = { raw: rawContent };
  }

  return {
    ok: true,
    data: parsed,
    model: data.model || model,
    providerJobId: data.id,
    usage: data.usage || {},
    elapsedMs,
    providerResponseSummary: summarizeResponse(data),
  };
}

export async function generateText(apiKey, { prompt, model = DEFAULT_TEXT_MODEL, temperature = 0.7 }) {
  const client = makeClient(apiKey);
  const payload = {
    model,
    messages: [
      { role: "system", content: "You are a helpful creative assistant." },
      { role: "user", content: prompt },
    ],
    temperature,
  };

  const startedAt = Date.now();
  const data = await client.request("/chat/completions", { method: "POST", body: JSON.stringify(payload) });
  const elapsedMs = Date.now() - startedAt;

  const content = data.choices?.[0]?.message?.content || "";
  return {
    ok: true,
    text: content,
    model: data.model || model,
    providerJobId: data.id,
    usage: data.usage || {},
    elapsedMs,
    providerResponseSummary: summarizeResponse(data),
  };
}

export async function generateImage(apiKey, { prompt, model = DEFAULT_IMAGE_MODEL, n = 1, size = "1024x1024", responseFormat = "url" }) {
  const client = makeClient(apiKey);
  const payload = {
    model,
    prompt,
    n,
    size,
    response_format: responseFormat,
  };

  const startedAt = Date.now();
  const data = await client.request("/images/generations", { method: "POST", body: JSON.stringify(payload) });
  const elapsedMs = Date.now() - startedAt;

  const image = data.data?.[0];
  if (!image) {
    throw new Error("Grok image generation returned no image data.");
  }

  let buffer;
  let mimeType = "image/png";
  if (image.url) {
    const fetched = await fetch(image.url);
    if (!fetched.ok) throw new Error(`Failed to download generated image: ${fetched.status}`);
    buffer = Buffer.from(await fetched.arrayBuffer());
    mimeType = fetched.headers.get("content-type") || mimeType;
  } else if (image.b64_json) {
    buffer = Buffer.from(image.b64_json, "base64");
  } else {
    throw new Error("Grok image generation returned no downloadable image.");
  }

  return {
    ok: true,
    buffer,
    mimeType,
    width: parseDimension(size, "width"),
    height: parseDimension(size, "height"),
    model: data.model || model,
    providerJobId: data.id,
    usage: data.usage || {},
    elapsedMs,
    providerResponseSummary: summarizeResponse(data),
  };
}

export async function generateVideo(apiKey, { prompt, model = DEFAULT_VIDEO_MODEL }) {
  const client = makeClient(apiKey);
  const payload = {
    model,
    prompt,
  };

  const startedAt = Date.now();
  const data = await client.request("/videos/generations", { method: "POST", body: JSON.stringify(payload) });
  const elapsedMs = Date.now() - startedAt;

  if (data.data?.[0]?.url) {
    const url = data.data[0].url;
    const fetched = await fetch(url);
    if (!fetched.ok) throw new Error(`Failed to download generated video: ${fetched.status}`);
    const buffer = Buffer.from(await fetched.arrayBuffer());
    const mimeType = fetched.headers.get("content-type") || "video/mp4";
    return {
      ok: true,
      buffer,
      mimeType,
      model: data.model || model,
      providerJobId: data.id,
      usage: data.usage || {},
      elapsedMs,
      providerResponseSummary: summarizeResponse(data),
    };
  }

  if (data.id || data.job_id || data.data?.[0]?.id) {
    const jobId = data.id || data.job_id || data.data[0].id;
    return {
      ok: true,
      async: true,
      jobId,
      model: data.model || model,
      usage: data.usage || {},
      elapsedMs,
      providerResponseSummary: summarizeResponse(data),
    };
  }

  throw new Error("Grok video generation returned no video URL or async job id.");
}

export async function getVideoJobStatus(apiKey, jobId, model = DEFAULT_VIDEO_MODEL) {
  const client = makeClient(apiKey);
  const data = await client.request(`/videos/generations/${jobId}`);

  if (data.data?.[0]?.url || data.url) {
    const url = data.data?.[0]?.url || data.url;
    const fetched = await fetch(url);
    if (!fetched.ok) throw new Error(`Failed to download async video: ${fetched.status}`);
    const buffer = Buffer.from(await fetched.arrayBuffer());
    const mimeType = fetched.headers.get("content-type") || "video/mp4";
    return {
      status: "completed",
      buffer,
      mimeType,
      model: data.model || model,
      providerJobId: data.id || jobId,
      usage: data.usage || {},
      providerResponseSummary: summarizeResponse(data),
    };
  }

  const status = data.status || data.data?.[0]?.status || "processing";
  return {
    status: normalizeVideoStatus(status),
    model: data.model || model,
    providerJobId: data.id || jobId,
    usage: data.usage || {},
    providerResponseSummary: summarizeResponse(data),
  };
}

export async function pollVideoJob(apiKey, jobId, options = {}) {
  const { maxAttempts = 60, intervalMs = 5000, onStatus } = options;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await getVideoJobStatus(apiKey, jobId);
    if (onStatus) onStatus(result);
    if (result.status === "completed") return result;
    if (result.status === "failed") throw new Error("Grok video generation failed.");
    await sleep(intervalMs);
  }
  throw new Error("Grok video generation timed out.");
}

function normalizeVideoStatus(status) {
  const lower = String(status).toLowerCase();
  if (lower === "succeeded" || lower === "success" || lower === "completed") return "completed";
  if (lower === "failed" || lower === "error") return "failed";
  return "processing";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDimension(size, dimension) {
  const match = String(size).match(/(\d+)x(\d+)/);
  if (!match) return undefined;
  return dimension === "width" ? Number(match[1]) : Number(match[2]);
}

function summarizeResponse(data) {
  if (!data || typeof data !== "object") return {};
  const { id, model, object, created, usage, data: responseData } = data;
  return {
    id,
    model,
    object,
    created,
    usage,
    dataCount: Array.isArray(responseData) ? responseData.length : undefined,
  };
}

export function estimateCost(model, usage = {}) {
  // Rough placeholder estimates; xAI pricing changes and should be updated.
  const rates = {
    "grok-4.3": { input: 3, output: 15 },
    "grok-imagine-image-quality": { image: 0.07 },
    "grok-imagine-video": { video: 0.5 },
  };
  const rate = rates[model] || {};
  if (usage.prompt_tokens && usage.completion_tokens) {
    const inputCost = ((usage.prompt_tokens || 0) / 1_000_000) * (rate.input || 0);
    const outputCost = ((usage.completion_tokens || 0) / 1_000_000) * (rate.output || 0);
    return Number((inputCost + outputCost).toFixed(6));
  }
  if (usage.total_tokens) {
    return Number(((usage.total_tokens / 1_000_000) * (rate.input || rate.output || 0)).toFixed(6));
  }
  return undefined;
}
