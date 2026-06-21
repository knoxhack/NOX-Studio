const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "llama3.1";

export async function ollamaStatus(host = OLLAMA_HOST) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(host + "/api/tags", { method: "GET", signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return { available: false, error: `Ollama returned ${response.status}.` };
    const data = await response.json();
    const models = Array.isArray(data.models) ? data.models.map((model) => String(model.name || model.model || "")) : [];
    return { available: true, host, models };
  } catch (err) {
    return { available: false, host, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function ollamaGenerate({ prompt, model = DEFAULT_MODEL, host = OLLAMA_HOST, system, stream = false }) {
  const status = await ollamaStatus(host);
  if (!status.available) throw new Error(status.error || "Ollama is not available.");

  const response = await fetch(host + "/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      system: system || "You are a helpful assistant for a film production studio.",
      stream,
      options: { temperature: 0.7 },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Ollama generation failed (${response.status}): ${text}`);
  }

  if (stream) {
    return { stream: response.body };
  }

  const data = await response.json();
  return {
    text: String(data.response || "").trim(),
    model: data.model || model,
    done: data.done ?? true,
    totalDuration: data.total_duration,
  };
}
