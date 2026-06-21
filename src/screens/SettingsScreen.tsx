import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudCog, FolderOpen, ImagePlus, KeyRound, Monitor, Palette, RefreshCw, Save, Shield, ToggleLeft, XCircle } from "lucide-react";
import { GlassPanel } from "../components/GlassPanel";
import { SectionHeading } from "../components/SectionHeading";
import { assessProviderReadiness, providerConnectionStatusFromReadiness } from "../lib/providerReadiness";
import { getGrokKeyStatus, removeGrokKey, saveGrokKey, verifyGrokKey, type GrokKeyStatus } from "../lib/providerSecrets";
import { runProductionDiagnostics, type DiagnosticStatus, type ProductionDiagnosticsResult } from "../lib/productionDiagnostics";
import { getSupabaseRuntimeInfo } from "../lib/supabaseClient";
import { isDesktop, desktopFiles, desktopApp, desktopOllama, type OllamaStatus } from "../lib/desktopBridge";
import type { BrandKit, Provider, StudioAsset } from "../types";

type SettingsScreenProps = {
  assets: StudioAsset[];
  providers: Provider[];
  brandKit: BrandKit;
  workspaceId: string;
  onUpdateBrandKit: (brandKit: BrandKit) => void;
  onUploadWatermark: (file: File) => void;
  onToggleProvider: (providerId: string, enabled: boolean) => void;
  onUpdateProvider: (provider: Provider) => void;
};

type BrandKitForm = {
  studioName: string;
  creatorName: string;
  introText: string;
  outroText: string;
  defaultStyle: string;
  defaultExport: string;
  subtitleStyle: string;
  colors: string;
  hashtags: string;
};

const listToText = (values: string[]) => values.join("\n");

const parseList = (value: string) =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeHashtags = (value: string) =>
  parseList(value).map((item) => (item.startsWith("#") ? item : `#${item.replace(/^#+/, "")}`));

const brandKitToForm = (brandKit: BrandKit): BrandKitForm => ({
  studioName: brandKit.studioName,
  creatorName: brandKit.creatorName,
  introText: brandKit.introText,
  outroText: brandKit.outroText,
  defaultStyle: brandKit.defaultStyle,
  defaultExport: brandKit.defaultExport,
  subtitleStyle: brandKit.subtitleStyle,
  colors: listToText(brandKit.colors),
  hashtags: listToText(brandKit.hashtags),
});

