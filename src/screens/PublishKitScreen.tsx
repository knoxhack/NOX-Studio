import { AlertTriangle, CheckCircle2, Clipboard, Film, Hash, Image, Monitor, Package, Pencil, Rocket, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { GlassPanel } from "../components/GlassPanel";
import { SectionHeading } from "../components/SectionHeading";
import type { Project, PublishKit } from "../types";
import type { ReleasePlatform, createReleaseOperationPlan } from "../lib/noxCore";
import { isDesktop, desktopYouTube } from "../lib/desktopBridge";

type ReleaseOperationPreview = ReturnType<typeof createReleaseOperationPlan>;

type PublishKitScreenProps = {
  publishKit?: PublishKit;
  releaseOperationPlans?: ReleaseOperationPreview[];
  finalExportAssetUrl?: string;
  onCopy: (text: string, label: string) => void;
  onGenerate: () => void;
  onUpdate: (publishKit: PublishKit) => void;
  onExport: (format: "markdown" | "json" | "txt") => void;
  onExportReleaseBundle: (platform: ReleasePlatform) => void;
  onQueueReleaseOperation: (platform: ReleasePlatform) => void;
};

const releaseStatuses: Project["releaseStatus"][] = ["Studio Draft", "NOX Films Draft", "Scheduled", "Published", "Unlisted", "Private", "Archived"];

export function PublishKitScreen({
  publishKit,
  releaseOperationPlans = [],
  finalExportAssetUrl,
  onCopy,
  onGenerate,
  onUpdate,
  onExport,
  onExportReleaseBundle,
  onQueueReleaseOperation,
}: PublishKitScreenProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PublishKit | undefined>(publishKit);

  useEffect(() => {
    setDraft(publishKit);
    setEditing(false);
  }, [publishKit]);

  if (!publishKit) {
    return (
      <div className="single-screen">
        <GlassPanel>
          <SectionHeading title="Publish Kit" meta="Generate TikTok, YouTube, and NOX Films release metadata." />
          <div className="empty-state">
            <h3>No publish kit yet</h3>
            <p>Generate a publish package from the active project, Scene Cards, and NOX Films brand settings.</p>
            <button className="primary-button" type="button" onClick={onGenerate}>
              <Rocket size={18} />
              Generate Publish Kit
            </button>
          </div>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div className="single-screen">
      <GlassPanel>
        <SectionHeading
          title="Publish Kit"
          meta="TikTok, YouTube, NOX Films metadata, poster prompts, and exports."
          action={
            <div className="toolbar-row compact-toolbar">
              <button className="ghost-button small-button" type="button" onClick={onGenerate}>
                Regenerate
              </button>
              <button className="ghost-button small-button" type="button" onClick={() => setEditing((current) => !current)}>
                {editing ? <X size={15} /> : <Pencil size={15} />}
                {editing ? "Close Edit" : "Edit Metadata"}
              </button>
              <button className="ghost-button small-button" type="button" onClick={() => onExport("markdown")}>
                Export MD
              </button>
              <button className="ghost-button small-button" type="button" onClick={() => onExport("txt")}>
                Export TXT
              </button>
              <button className="ghost-button small-button" type="button" onClick={() => onExport("json")}>
                Export JSON
              </button>
              <button className="ghost-button small-button" type="button" onClick={() => onExportReleaseBundle("TikTok")}>
                TikTok Bundle
              </button>
              <button className="ghost-button small-button" type="button" onClick={() => onExportReleaseBundle("YouTube")}>
                YouTube Bundle
              </button>
              <button className="ghost-button small-button" type="button" onClick={() => onExportReleaseBundle("NOX Films")}>
                NOX Films Bundle
              </button>
            </div>
          }
        />
        <div className={finalExportAssetUrl ? "publish-readiness-banner is-ready" : "publish-readiness-banner has-blockers"}>
          {finalExportAssetUrl ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <div>
            <strong>{finalExportAssetUrl ? "Final MP4 linked" : "Render final shortfilm in NOX Cut"}</strong>
            <span>
              {finalExportAssetUrl
                ? "Release packages can include the rendered final export."
                : "Metadata is editable, but platform packages stay blocked until NOX Cut creates a Final Export asset."}
            </span>
          </div>
        </div>
        {editing && draft ? (
          <PublishKitEditor
            draft={draft}
            onChange={setDraft}
            onCancel={() => {
              setDraft(publishKit);
              setEditing(false);
            }}
            onSave={() => {
              onUpdate(draft);
              setEditing(false);
            }}
          />
        ) : null}
        <div className="release-operation-row">
          <span>{isDesktop() ? "Local Release Packages" : "Release Operations"}</span>
          {isDesktop() ? <Monitor size={14} className="desktop-mode-icon" /> : null}
          <button className="ghost-button small-button" type="button" onClick={() => onQueueReleaseOperation("TikTok")}>
            {isDesktop() ? <Package size={14} /> : <Rocket size={14} />}
            {isDesktop() ? "Create TikTok Package" : "Queue TikTok"}
          </button>
          <button className="ghost-button small-button" type="button" onClick={() => onQueueReleaseOperation("YouTube")}>
            {isDesktop() ? <Package size={14} /> : <Rocket size={14} />}
            {isDesktop() ? "Create YouTube Package" : "Queue YouTube"}
          </button>
          <button className="ghost-button small-button" type="button" onClick={() => onQueueReleaseOperation("NOX Films")}>
            {isDesktop() ? <Package size={14} /> : <Rocket size={14} />}
            {isDesktop() ? "Create NOX Films Package" : "Queue NOX Films"}
          </button>
        </div>
        {isDesktop() && publishKit ? (
          <YouTubeUploadPanel publishKit={publishKit} finalExportAssetUrl={finalExportAssetUrl} />
        ) : null}
        {releaseOperationPlans.length ? (
          <section className="release-preflight-grid" aria-label="Release operation preflight">
            {releaseOperationPlans.map((plan) => (
              <ReleasePreflightCard key={plan.platform} plan={plan} />
            ))}
          </section>
        ) : null}
        <div className="publish-grid">
          <KitPanel
            icon={<Rocket size={19} />}
            title="TikTok Kit"
            body={[
              ["Title", publishKit.tiktokTitle],
              ["Caption", publishKit.caption],
              ["Hashtags", publishKit.hashtags.join(" ")],
            ]}
            onCopy={() => onCopy(`${publishKit.tiktokTitle}\n\n${publishKit.caption}\n${publishKit.hashtags.join(" ")}`, "TikTok kit")}
          />
          <KitPanel
            icon={<Film size={19} />}
            title="YouTube Kit"
            body={[
              ["SEO Title", publishKit.youtubeTitle],
              ["Description", publishKit.description],
              ["Tags", publishKit.tags.join(", ")],
            ]}
            onCopy={() => onCopy(`${publishKit.youtubeTitle}\n\n${publishKit.description}`, "YouTube kit")}
          />
          <KitPanel
            icon={<Hash size={19} />}
            title="NOX Films Metadata"
            body={[
              ["Row", publishKit.noxFilmsRow],
              ["Runtime", publishKit.runtime],
              ["Release Status", publishKit.releaseStatus],
            ]}
            onCopy={() => onCopy(`${publishKit.noxFilmsRow}\n${publishKit.runtime}\n${publishKit.releaseStatus}`, "NOX Films metadata")}
          />
          <KitPanel
            icon={<Image size={19} />}
            title="Poster and Thumbnail Prompts"
            body={[
              ["Thumbnail Prompt", publishKit.thumbnailPrompt],
              ["Poster Prompt", publishKit.posterPrompt],
            ]}
            onCopy={() => onCopy(`${publishKit.thumbnailPrompt}\n\n${publishKit.posterPrompt}`, "Poster prompts")}
          />
        </div>
      </GlassPanel>
    </div>
  );
}

function ReleasePreflightCard({ plan }: { plan: ReleaseOperationPreview }) {
  const doneCount = plan.checklist.filter((item) => item.done).length;
  const totalCount = plan.checklist.length;
  const blockerText = plan.blockers.length ? plan.blockers.join(", ") : "No blockers";

  return (
    <article className={`release-preflight-card ${plan.ready ? "is-ready" : "has-blockers"}`}>
      <div className="release-preflight-head">
        <div>
          <span>{plan.platform}</span>
          <strong>{plan.ready ? (isDesktop() ? "Ready to package" : "Ready to schedule") : "Needs release prep"}</strong>
        </div>
        {plan.ready ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      </div>
      <div className="release-preflight-metrics">
        <span>
          <strong>Final MP4</strong>
          {plan.files.finalVideo?.filename ?? "Missing"}
        </span>
        <span>
          <strong>Scene videos</strong>
          {plan.files.approvedSceneVideos.length}
        </span>
        <span>
          <strong>Checklist</strong>
          {doneCount}/{totalCount}
        </span>
        <span>
          <strong>Schedule</strong>
          {plan.schedule.status}
        </span>
      </div>
      <div className="release-preflight-detail">
        <span>{plan.preset.aspectRatio}</span>
        <span>{plan.preset.deliveryFile}</span>
        <span>{plan.thumbnail.prompt ? "Thumbnail prompt ready" : "Thumbnail prompt missing"}</span>
      </div>
      <div className="release-preflight-blockers">
        <span>Blockers</span>
        <p>{blockerText}</p>
      </div>
    </article>
  );
}

function PublishKitEditor({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: PublishKit;
  onChange: (draft: PublishKit) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const updateField = <K extends keyof PublishKit>(key: K, value: PublishKit[K]) => {
    onChange({ ...draft, [key]: value });
  };

  return (
    <section className="publish-edit-panel">
      <div className="publish-edit-head">
        <div>
          <span>Release Metadata</span>
          <strong>{draft.tiktokTitle || draft.youtubeTitle || "Untitled Publish Kit"}</strong>
        </div>
        <div className="toolbar-row compact-toolbar">
          <button className="ghost-button small-button" type="button" onClick={onCancel}>
            <X size={15} />
            Cancel
          </button>
          <button className="primary-button small-button" type="button" onClick={onSave}>
            <Save size={15} />
            Save Metadata
          </button>
        </div>
      </div>
      <div className="publish-edit-grid">
        <TextEdit label="TikTok Title" value={draft.tiktokTitle} onChange={(value) => updateField("tiktokTitle", value)} />
        <TextEdit label="Hook Line" value={draft.hookLine} onChange={(value) => updateField("hookLine", value)} />
        <TextAreaEdit label="Caption" value={draft.caption} onChange={(value) => updateField("caption", value)} />
        <TextAreaEdit label="Hashtags" value={draft.hashtags.join("\n")} onChange={(value) => updateField("hashtags", splitLines(value))} />
        <TextEdit label="YouTube Title" value={draft.youtubeTitle} onChange={(value) => updateField("youtubeTitle", value)} />
        <TextAreaEdit label="YouTube Description" value={draft.description} onChange={(value) => updateField("description", value)} />
        <TextAreaEdit label="YouTube Tags" value={draft.tags.join("\n")} onChange={(value) => updateField("tags", splitLines(value))} />
        <TextAreaEdit label="Chapters" value={draft.chapters.join("\n")} onChange={(value) => updateField("chapters", splitLines(value))} />
        <TextEdit label="NOX Films Row" value={draft.noxFilmsRow} onChange={(value) => updateField("noxFilmsRow", value)} />
        <TextEdit label="Runtime" value={draft.runtime} onChange={(value) => updateField("runtime", value)} />
        <TextEdit label="Genre" value={draft.genre} onChange={(value) => updateField("genre", value)} />
        <label className="publish-edit-field">
          <span>Release Status</span>
          <select value={draft.releaseStatus} onChange={(event) => updateField("releaseStatus", event.target.value as Project["releaseStatus"])}>
            {releaseStatuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <TextAreaEdit label="Pinned Comment" value={draft.pinnedComment} onChange={(value) => updateField("pinnedComment", value)} />
        <TextAreaEdit label="Thumbnail Prompt" value={draft.thumbnailPrompt} onChange={(value) => updateField("thumbnailPrompt", value)} />
        <TextAreaEdit label="Poster Prompt" value={draft.posterPrompt} onChange={(value) => updateField("posterPrompt", value)} />
      </div>
    </section>
  );
}

function TextEdit({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="publish-edit-field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextAreaEdit({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="publish-edit-field span-2">
      <span>{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function splitLines(value: string) {
  return value
    .split(/\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function YouTubeUploadPanel({ publishKit, finalExportAssetUrl }: { publishKit: PublishKit; finalExportAssetUrl?: string }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [status, setStatus] = useState<{ connected: boolean; expiresAt?: number }>({ connected: false });
  const [deviceAuth, setDeviceAuth] = useState<{ userCode: string; verificationUrl: string; deviceCode: string; clientId: string; clientSecret: string; expiresIn: number; interval: number } | null>(null);
  const [polling, setPolling] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const checkStatus = async () => {
    try {
      setStatus(await desktopYouTube.getStatus());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (isDesktop()) void checkStatus();
  }, []);

  const startAuth = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      setMessage("Enter your Google OAuth Client ID and Secret.");
      return;
    }
    setMessage("");
    try {
      const auth = await desktopYouTube.startDeviceAuth({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
      setDeviceAuth(auth);
      setPolling(true);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!deviceAuth || !polling) return;
    let attempts = 0;
    const maxAttempts = Math.floor((deviceAuth.expiresIn || 300) / (deviceAuth.interval || 5));
    const timer = setInterval(async () => {
      attempts += 1;
      try {
        const result = await desktopYouTube.pollDeviceToken({
          deviceCode: deviceAuth.deviceCode,
          clientId: deviceAuth.clientId,
          clientSecret: deviceAuth.clientSecret,
        });
        if (result.status === "connected") {
          clearInterval(timer);
          setPolling(false);
          setDeviceAuth(null);
          setMessage("YouTube connected.");
          void checkStatus();
        }
      } catch (err) {
        clearInterval(timer);
        setPolling(false);
        setDeviceAuth(null);
        setMessage(err instanceof Error ? err.message : String(err));
      }
      if (attempts >= maxAttempts) {
        clearInterval(timer);
        setPolling(false);
        setDeviceAuth(null);
        setMessage("YouTube authorization timed out. Try again.");
      }
    }, (deviceAuth.interval || 5) * 1000);

    return () => clearInterval(timer);
  }, [deviceAuth, polling]);

  const upload = async () => {
    if (!finalExportAssetUrl) {
      setMessage("Render a Final Export in NOX Cut first.");
      return;
    }
    setUploading(true);
    setMessage("");
    try {
      const result = await desktopYouTube.uploadVideo({
        title: publishKit.youtubeTitle,
        description: publishKit.description,
        tags: publishKit.tags,
        privacyStatus: "private",
        videoUrl: finalExportAssetUrl,
      });
      setMessage("Uploaded: " + result.url);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const disconnect = async () => {
    try {
      await desktopYouTube.disconnect();
      setStatus({ connected: false });
      setMessage("YouTube disconnected.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="youtube-upload-panel">
      <div className="settings-head">
        <Rocket size={18} />
        <h3>YouTube Upload</h3>
        <span className={"status-pill " + (status.connected ? "active" : "")}>{status.connected ? "Connected" : "Not connected"}</span>
      </div>
      {!status.connected ? (
        <>
          <label className="settings-field span-2">
            <span>Google OAuth Client ID</span>
            <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Paste installed-app Client ID" />
          </label>
          <label className="settings-field span-2">
            <span>Google OAuth Client Secret</span>
            <input value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="Paste installed-app Client Secret" />
          </label>
          {deviceAuth ? (
            <p className="settings-note">
              Open <strong>{deviceAuth.verificationUrl}</strong> and enter code <strong>{deviceAuth.userCode}</strong>.
            </p>
          ) : null}
          <button className="primary-button small-button" type="button" onClick={startAuth} disabled={polling}>
            {polling ? "Waiting for authorization..." : "Connect YouTube"}
          </button>
        </>
      ) : (
        <>
          <button className="primary-button small-button" type="button" onClick={upload} disabled={uploading || !finalExportAssetUrl}>
            {uploading ? "Uploading..." : "Upload to YouTube"}
          </button>
          <button className="ghost-button small-button" type="button" onClick={disconnect}>
            Disconnect
          </button>
        </>
      )}
      {message ? <p className="settings-note">{message}</p> : null}
    </section>
  );
}

function KitPanel({
  icon,
  title,
  body,
  onCopy,
}: {
  icon: JSX.Element;
  title: string;
  body: [string, string][];
  onCopy: () => void;
}) {
  return (
    <article className="kit-panel">
      <div className="kit-head">
        {icon}
        <h3>{title}</h3>
      </div>
      {body.map(([label, value]) => (
        <div className="kit-field" key={label}>
          <span>{label}</span>
          <p>{value}</p>
        </div>
      ))}
      <button className="ghost-button wide-button" type="button" onClick={onCopy}>
        <Clipboard size={17} />
        Copy
      </button>
    </article>
  );
}
