import { Box, CheckCircle2, ClipboardCopy, DatabaseZap, FileText, FileVideo, Flag, FolderOpen, Globe2, ImagePlus, MapPin, PlayCircle, Plus, RotateCcw, Search, ShieldCheck, Trash2, UserRound, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GlassPanel } from "../components/GlassPanel";
import { SectionHeading } from "../components/SectionHeading";
import { StatusPill } from "../components/StatusPill";
import { isDesktop, desktopFiles } from "../lib/desktopBridge";
import { isImageGenerationJob, isRenderGenerationJob, isSceneVideoGenerationJob } from "../lib/workflowState";
import type { CharacterProfile, FactionEntry, GenerationJob, LocationEntry, StudioAsset, WorldEntry } from "../types";

type VaultTab = "Characters" | "World Bible" | "Locations" | "Factions" | "Asset Vault" | "Generation Queue";
type QueueLane = "This Scene" | "This Film" | "Video" | "Render" | "Images" | "Other" | "Completed";

type VaultHubProps = {
  assets: StudioAsset[];
  characters: CharacterProfile[];
  worlds: WorldEntry[];
  locations: LocationEntry[];
  factions: FactionEntry[];
  generationJobs: GenerationJob[];
  activeProjectId?: string;
  activeSceneId?: string;
  defaultQueueLane?: QueueLane;
  onUploadAsset: (file: File) => void;
  onUpdateAssetStatus: (assetId: string, status: StudioAsset["status"]) => void;
  onDeleteAsset: (assetId: string) => void;
  onUpdateGenerationJobStatus: (jobId: string, status: GenerationJob["status"]) => void;
  onRetryGenerationJob: (jobId: string) => void;
  onQueueMissingVideos: () => void;
  onQueuePublishMedia: () => void;
  onRetryFailedJobs: () => void;
  onApprovePassingAssets: () => void;
  onCopyAssetPrompt: (asset: StudioAsset) => void;
  onSaveCharacter: (character: CharacterProfile) => void;
  onDeleteCharacter: (characterId: string) => void;
  onUploadCharacterReference: (character: CharacterProfile, file: File) => void;
  onSaveWorld: (world: WorldEntry) => void;
  onDeleteWorld: (worldId: string) => void;
  onSaveLocation: (location: LocationEntry) => void;
  onDeleteLocation: (locationId: string) => void;
  onSaveFaction: (faction: FactionEntry) => void;
  onDeleteFaction: (factionId: string) => void;
};

