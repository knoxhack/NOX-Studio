import type { Provider } from "../types";

export type ProviderReadinessStatus = "ready" | "warning" | "blocked" | "disabled";

export type ProviderReadiness = {
  status: ProviderReadinessStatus;
  label: string;
  routeLabel: string;
  detail: string;
  metadata: string[];
};

export function assessProviderReadiness(provider: Provider): ProviderReadiness {
  if (!provider.enabled) {
    return {
      status: "disabled",
      label: "Disabled",
      routeLabel: `${provider.mode} route`,
      detail: "This workspace route is off.",
      metadata: [`Mode: ${provider.mode}`],
    };
  }

  if (provider.mode === "Manual") {
    return {
      status: "ready",
      label: "Manual route ready",
      routeLabel: "Manual handoff",
      detail: "Prompt copy, provider upload, and Scene Card review stay available.",
      metadata: ["Browser-safe: no raw provider key stored", `Quality: ${provider.quality}`],
    };
  }

  if (provider.mode === "Local") {
    return {
      status: "ready",
      label: "Local route ready",
      routeLabel: "Local worker",
      detail: "Jobs can route to a local/offline provider process.",
      metadata: [`Speed: ${provider.speed}`, `Quality: ${provider.quality}`],
    };
  }

  if (provider.id === "grok") {
    const config = provider.config ?? {};
    const keyLast4 = typeof config.keyLast4 === "string" ? config.keyLast4 : "";
    const verifiedModel = typeof config.verifiedModel === "string" ? config.verifiedModel : "";
    return provider.connectionStatus === "Configured" || keyLast4 || verifiedModel
      ? {
          status: provider.connectionStatus === "Error" ? "blocked" : "ready",
          label: provider.connectionStatus === "Error" ? "Grok route error" : "Grok route ready",
          routeLabel: "Supabase Edge Functions",
          detail: "Story, prompt, continuity, metadata, image, and video jobs use the saved Grok workspace secret or server XAI_API_KEY.",
          metadata: [
            "Structured Outputs",
            keyLast4 ? `Key: ...${keyLast4}` : "Key: server env",
            verifiedModel ? `Model: ${verifiedModel}` : `Status: ${provider.connectionStatus ?? "Configured"}`,
          ],
        }
      : {
          status: "blocked",
          label: "Missing Grok key",
          routeLabel: "Supabase Edge Functions",
          detail: "Add a Grok API key in Settings or set XAI_API_KEY on the Supabase Edge runtime.",
          metadata: ["Expected: saved workspace key or XAI_API_KEY"],
        };
  }

  if (!provider.webhookEnabled) {
    return {
      status: "warning",
      label: "Manual fallback",
      routeLabel: "API webhook off",
      detail: "Enabled video jobs will remain provider handoff packages until webhook routing is enabled.",
      metadata: [provider.secretName ? `Secret: ${provider.secretName}` : "Secret: not set"],
    };
  }

  const endpoint = provider.apiEndpoint?.trim() ?? "";
  const secretName = provider.secretName?.trim() ?? "";
  const endpointStatus = getEndpointStatus(endpoint);

  if (!endpoint || !secretName) {
    return {
      status: "blocked",
      label: "Webhook incomplete",
      routeLabel: "API webhook",
      detail: "API-mode providers need both a webhook endpoint and a Supabase secret name.",
      metadata: [endpoint ? "Endpoint: set" : "Endpoint: missing", secretName ? `Secret: ${secretName}` : "Secret: missing"],
    };
  }

  if (endpointStatus === "invalid") {
    return {
      status: "blocked",
      label: "Endpoint invalid",
      routeLabel: "API webhook",
      detail: "Provider endpoint must be a valid HTTP or HTTPS URL.",
      metadata: [`Endpoint: ${endpoint}`, `Secret: ${secretName}`],
    };
  }

  if (provider.connectionStatus === "Secret missing" || provider.connectionStatus === "Error") {
    return {
      status: "blocked",
      label: provider.connectionStatus,
      routeLabel: "API webhook",
      detail: "The server-side job processor could not complete the configured provider route.",
      metadata: [`Endpoint: ${endpoint}`, `Secret: ${secretName}`],
    };
  }

  return {
    status: endpointStatus === "local" ? "warning" : "ready",
    label: endpointStatus === "local" ? "Local endpoint" : "API route ready",
    routeLabel: "API webhook",
    detail:
      endpointStatus === "local"
        ? "Webhook routing is configured for a local endpoint; use HTTPS for hosted production."
        : "Jobs can route server-side and receive token-protected provider callbacks.",
    metadata: [`Endpoint: ${endpoint}`, `Secret: ${secretName}`, `Status: ${provider.connectionStatus ?? "Configured"}`],
  };
}

export function providerConnectionStatusFromReadiness(readiness: ProviderReadiness): Provider["connectionStatus"] {
  if (readiness.status === "ready") return "Configured";
  if (readiness.label === "Secret missing") return "Secret missing";
  if (readiness.status === "blocked") return "Error";
  return "Not configured";
}

function getEndpointStatus(endpoint: string) {
  try {
    const url = new URL(endpoint);
    if (!["http:", "https:"].includes(url.protocol)) return "invalid";
    if (url.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return "invalid";
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1") return "local";
    return "hosted";
  } catch {
    return "invalid";
  }
}