export function SettingsScreen({ assets, providers, brandKit, workspaceId, onUpdateBrandKit, onUploadWatermark, onToggleProvider, onUpdateProvider }: SettingsScreenProps) {
  const [form, setForm] = useState<BrandKitForm>(() => brandKitToForm(brandKit));
  const [diagnostics, setDiagnostics] = useState<ProductionDiagnosticsResult | undefined>();
  const [isCheckingProduction, setIsCheckingProduction] = useState(false);
  const watermarkInputRef = useRef<HTMLInputElement | null>(null);
  const runtimeInfo = useMemo(() => getSupabaseRuntimeInfo(), []);
  const [mediaRoot, setMediaRoot] = useState<string>("");

  useEffect(() => {
    if (isDesktop()) {
      void desktopApp.getMediaRoot().then((result) => setMediaRoot(result.path));
    }
  }, []);
  const watermarkAsset = useMemo(
    () => (brandKit.watermarkAssetId ? assets.find((asset) => asset.id === brandKit.watermarkAssetId) : undefined),
    [assets, brandKit.watermarkAssetId],
  );
  const watermarkPreviewUrl = getPreviewableBrandAssetUrl(watermarkAsset, brandKit);
  const watermarkLabel = watermarkAsset?.filename ?? brandKit.watermarkFilename ?? "No watermark asset saved";
  const watermarkLocation = watermarkAsset?.storagePath ?? brandKit.watermarkStoragePath ?? "Brand bucket path not set";

  useEffect(() => {
    setForm(brandKitToForm(brandKit));
  }, [brandKit]);

  const savedFingerprint = useMemo(() => JSON.stringify(brandKitToForm(brandKit)), [brandKit]);
  const formFingerprint = useMemo(() => JSON.stringify(form), [form]);
  const hasChanges = savedFingerprint !== formFingerprint;

  const updateField = (field: keyof BrandKitForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const saveBrandKit = () => {
    onUpdateBrandKit({
      studioName: form.studioName.trim() || "NOX Films",
      creatorName: form.creatorName.trim() || "NOX Studio",
      introText: form.introText.trim(),
      outroText: form.outroText.trim(),
      watermarkAssetId: brandKit.watermarkAssetId,
      watermarkAssetUrl: brandKit.watermarkAssetUrl,
      watermarkStoragePath: brandKit.watermarkStoragePath,
      watermarkFilename: brandKit.watermarkFilename,
      defaultStyle: form.defaultStyle.trim() || "Futuristic cyberglass cinematic",
      defaultExport: form.defaultExport.trim() || "9:16 TikTok + 16:9 YouTube",
      subtitleStyle: form.subtitleStyle.trim() || "Bold white cinematic subtitles with shadow",
      colors: parseList(form.colors),
      hashtags: normalizeHashtags(form.hashtags),
    });
  };

  const runDiagnostics = async () => {
    setIsCheckingProduction(true);
    try {
      setDiagnostics(await runProductionDiagnostics({ workspaceId }));
    } finally {
      setIsCheckingProduction(false);
    }
  };

  return (
    <div className="single-screen">
      <GlassPanel>
        <SectionHeading title="Settings" meta="Brand kit, provider routing, export presets, and workspace defaults." />
        <div className="settings-grid">
          <section className="settings-panel brand-kit-panel">
            <div className="settings-head">
              <Palette size={18} />
              <h3>Brand Kit</h3>
            </div>
            <label className="settings-field span-2">
              <span>Studio name</span>
              <input value={form.studioName} onChange={(event) => updateField("studioName", event.target.value)} />
            </label>
            <label className="settings-field span-2">
              <span>Creator name</span>
              <input value={form.creatorName} onChange={(event) => updateField("creatorName", event.target.value)} />
            </label>
            <label className="settings-field span-2">
              <span>Intro text</span>
              <textarea className="compact-textarea" value={form.introText} onChange={(event) => updateField("introText", event.target.value)} />
            </label>
            <label className="settings-field span-2">
              <span>Outro text</span>
              <textarea className="compact-textarea" value={form.outroText} onChange={(event) => updateField("outroText", event.target.value)} />
            </label>
            <div className="brand-watermark-card">
              <div className="brand-watermark-preview">
                {watermarkPreviewUrl ? <img src={watermarkPreviewUrl} alt={watermarkLabel} /> : <ImagePlus size={24} />}
              </div>
              <div>
                <span>Watermark Asset</span>
                <strong>{watermarkLabel}</strong>
                <small>{watermarkLocation}</small>
              </div>
              <button className="ghost-button small-button" type="button" onClick={() => watermarkInputRef.current?.click()}>
                <ImagePlus size={15} />
                Upload Watermark
              </button>
              <input
                ref={watermarkInputRef}
                className="sr-only"
                type="file"
                accept="image/*,.svg"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUploadWatermark(file);
                  event.currentTarget.value = "";
                }}
              />
            </div>
            <label className="settings-field span-4">
              <span>Default style</span>
              <textarea value={form.defaultStyle} onChange={(event) => updateField("defaultStyle", event.target.value)} />
            </label>
            <label className="settings-field span-2">
              <span>Default export</span>
              <textarea className="compact-textarea" value={form.defaultExport} onChange={(event) => updateField("defaultExport", event.target.value)} />
            </label>
            <label className="settings-field span-2">
              <span>Default subtitle style</span>
              <textarea className="compact-textarea" value={form.subtitleStyle} onChange={(event) => updateField("subtitleStyle", event.target.value)} />
            </label>
            <div className="settings-list-grid">
              <label>
                <span>Colors</span>
                <textarea value={form.colors} onChange={(event) => updateField("colors", event.target.value)} />
              </label>
              <label>
                <span>Hashtags</span>
                <textarea value={form.hashtags} onChange={(event) => updateField("hashtags", event.target.value)} />
              </label>
            </div>
            <button className="primary-button wide-button" type="button" onClick={saveBrandKit} disabled={!hasChanges}>
              <Save size={17} />
              Save Brand Kit
            </button>
          </section>
          <section className="settings-panel production-readiness-panel">
            <div className="settings-head">
              <CloudCog size={18} />
              <h3>Production Readiness</h3>
            </div>
            <div className="diagnostic-summary">
              <div>
                <strong>{diagnostics?.summary ?? (runtimeInfo.configured ? "Supabase env detected; run the live readiness check." : "Local demo mode active.")}</strong>
                <span>
                  {diagnostics
                    ? `Last checked ${new Date(diagnostics.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                    : runtimeInfo.configured
                      ? "Checks Auth session, RLS tables, private Storage buckets, and generation Edge Functions."
                      : isDesktop()
                ? "Desktop Local Mode is active. Supabase checks are optional advanced configuration."
                : "Set Supabase env vars to verify live Auth, RLS, Storage, and Edge Functions."}
                </span>
              </div>
              <button className="ghost-button" type="button" onClick={runDiagnostics} disabled={isCheckingProduction || isDesktop()}>
                <RefreshCw size={16} />
                {isCheckingProduction ? "Checking" : "Run Check"}
              </button>
            </div>
            <div className="diagnostic-list">
              {(diagnostics?.checks ?? getDefaultDiagnosticChecks(runtimeInfo.configured)).map((check) => (
                <div className={`diagnostic-row status-${check.status}`} key={check.id}>
                  {getDiagnosticIcon(check.status)}
                  <div>
                    <strong>{check.label}</strong>
                    <span>{check.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="settings-panel">
            <div className="settings-head">
              <KeyRound size={18} />
              <h3>AI Providers</h3>
            </div>
            <GrokKeyManager workspaceId={workspaceId} providers={providers} onProviderReady={onUpdateProvider} />
            <div className="provider-table">
              {providers.map((provider) => (
                <ProviderConnectionEditor
                  key={provider.id}
                  provider={provider}
                  onSave={onUpdateProvider}
                  onToggleProvider={onToggleProvider}
                />
              ))}
            </div>
            {isDesktop() ? <OllamaStatusCard /> : null}
          </section>
          {isDesktop() ? (
            <section className="settings-panel">
              <div className="settings-head">
                <Monitor size={18} />
                <h3>Desktop Local Mode</h3>
                <span className="status-pill active">Active</span>
              </div>
              <p className="settings-note">
                NOX Studio is running as a local Electron app. Media, renders, and release packages are saved on this machine.
              </p>
              <div className="brand-watermark-card">
                <div>
                  <span>Local Media Folder</span>
                  <strong>{mediaRoot || "Loading..."}</strong>
                </div>
                <button
                  className="ghost-button small-button"
                  type="button"
                  onClick={() => void desktopApp.openMediaFolder()}
                  disabled={!mediaRoot}
                >
                  <FolderOpen size={15} />
                  Reveal Folder
                </button>
              </div>
            </section>
          ) : null}
          <ExportPresetPanel defaultExport={form.defaultExport} onChange={(value) => updateField("defaultExport", value)} />
        </div>
      </GlassPanel>
    </div>
  );
}

function GrokKeyManager({
  workspaceId,
  providers,
  onProviderReady,
}: {
  workspaceId: string;
  providers: Provider[];
  onProviderReady: (provider: Provider) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<GrokKeyStatus>({
    providerId: "grok",
    status: "Not configured",
    configured: false,
    source: "missing",
  });
  const [isBusy, setIsBusy] = useState(false);
  const grokProvider = providers.find((provider) => provider.id === "grok");

  useEffect(() => {
    let active = true;
    void getGrokKeyStatus(workspaceId).then((result) => {
      if (active) setStatus(result);
    });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  const updateProviderFromStatus = (nextStatus: GrokKeyStatus) => {
    if (!grokProvider) return;
    onProviderReady({
      ...grokProvider,
      enabled: nextStatus.configured,
      mode: "API",
      apiEndpoint: "https://api.x.ai/v1",
      secretName: "",
      webhookEnabled: false,
      connectionStatus: nextStatus.configured ? "Configured" : nextStatus.status === "Invalid" ? "Error" : "Not configured",
      config: {
        ...grokProvider.config,
        secretSource: nextStatus.source,
        keyLast4: nextStatus.keyLast4,
        verifiedModel: nextStatus.verifiedModel,
        verifiedAt: nextStatus.verifiedAt,
      },
    });
  };

  const runAction = async (action: "verify" | "save" | "remove") => {
    setIsBusy(true);
    try {
      const key = inputRef.current?.value ?? "";
      const nextStatus =
        action === "verify"
          ? await verifyGrokKey(workspaceId, key)
          : action === "save"
            ? await saveGrokKey(workspaceId, key)
            : await removeGrokKey(workspaceId);
      setStatus(nextStatus);
      if (action !== "verify") updateProviderFromStatus(nextStatus);
      if (action === "save" && nextStatus.configured && inputRef.current) inputRef.current.value = "";
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className={`grok-key-card status-${status.status.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="grok-key-status">
        <KeyRound size={18} />
        <div>
          <strong>Grok API Key</strong>
          <span>{formatGrokStatus(status)}</span>
        </div>
      </div>
      <label className="settings-field">
        <span>Grok API key</span>
        <input ref={inputRef} type="password" autoComplete="off" placeholder="xai-..." />
      </label>
      <div className="grok-key-actions">
        <button className="ghost-button small-button" type="button" onClick={() => void runAction("verify")} disabled={isBusy}>
          <RefreshCw size={14} />
          Verify Key
        </button>
        <button className="primary-button small-button" type="button" onClick={() => void runAction("save")} disabled={isBusy}>
          <Save size={14} />
          Save Key
        </button>
        <button className="danger-button small-button" type="button" onClick={() => void runAction("remove")} disabled={isBusy || !status.configured}>
          <XCircle size={14} />
          Remove Key
        </button>
      </div>
      {status.error ? <small className="grok-key-error">{status.error}</small> : null}
    </div>
  );
}

type ProviderConnectionDraft = {
  apiEndpoint: string;
  secretName: string;
  webhookEnabled: boolean;
};

function providerToConnectionDraft(provider: Provider): ProviderConnectionDraft {
  return {
    apiEndpoint: provider.apiEndpoint ?? "",
    secretName: provider.secretName ?? "",
    webhookEnabled: provider.webhookEnabled ?? false,
  };
}

function ProviderConnectionEditor({
  provider,
  onSave,
  onToggleProvider,
}: {
  provider: Provider;
  onSave: (provider: Provider) => void;
  onToggleProvider: (providerId: string, enabled: boolean) => void;
}) {
  const [draft, setDraft] = useState<ProviderConnectionDraft>(() => providerToConnectionDraft(provider));

  useEffect(() => {
    setDraft(providerToConnectionDraft(provider));
  }, [provider]);

  const fingerprint = JSON.stringify(providerToConnectionDraft(provider));
  const draftFingerprint = JSON.stringify(draft);
  const hasChanges = fingerprint !== draftFingerprint;
  const canConfigureSecret = provider.mode === "API" && provider.id !== "grok";
  const canConfigureWebhook = provider.mode === "API" && provider.id !== "grok";
  const draftProvider: Provider = {
    ...provider,
    apiEndpoint: draft.apiEndpoint.trim(),
    secretName: draft.secretName.trim(),
    webhookEnabled: canConfigureWebhook ? draft.webhookEnabled : false,
  };
  const readiness = assessProviderReadiness(draftProvider);

  const saveProviderConnection = () => {
    const nextReadiness = assessProviderReadiness(draftProvider);
    onSave({
      ...draftProvider,
      connectionStatus: providerConnectionStatusFromReadiness(nextReadiness),
    });
  };

  return (
    <div className="provider-row">
      <div>
        <strong>{provider.name}</strong>
        <span>{provider.supportedTasks}</span>
        <small>Connection: {readiness.label}</small>
      </div>
      <span>{provider.mode}</span>
      <button
        className={provider.enabled ? "toggle is-on" : "toggle"}
        type="button"
        title={`${provider.name} enabled state`}
        onClick={() => onToggleProvider(provider.id, !provider.enabled)}
      >
        <ToggleLeft size={18} />
        {provider.enabled ? "Enabled" : "Disabled"}
      </button>
      <div className={`provider-readiness status-${readiness.status}`}>
        <div>
          <span>{readiness.routeLabel}</span>
          <strong>{readiness.label}</strong>
        </div>
        <small>{readiness.detail}</small>
        <div className="provider-readiness-meta">
          {readiness.metadata.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </div>
      {canConfigureSecret ? (
        <div className={canConfigureWebhook ? "provider-connection-fields" : "provider-connection-fields primary-provider-fields"}>
          {canConfigureWebhook ? (
            <label>
              <span>Webhook endpoint</span>
              <input
                value={draft.apiEndpoint}
                placeholder="https://provider.example/jobs"
                onChange={(event) => setDraft((current) => ({ ...current, apiEndpoint: event.target.value }))}
              />
            </label>
          ) : null}
          <label>
            <span>Supabase secret name</span>
            <input
              value={draft.secretName}
              placeholder={getProviderSecretPlaceholder(provider)}
              onChange={(event) => setDraft((current) => ({ ...current, secretName: event.target.value }))}
            />
          </label>
          {canConfigureWebhook ? (
            <label className="check-row compact-check">
              <input
                type="checkbox"
                checked={draft.webhookEnabled}
                onChange={(event) => setDraft((current) => ({ ...current, webhookEnabled: event.target.checked }))}
              />
              <span>Use API webhook</span>
            </label>
          ) : null}
          <button className="ghost-button small-button" type="button" disabled={!hasChanges} onClick={saveProviderConnection}>
            <Save size={14} />
            Save
          </button>
        </div>
      ) : null}
    </div>
  );
}

function getProviderSecretPlaceholder(provider: Provider) {
  if (provider.id === "grok") return "Managed by Grok API Key";
  return provider.secretName || "Optional Supabase secret name";
}

function formatGrokStatus(status: GrokKeyStatus) {
  if (status.status === "Saved" && status.keyLast4) {
    return `Saved key ending ${status.keyLast4}; ${status.verifiedModel || "Grok"} ready.`;
  }
  if (status.status === "Verified") return `${status.verifiedModel || "Grok"} verified.`;
  if (status.status === "Invalid") return "Invalid key.";
  if (status.status === "Error") return "Key check failed.";
  if (status.configured && status.source === "server-env") return `${status.verifiedModel || "Grok"} ready from server env.`;
  return "Not configured.";
}

function getPreviewableBrandAssetUrl(asset: StudioAsset | undefined, brandKit: BrandKit) {
  const url = asset?.fileUrl ?? brandKit.watermarkAssetUrl ?? "";
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:image/") || url.startsWith("nox-media://")) return url;
  return "";
}

function getDefaultDiagnosticChecks(isConfigured: boolean) {
  return [
    {
      id: "runtime-mode",
      label: isConfigured ? "Supabase mode" : "Local-first mode",
      status: isConfigured ? "info" : "warn",
      detail: isConfigured
        ? "Supabase environment variables are available in this build."
        : "The app is using local persistence until Supabase variables are configured.",
    },
    {
      id: "readiness-action",
      label: "Live verification",
      status: "info",
      detail: "Run the check to validate the current browser session against Auth, RLS tables, and Edge Functions.",
    },
  ] satisfies Array<{ id: string; label: string; status: DiagnosticStatus; detail: string }>;
}

function OllamaStatusCard() {
  const [status, setStatus] = useState<OllamaStatus | undefined>();
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      setStatus(await desktopOllama.status());
    } catch (err) {
      setStatus({ available: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void check();
  }, []);

  return (
    <div className="ollama-status-card">
      <div>
        <strong>Local Ollama</strong>
        <span>{status?.available ? "Available" : status ? "Not available" : "Checking..."}</span>
        <small>{status?.available ? `Models: ${status.models?.join(", ") || "unknown"}` : status?.error || "Install Ollama and start it on http://127.0.0.1:11434"}</small>
      </div>
      <button className="ghost-button small-button" type="button" onClick={check} disabled={checking}>
        <RefreshCw size={14} className={checking ? "spin" : ""} />
        {checking ? "Checking" : "Refresh"}
      </button>
    </div>
  );
}

function ExportPresetPanel({ defaultExport, onChange }: { defaultExport: string; onChange: (value: string) => void }) {
  const presets = [
    { key: "tiktok", label: "9:16 TikTok export", token: "9:16 TikTok" },
    { key: "youtube", label: "16:9 YouTube cinematic export", token: "16:9 YouTube" },
    { key: "nox", label: "NOX Films adaptive package", token: "NOX Films" },
  ];

  const active = new Set(
    defaultExport
      .split(/[,+]/)
      .map((item) => item.trim())
      .filter(Boolean),
  );

  const toggle = (token: string, checked: boolean) => {
    const next = new Set(active);
    if (checked) next.add(token);
    else next.delete(token);
    onChange(Array.from(next).join(" + "));
  };

  return (
    <section className="settings-panel export-panel">
      <div className="settings-head">
        <Shield size={18} />
        <h3>Export Presets</h3>
      </div>
      {presets.map((preset) => (
        <label className="check-row" key={preset.key}>
          <input type="checkbox" checked={active.has(preset.token)} onChange={(event) => toggle(preset.token, event.target.checked)} />
          <span>{preset.label}</span>
        </label>
      ))}
    </section>
  );
}

function getDiagnosticIcon(status: DiagnosticStatus) {
  if (status === "pass") return <CheckCircle2 size={17} />;
  if (status === "fail") return <XCircle size={17} />;
  if (status === "warn") return <AlertTriangle size={17} />;
  return <Shield size={17} />;
}