export function VaultHub({
  assets,
  characters,
  worlds,
  locations,
  factions,
  generationJobs,
  activeProjectId,
  activeSceneId,
  defaultQueueLane = activeSceneId ? "This Scene" : activeProjectId ? "This Film" : "Video",
  onUploadAsset,
  onUpdateAssetStatus,
  onDeleteAsset,
  onUpdateGenerationJobStatus,
  onRetryGenerationJob,
  onQueueMissingVideos,
  onQueuePublishMedia,
  onRetryFailedJobs,
  onApprovePassingAssets,
  onCopyAssetPrompt,
  onSaveCharacter,
  onDeleteCharacter,
  onUploadCharacterReference,
  onSaveWorld,
  onDeleteWorld,
  onSaveLocation,
  onDeleteLocation,
  onSaveFaction,
  onDeleteFaction,
}: VaultHubProps) {
  const [tab, setTab] = useState<VaultTab>("Characters");
  const [queueLane, setQueueLane] = useState<QueueLane>(defaultQueueLane);
  const [query, setQuery] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState(characters[0]?.id ?? "");
  const [selectedWorldId, setSelectedWorldId] = useState(worlds[0]?.id ?? "");
  const [selectedLocationId, setSelectedLocationId] = useState(locations[0]?.id ?? "");
  const [selectedFactionId, setSelectedFactionId] = useState(factions[0]?.id ?? "");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredAssets = useMemo(
    () =>
      assets.filter((asset) =>
        `${asset.filename} ${asset.attachedTo} ${asset.status} ${asset.provider} ${asset.promptId ?? ""} ${asset.promptUsed ?? ""} ${asset.notes} ${asset.tags.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [assets, query],
  );
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? filteredAssets[0];
  const selectedCharacter = characters.find((character) => character.id === selectedCharacterId) ?? characters[0];
  const selectedWorld = worlds.find((world) => world.id === selectedWorldId) ?? worlds[0];
  const selectedLocation = locations.find((location) => location.id === selectedLocationId) ?? locations[0];
  const selectedFaction = factions.find((faction) => faction.id === selectedFactionId) ?? factions[0];
  const queueSummary = useMemo(() => summarizeGenerationQueue(generationJobs, assets), [assets, generationJobs]);
  const queueLanes = useMemo(
    () => createQueueLanes(generationJobs, activeProjectId, activeSceneId),
    [activeProjectId, activeSceneId, generationJobs],
  );
  const visibleQueueJobs = queueLanes.find((lane) => lane.label === queueLane)?.jobs ?? [];

  useEffect(() => {
    if ((!selectedCharacterId || !characters.some((character) => character.id === selectedCharacterId)) && characters[0]) {
      setSelectedCharacterId(characters[0].id);
    }
  }, [characters, selectedCharacterId]);

  useEffect(() => {
    if ((!selectedWorldId || !worlds.some((world) => world.id === selectedWorldId)) && worlds[0]) {
      setSelectedWorldId(worlds[0].id);
    }
  }, [worlds, selectedWorldId]);

  useEffect(() => {
    if ((!selectedLocationId || !locations.some((location) => location.id === selectedLocationId)) && locations[0]) {
      setSelectedLocationId(locations[0].id);
    }
  }, [locations, selectedLocationId]);

  useEffect(() => {
    if ((!selectedFactionId || !factions.some((faction) => faction.id === selectedFactionId)) && factions[0]) {
      setSelectedFactionId(factions[0].id);
    }
  }, [factions, selectedFactionId]);

  return (
    <div className="single-screen">
      <GlassPanel>
        <SectionHeading title="Vault" meta="Characters, worlds, assets, and generation history." />
        <div className="vault-tabs">
          {[
            { label: "Characters", icon: UserRound },
            { label: "World Bible", icon: Globe2 },
            { label: "Locations", icon: MapPin },
            { label: "Factions", icon: Flag },
            { label: "Asset Vault", icon: Box },
            { label: "Generation Queue", icon: DatabaseZap },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={tab === item.label ? "is-active" : ""}
                key={item.label}
                onClick={() => setTab(item.label as VaultTab)}
                type="button"
              >
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </div>

        {tab === "Characters" ? (
          <div className="vault-editor-layout">
            <div className="vault-record-list">
              <button
                className="primary-button small-button"
                type="button"
                onClick={() => {
                  const draft = createBlankCharacter();
                  setSelectedCharacterId(draft.id);
                  onSaveCharacter(draft);
                }}
              >
                <Plus size={15} />
                New Character
              </button>
              {characters.map((character) => (
                <button
                  className={`vault-record-button ${selectedCharacter?.id === character.id ? "is-active" : ""}`}
                  key={character.id}
                  type="button"
                  onClick={() => setSelectedCharacterId(character.id)}
                >
                  <span className="avatar-plate small-avatar">{character.name.slice(0, 2).toUpperCase()}</span>
                  <span>
                    <strong>{character.name}</strong>
                    <small>{character.role}</small>
                  </span>
                </button>
              ))}
            </div>
            <CharacterEditor
              character={selectedCharacter}
              referenceAsset={getCharacterReferenceAsset(selectedCharacter, assets)}
              onSave={onSaveCharacter}
              onDelete={onDeleteCharacter}
              onUploadReference={onUploadCharacterReference}
            />
          </div>
        ) : null}

        {tab === "World Bible" ? (
          <div className="vault-editor-layout">
            <div className="vault-record-list">
              <button
                className="primary-button small-button"
                type="button"
                onClick={() => {
                  const draft = createBlankWorld();
                  setSelectedWorldId(draft.id);
                  onSaveWorld(draft);
                }}
              >
                <Plus size={15} />
                New World
              </button>
              {worlds.map((world) => (
                <button
                  className={`vault-record-button ${selectedWorld?.id === world.id ? "is-active" : ""}`}
                  key={world.id}
                  type="button"
                  onClick={() => setSelectedWorldId(world.id)}
                >
                  <Globe2 size={17} />
                  <span>
                    <strong>{world.name}</strong>
                    <small>{world.tone}</small>
                  </span>
                </button>
              ))}
            </div>
            <WorldEditor world={selectedWorld} onSave={onSaveWorld} onDelete={onDeleteWorld} />
          </div>
        ) : null}

        {tab === "Locations" ? (
          <div className="vault-editor-layout">
            <div className="vault-record-list">
              <button
                className="primary-button small-button"
                type="button"
                onClick={() => {
                  const draft = createBlankLocation(worlds[0]?.id);
                  setSelectedLocationId(draft.id);
                  onSaveLocation(draft);
                }}
              >
                <Plus size={15} />
                New Location
              </button>
              {locations.map((location) => (
                <button
                  className={`vault-record-button ${selectedLocation?.id === location.id ? "is-active" : ""}`}
                  key={location.id}
                  type="button"
                  onClick={() => setSelectedLocationId(location.id)}
                >
                  <MapPin size={17} />
                  <span>
                    <strong>{location.name}</strong>
                    <small>{worlds.find((world) => world.id === location.worldId)?.name ?? "Unlinked world"}</small>
                  </span>
                </button>
              ))}
            </div>
            <LocationEditor
              location={selectedLocation}
              worlds={worlds}
              onSave={onSaveLocation}
              onDelete={onDeleteLocation}
            />
          </div>
        ) : null}

        {tab === "Factions" ? (
          <div className="vault-editor-layout">
            <div className="vault-record-list">
              <button
                className="primary-button small-button"
                type="button"
                onClick={() => {
                  const draft = createBlankFaction(worlds[0]?.id);
                  setSelectedFactionId(draft.id);
                  onSaveFaction(draft);
                }}
              >
                <Plus size={15} />
                New Faction
              </button>
              {factions.map((faction) => (
                <button
                  className={`vault-record-button ${selectedFaction?.id === faction.id ? "is-active" : ""}`}
                  key={faction.id}
                  type="button"
                  onClick={() => setSelectedFactionId(faction.id)}
                >
                  <Flag size={17} />
                  <span>
                    <strong>{faction.name}</strong>
                    <small>{worlds.find((world) => world.id === faction.worldId)?.name ?? "Unlinked world"}</small>
                  </span>
                </button>
              ))}
            </div>
            <FactionEditor
              faction={selectedFaction}
              worlds={worlds}
              onSave={onSaveFaction}
              onDelete={onDeleteFaction}
            />
          </div>
        ) : null}

        {tab === "Asset Vault" ? (
          <div className="asset-section">
            <div className="toolbar-row">
              <label className="search-box">
                <Search size={17} />
                <input placeholder="Search assets and tags" value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>
              <button className="primary-button small-button" type="button" onClick={() => fileInputRef.current?.click()}>
                Upload Asset
              </button>
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept="video/*,image/*,audio/*,.txt,.md,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUploadAsset(file);
                  event.currentTarget.value = "";
                }}
              />
            </div>
            <div className="asset-vault-layout">
              <div className="asset-table">
                <div className="asset-row asset-head">
                  <span>File</span>
                  <span>Attached To</span>
                  <span>Status</span>
                  <span>Provider</span>
                </div>
                {filteredAssets.map((asset) => (
                  <button
                    className={`asset-row ${selectedAsset?.id === asset.id ? "is-active" : ""}`}
                    key={asset.id}
                    type="button"
                    onClick={() => setSelectedAssetId(asset.id)}
                  >
                    <span className="asset-file-cell">
                      <FileVideo size={16} />
                      <span>
                        <strong>{asset.filename}</strong>
                        <small>{asset.promptUsed ? "Prompt snapshot saved" : asset.type}</small>
                      </span>
                    </span>
                    <span>{asset.attachedTo}</span>
                    <span><StatusPill label={asset.status} compact /></span>
                    <span>{asset.provider}</span>
                  </button>
                ))}
              </div>
              <AssetPreview
                asset={selectedAsset}
                onUpdateStatus={onUpdateAssetStatus}
                onDeleteAsset={onDeleteAsset}
                onCopyAssetPrompt={onCopyAssetPrompt}
              />
            </div>
          </div>
        ) : null}

        {tab === "Generation Queue" ? (
          <div className="queue-list">
            <div className="queue-operator-band">
              <div>
                <span>Production Operator</span>
                <strong>{queueSummary.open} open jobs</strong>
                <p>{queueSummary.readyAssets} review assets ready; {queueSummary.failed} failed jobs; {queueSummary.running} running.</p>
              </div>
              <div className="queue-operator-actions">
                <button className="ghost-button small-button" type="button" onClick={onQueueMissingVideos}>
                  <FileVideo size={14} />
                  Queue Missing Videos
                </button>
                <button className="ghost-button small-button" type="button" onClick={onQueuePublishMedia}>
                  <ImagePlus size={14} />
                  Queue Publish Media
                </button>
                <button className="ghost-button small-button" type="button" onClick={onRetryFailedJobs}>
                  <RotateCcw size={14} />
                  Retry Failed
                </button>
                <button className="success-button small-button" type="button" onClick={onApprovePassingAssets}>
                  <ShieldCheck size={14} />
                  Approve Passing
                </button>
              </div>
            </div>
            <div className="queue-lane-tabs" role="tablist" aria-label="Generation queue lanes">
              {queueLanes.map((lane) => (
                <button
                  className={queueLane === lane.label ? "is-active" : ""}
                  key={lane.label}
                  type="button"
                  onClick={() => setQueueLane(lane.label)}
                >
                  {lane.label}
                  <strong>{lane.jobs.length}</strong>
                </button>
              ))}
            </div>
            {visibleQueueJobs.length ? (
              visibleQueueJobs.map((job) => (
                <GenerationQueueJob
                  job={job}
                  key={job.id}
                  onRetryGenerationJob={onRetryGenerationJob}
                  onUpdateGenerationJobStatus={onUpdateGenerationJobStatus}
                />
              ))
            ) : (
              <article className="empty-card">
                <strong>No jobs in {queueLane}</strong>
                <p>Queue a scene clip, render the film, generate publish media, or upload provider files to create reviewable work.</p>
              </article>
            )}
          </div>
        ) : null}
      </GlassPanel>
    </div>
  );
}

function createQueueLanes(generationJobs: GenerationJob[], activeProjectId?: string, activeSceneId?: string) {
  const activeJobs = generationJobs.filter((job) => !["Completed", "Approved"].includes(job.status));
  const completedJobs = generationJobs.filter((job) => ["Completed", "Approved"].includes(job.status));
  const laneDefs: Array<{ label: QueueLane; jobs: GenerationJob[] }> = [
    {
      label: "This Scene",
      jobs: activeSceneId ? activeJobs.filter((job) => job.sceneId === activeSceneId) : [],
    },
    {
      label: "This Film",
      jobs: activeProjectId ? activeJobs.filter((job) => job.projectId === activeProjectId) : [],
    },
    {
      label: "Video",
      jobs: activeJobs.filter(isSceneVideoGenerationJob),
    },
    {
      label: "Render",
      jobs: activeJobs.filter(isRenderGenerationJob),
    },
    {
      label: "Images",
      jobs: activeJobs.filter(isImageGenerationJob),
    },
    {
      label: "Other",
      jobs: activeJobs.filter((job) => !isSceneVideoGenerationJob(job) && !isRenderGenerationJob(job) && !isImageGenerationJob(job)),
    },
    {
      label: "Completed",
      jobs: completedJobs,
    },
  ];

  return laneDefs;
}

function GenerationQueueJob({
  job,
  onUpdateGenerationJobStatus,
  onRetryGenerationJob,
}: {
  job: GenerationJob;
  onUpdateGenerationJobStatus: (jobId: string, status: GenerationJob["status"]) => void;
  onRetryGenerationJob: (jobId: string) => void;
}) {
  const recentLogs = (job.logs ?? []).slice(-3).reverse();
  const usageSummary = summarizeUsageMetadata(job.usageMetadata);

  return (
    <article className={`queue-item ${job.status === "Failed" ? "has-error" : ""}`}>
      <div className="queue-icon" aria-hidden="true">
        <DatabaseZap size={18} />
      </div>
      <div className="queue-job-main">
        <div className="queue-job-heading">
          <div>
            <strong>{job.task}</strong>
            <p>{job.project} / {job.provider}</p>
          </div>
          <StatusPill label={job.status} compact />
        </div>
        <small className="queue-payload">{job.outputPayload || job.inputPayload}</small>
        <details className="queue-advanced-details">
          <summary>Advanced Details</summary>
          <div className="queue-metrics" aria-label={`${job.task} queue metadata`}>
            <span className="queue-metric">
              <strong>Attempt</strong>
              {formatJobAttempt(job)}
            </span>
            <span className="queue-metric">
              <strong>Due</strong>
              {formatQueueDate(job.runAfter, "Now")}
            </span>
            <span className="queue-metric">
              <strong>Started</strong>
              {formatQueueDate(job.startedAt, "Not started")}
            </span>
            <span className="queue-metric">
              <strong>Completed</strong>
              {formatQueueDate(job.completedAt, "Open")}
            </span>
            <span className="queue-metric">
              <strong>Priority</strong>
              {job.priority ?? 0}
            </span>
            <span className="queue-metric">
              <strong>Lock</strong>
              {job.lockedAt ? `${job.lockedBy ?? "worker"} at ${formatQueueDate(job.lockedAt, "locked")}` : "Unlocked"}
            </span>
            <span className="queue-metric">
              <strong>Estimate</strong>
              {job.cost}
            </span>
            <span className="queue-metric">
              <strong>Actual</strong>
              {formatActualJobCost(job)}
            </span>
            {job.providerJobId ? (
              <span className="queue-metric">
                <strong>Provider Job</strong>
                {job.providerJobId}
              </span>
            ) : null}
          </div>
          {usageSummary.length || job.providerResponse ? (
            <div className="queue-usage" aria-label={`${job.task} usage metadata`}>
              {usageSummary.map((item) => (
                <span key={item}>{item}</span>
              ))}
              {job.providerResponse ? <span>Response: {formatMetadataValue(job.providerResponse)}</span> : null}
            </div>
          ) : null}
          {recentLogs.length ? (
            <div className="queue-log-block">
              <span>Recent logs</span>
              <ol className="queue-logs">
                {recentLogs.map((log) => (
                  <li key={log}>{log}</li>
                ))}
              </ol>
            </div>
          ) : null}
          {job.errorMessage ? <small className="queue-error">Error: {job.errorMessage}</small> : null}
        </details>
      </div>
      <div className="queue-actions" aria-label={`${job.task} actions`}>
        <button className="ghost-button small-button" type="button" disabled={job.status === "Running"} onClick={() => onUpdateGenerationJobStatus(job.id, "Running")}>
          <PlayCircle size={14} />
          Run
        </button>
        <button className="ghost-button small-button" type="button" disabled={job.status === "Completed"} onClick={() => onUpdateGenerationJobStatus(job.id, "Completed")}>
          <CheckCircle2 size={14} />
          Complete
        </button>
        <button className="ghost-button small-button" type="button" disabled={job.status === "Needs Review"} onClick={() => onUpdateGenerationJobStatus(job.id, "Needs Review")}>
          <DatabaseZap size={14} />
          Review
        </button>
        <button className="success-button small-button" type="button" disabled={job.status === "Approved"} onClick={() => onUpdateGenerationJobStatus(job.id, "Approved")}>
          <ShieldCheck size={14} />
          Approve
        </button>
        <button className="danger-button small-button" type="button" disabled={job.status === "Failed"} onClick={() => onUpdateGenerationJobStatus(job.id, "Failed")}>
          <XCircle size={14} />
          Fail
        </button>
        <button className="ghost-button small-button" type="button" disabled={(job.retryCount ?? 0) >= (job.maxRetries ?? 2)} onClick={() => onRetryGenerationJob(job.id)}>
          <RotateCcw size={14} />
          Retry
        </button>
      </div>
    </article>
  );
}

function summarizeGenerationQueue(generationJobs: GenerationJob[], assets: StudioAsset[]) {
  return {
    open: generationJobs.filter((job) => ["Queued", "Running", "Needs Review", "Failed"].includes(job.status)).length,
    running: generationJobs.filter((job) => job.status === "Running").length,
    failed: generationJobs.filter((job) => job.status === "Failed").length,
    readyAssets: assets.filter((asset) => asset.status === "Needs Review").length,
  };
}

function formatJobAttempt(job: GenerationJob) {
  return `${(job.retryCount ?? 0) + 1}/${(job.maxRetries ?? 2) + 1}`;
}

function formatActualJobCost(job: GenerationJob) {
  if (typeof job.costActual !== "number" || !Number.isFinite(job.costActual)) return "Not reported";
  const currency = job.costCurrency || "USD";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 4 }).format(job.costActual);
  } catch {
    return `${job.costActual.toFixed(4)} ${currency}`;
  }
}

function formatQueueDate(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function summarizeUsageMetadata(metadata: GenerationJob["usageMetadata"]) {
  if (!metadata) return [];
  return Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== "")
    .slice(0, 5)
    .map(([key, value]) => `${formatMetadataKey(key)}: ${formatMetadataValue(value)}`);
}

function formatMetadataKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMetadataValue(value: unknown) {
  if (typeof value === "string") return value.length > 72 ? `${value.slice(0, 72)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object") {
    const text = JSON.stringify(value);
    return text.length > 72 ? `${text.slice(0, 72)}...` : text;
  }
  return "null";
}

function CharacterEditor({
  character,
  referenceAsset,
  onSave,
  onDelete,
  onUploadReference,
}: {
  character?: CharacterProfile;
  referenceAsset?: StudioAsset;
  onSave: (character: CharacterProfile) => void;
  onDelete: (characterId: string) => void;
  onUploadReference: (character: CharacterProfile, file: File) => void;
}) {
  const [draft, setDraft] = useState<CharacterProfile | undefined>(character);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const referencePreviewUrl = getPreviewableReferenceUrl(referenceAsset?.fileUrl) ?? getPreviewableReferenceUrl(draft?.referenceImageUrl);

  useEffect(() => {
    setDraft(character);
  }, [character]);

  if (!draft) {
    return (
      <section className="vault-edit-panel">
        <strong>No character selected</strong>
        <p>Create a character to define prompt identity, wardrobe, voice, accent, and negative rules.</p>
      </section>
    );
  }

  return (
    <section className="vault-edit-panel">
      <div className="vault-edit-head">
        <div>
          <span>Character Profile</span>
          <h3>{draft.name || "Untitled Character"}</h3>
        </div>
        <button className="danger-button small-button" type="button" onClick={() => onDelete(draft.id)}>
          <Trash2 size={15} />
          Delete
        </button>
      </div>
      <div className="vault-form-grid">
        <TextField label="Name" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
        <TextField label="Alias" value={draft.alias} onChange={(value) => setDraft({ ...draft, alias: value })} />
        <TextField label="Role" value={draft.role} onChange={(value) => setDraft({ ...draft, role: value })} />
        <TextField label="Accent" value={draft.accent} onChange={(value) => setDraft({ ...draft, accent: value })} />
        <TextAreaField label="Personality" value={draft.personality} onChange={(value) => setDraft({ ...draft, personality: value })} />
        <TextAreaField label="Backstory" value={draft.backstory} onChange={(value) => setDraft({ ...draft, backstory: value })} />
        <TextAreaField label="Voice Rules" value={draft.voice} onChange={(value) => setDraft({ ...draft, voice: value })} />
        <TextAreaField label="Visual Identity" value={draft.visualIdentity} onChange={(value) => setDraft({ ...draft, visualIdentity: value })} />
        <TextField
          label="Reference Image URL"
          value={draft.referenceImageUrl ?? ""}
          onChange={(value) => setDraft({ ...draft, referenceImageUrl: value })}
        />
        <div className="character-reference-card">
          <div className="character-reference-preview">
            {referencePreviewUrl ? (
              <img src={referencePreviewUrl} alt={`${draft.name || "Character"} reference`} />
            ) : (
              <ImagePlus size={32} />
            )}
          </div>
          <div>
            <span>Reference Asset</span>
            <strong>{referenceAsset?.filename ?? (draft.referenceImageUrl ? getReferenceLabel(draft.referenceImageUrl) : "No reference image")}</strong>
          </div>
          <button className="ghost-button small-button" type="button" onClick={() => referenceInputRef.current?.click()}>
            <ImagePlus size={15} />
            Upload Reference
          </button>
          <input
            ref={referenceInputRef}
            className="sr-only"
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUploadReference(draft, file);
              event.currentTarget.value = "";
            }}
          />
        </div>
        <TextAreaField label="Prompt Identity" value={draft.promptIdentity} onChange={(value) => setDraft({ ...draft, promptIdentity: value })} />
        <TextAreaField
          label="Wardrobe Rules"
          value={(draft.wardrobeRules ?? []).join("\n")}
          onChange={(value) => setDraft({ ...draft, wardrobeRules: splitLines(value) })}
        />
        <TextAreaField
          label="Negative Rules"
          value={(draft.negativeRules ?? []).join("\n")}
          onChange={(value) => setDraft({ ...draft, negativeRules: splitLines(value) })}
        />
        <TextAreaField
          label="Appears In"
          value={(draft.appearsIn ?? []).join("\n")}
          onChange={(value) => setDraft({ ...draft, appearsIn: splitLines(value) })}
        />
      </div>
      <button className="primary-button wide-button" type="button" onClick={() => onSave(draft)}>
        Save Character
      </button>
    </section>
  );
}

function WorldEditor({
  world,
  onSave,
  onDelete,
}: {
  world?: WorldEntry;
  onSave: (world: WorldEntry) => void;
  onDelete: (worldId: string) => void;
}) {
  const [draft, setDraft] = useState<WorldEntry | undefined>(world);

  useEffect(() => {
    setDraft(world);
  }, [world]);

  if (!draft) {
    return (
      <section className="vault-edit-panel">
        <strong>No world selected</strong>
        <p>Create a world bible entry to define locations, factions, symbols, technology, and visual continuity rules.</p>
      </section>
    );
  }

  return (
    <section className="vault-edit-panel">
      <div className="vault-edit-head">
        <div>
          <span>World Bible Entry</span>
          <h3>{draft.name || "Untitled World"}</h3>
        </div>
        <button className="danger-button small-button" type="button" onClick={() => onDelete(draft.id)}>
          <Trash2 size={15} />
          Delete
        </button>
      </div>
      <div className="vault-form-grid">
        <TextField label="Name" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
        <TextField label="Tone" value={draft.tone} onChange={(value) => setDraft({ ...draft, tone: value })} />
        <TextAreaField label="Description" value={draft.description} onChange={(value) => setDraft({ ...draft, description: value })} />
        <TextAreaField
          label="Locations"
          value={(draft.locations ?? []).join("\n")}
          onChange={(value) => setDraft({ ...draft, locations: splitLines(value) })}
        />
        <TextAreaField
          label="Visual Rules"
          value={(draft.visualRules ?? []).join("\n")}
          onChange={(value) => setDraft({ ...draft, visualRules: splitLines(value) })}
        />
        <TextAreaField
          label="Technology"
          value={(draft.technology ?? []).join("\n")}
          onChange={(value) => setDraft({ ...draft, technology: splitLines(value) })}
        />
        <TextAreaField
          label="Factions"
          value={(draft.factions ?? []).join("\n")}
          onChange={(value) => setDraft({ ...draft, factions: splitLines(value) })}
        />
        <TextAreaField
          label="Recurring Symbols"
          value={(draft.recurringSymbols ?? []).join("\n")}
          onChange={(value) => setDraft({ ...draft, recurringSymbols: splitLines(value) })}
        />
        <TextAreaField
          label="Timeline"
          value={(draft.timeline ?? []).join("\n")}
          onChange={(value) => setDraft({ ...draft, timeline: splitLines(value) })}
        />
      </div>
      <button className="primary-button wide-button" type="button" onClick={() => onSave(draft)}>
        Save World
      </button>
    </section>
  );
}

function LocationEditor({
  location,
  worlds,
  onSave,
  onDelete,
}: {
  location?: LocationEntry;
  worlds: WorldEntry[];
  onSave: (location: LocationEntry) => void;
  onDelete: (locationId: string) => void;
}) {
  const [draft, setDraft] = useState<LocationEntry | undefined>(location);

  useEffect(() => {
    setDraft(location);
  }, [location]);

  if (!draft) {
    return (
      <section className="vault-edit-panel">
        <strong>No location selected</strong>
        <p>Create a location to make Scene Card geography and visual rules reusable.</p>
      </section>
    );
  }

  return (
    <section className="vault-edit-panel">
      <div className="vault-edit-head">
        <div>
          <span>Location Record</span>
          <h3>{draft.name || "Untitled Location"}</h3>
        </div>
        <button className="danger-button small-button" type="button" onClick={() => onDelete(draft.id)}>
          <Trash2 size={15} />
          Delete
        </button>
      </div>
      <div className="vault-form-grid">
        <TextField label="Name" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
        <WorldSelect worlds={worlds} value={draft.worldId ?? ""} onChange={(value) => setDraft({ ...draft, worldId: value || undefined })} />
        <TextAreaField label="Description" value={draft.description} onChange={(value) => setDraft({ ...draft, description: value })} />
        <TextAreaField
          label="Visual Rules"
          value={(draft.visualRules ?? []).join("\n")}
          onChange={(value) => setDraft({ ...draft, visualRules: splitLines(value) })}
        />
        <TextAreaField
          label="Timeline Notes"
          value={(draft.timelineNotes ?? []).join("\n")}
          onChange={(value) => setDraft({ ...draft, timelineNotes: splitLines(value) })}
        />
      </div>
      <button className="primary-button wide-button" type="button" onClick={() => onSave(draft)}>
        Save Location
      </button>
    </section>
  );
}

function FactionEditor({
  faction,
  worlds,
  onSave,
  onDelete,
}: {
  faction?: FactionEntry;
  worlds: WorldEntry[];
  onSave: (faction: FactionEntry) => void;
  onDelete: (factionId: string) => void;
}) {
  const [draft, setDraft] = useState<FactionEntry | undefined>(faction);

  useEffect(() => {
    setDraft(faction);
  }, [faction]);

  if (!draft) {
    return (
      <section className="vault-edit-panel">
        <strong>No faction selected</strong>
        <p>Create a faction to preserve group identity, visual rules, and negative rules across Scene Cards.</p>
      </section>
    );
  }

  return (
    <section className="vault-edit-panel">
      <div className="vault-edit-head">
        <div>
          <span>Faction Record</span>
          <h3>{draft.name || "Untitled Faction"}</h3>
        </div>
        <button className="danger-button small-button" type="button" onClick={() => onDelete(draft.id)}>
          <Trash2 size={15} />
          Delete
        </button>
      </div>
      <div className="vault-form-grid">
        <TextField label="Name" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
        <WorldSelect worlds={worlds} value={draft.worldId ?? ""} onChange={(value) => setDraft({ ...draft, worldId: value || undefined })} />
        <TextAreaField label="Description" value={draft.description} onChange={(value) => setDraft({ ...draft, description: value })} />
        <TextAreaField
          label="Visual Rules"
          value={(draft.visualRules ?? []).join("\n")}
          onChange={(value) => setDraft({ ...draft, visualRules: splitLines(value) })}
        />
        <TextAreaField
          label="Negative Rules"
          value={(draft.negativeRules ?? []).join("\n")}
          onChange={(value) => setDraft({ ...draft, negativeRules: splitLines(value) })}
        />
        <TextAreaField
          label="Timeline Notes"
          value={(draft.timelineNotes ?? []).join("\n")}
          onChange={(value) => setDraft({ ...draft, timelineNotes: splitLines(value) })}
        />
      </div>
      <button className="primary-button wide-button" type="button" onClick={() => onSave(draft)}>
        Save Faction
      </button>
    </section>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span>{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function WorldSelect({
  worlds,
  value,
  onChange,
}: {
  worlds: WorldEntry[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>World</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Unlinked world</option>
        {worlds.map((world) => (
          <option key={world.id} value={world.id}>
            {world.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getCharacterReferenceAsset(character: CharacterProfile | undefined, assets: StudioAsset[]) {
  if (!character) return undefined;
  return (
    assets.find((asset) => asset.characterId === character.id && asset.tags.includes("character-reference")) ??
    assets.find((asset) => asset.characterId === character.id && asset.type === "Image")
  );
}

function getPreviewableReferenceUrl(value?: string) {
  if (!value) return undefined;
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:image/")) return value;
  return undefined;
}

function getReferenceLabel(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? value;
}

function createBlankCharacter(): CharacterProfile {
  return {
    id: makeVaultId(),
    workspaceId: "",
    name: "New Character",
    alias: "Alias",
    role: "Role",
    personality: "Personality and behavior under pressure.",
    backstory: "Backstory notes.",
    voice: "Spanish voice style and delivery rules.",
    accent: "Central American Spanish",
    wardrobeRules: ["Consistent wardrobe rule"],
    visualIdentity: "Visual identity for image and video prompts.",
    referenceImageUrl: "",
    promptIdentity: "Prompt-safe character identity used during scene generation.",
    negativeRules: ["Do not change face"],
    appearsIn: [],
  };
}

function createBlankWorld(): WorldEntry {
  return {
    id: makeVaultId(),
    workspaceId: "",
    name: "New World",
    description: "World description and story context.",
    tone: "Cinematic",
    locations: ["Primary location"],
    visualRules: ["Consistent lighting and location rules"],
    technology: ["Signature technology"],
    factions: ["Faction"],
    recurringSymbols: ["Recurring symbol"],
    timeline: ["Timeline anchor"],
  };
}

function createBlankLocation(worldId?: string): LocationEntry {
  return {
    id: makeVaultId(),
    workspaceId: "",
    worldId,
    name: "New Location",
    description: "Location description and story use.",
    visualRules: ["Consistent location visual rule"],
    timelineNotes: ["Timeline anchor for this place"],
  };
}

function createBlankFaction(worldId?: string): FactionEntry {
  return {
    id: makeVaultId(),
    workspaceId: "",
    worldId,
    name: "New Faction",
    description: "Faction purpose and story pressure.",
    visualRules: ["Consistent faction visual rule"],
    negativeRules: ["Do not change faction identity"],
    timelineNotes: ["Timeline anchor for this faction"],
  };
}

function makeVaultId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return "";
}

function AssetPreview({
  asset,
  onUpdateStatus,
  onDeleteAsset,
  onCopyAssetPrompt,
}: {
  asset?: StudioAsset;
  onUpdateStatus: (assetId: string, status: StudioAsset["status"]) => void;
  onDeleteAsset: (assetId: string) => void;
  onCopyAssetPrompt: (asset: StudioAsset) => void;
}) {
  if (!asset) {
    return (
      <aside className="asset-preview-panel">
        <strong>No asset selected</strong>
        <p>Upload or select a file to review metadata and preview supported media.</p>
      </aside>
    );
  }

  return (
    <aside className="asset-preview-panel">
      <div className="asset-preview-frame">
        {asset.fileUrl && asset.type === "Video" ? <video controls src={asset.fileUrl} /> : null}
        {asset.fileUrl && (asset.type === "Image" || asset.type === "Poster" || asset.type === "Brand File") ? <img src={asset.fileUrl} alt={asset.filename} /> : null}
        {asset.fileUrl && asset.type === "Audio" ? <audio controls src={asset.fileUrl} /> : null}
        {asset.fileUrl && (asset.type === "Prompt Export" || asset.type === "Final Export") ? (
          <div className="export-preview-card">
            <FileText size={38} />
            <a className="ghost-button small-button" href={asset.fileUrl} download={asset.filename}>
              Download Export
            </a>
          </div>
        ) : null}
        {!asset.fileUrl ? (
          <>
            <FileVideo size={38} />
            <span>Preview unavailable. Upload or generate a media asset to see it here.</span>
          </>
        ) : null}
      </div>
      <div className="asset-preview-meta">
        <strong>{asset.filename}</strong>
        <span>{asset.type} / {asset.mimeType || "unknown type"}</span>
        <span>{asset.attachedTo}</span>
        <span>Provider lineage: {asset.provider}</span>
        <span>Prompt ID: {asset.promptId || "Not linked"}</span>
        <StatusPill label={asset.status} compact />
        <p>{asset.notes}</p>
        {asset.promptUsed ? (
          <div className="asset-prompt-snapshot">
            <span>Prompt Used</span>
            <p>{summarizePrompt(asset.promptUsed)}</p>
          </div>
        ) : null}
      </div>
      <div className="asset-review-actions">
        {asset.promptUsed ? (
          <button className="ghost-button small-button" type="button" onClick={() => onCopyAssetPrompt(asset)}>
            <ClipboardCopy size={15} />
            Copy Prompt Used
          </button>
        ) : null}
        {isDesktop() && asset.fileUrl ? (
          <button
            className="ghost-button small-button"
            type="button"
            onClick={() => void desktopFiles.revealInFolder(asset.fileUrl!)}
          >
            <FolderOpen size={15} />
            Reveal in Folder
          </button>
        ) : null}
        <button className="success-button small-button" type="button" onClick={() => onUpdateStatus(asset.id, "Approved")}>
          Approve
        </button>
        <button className="ghost-button small-button" type="button" onClick={() => onUpdateStatus(asset.id, "Needs Review")}>
          Needs Review
        </button>
        <button className="danger-button small-button" type="button" onClick={() => onUpdateStatus(asset.id, "Rejected")}>
          Reject
        </button>
        <button className="danger-button small-button" type="button" onClick={() => onDeleteAsset(asset.id)}>
          <Trash2 size={15} />
          Delete Asset
        </button>
      </div>
    </aside>
  );
}

function summarizePrompt(prompt: string) {
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact.length > 360 ? `${compact.slice(0, 360)}...` : compact;
}
