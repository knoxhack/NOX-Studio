import {
  CheckCircle2,
  Clipboard,
  Clapperboard,
  FileVideo,
  ShieldCheck,
  TriangleAlert,
  Play,
  Plus,
  RefreshCcw,
  Send,
  Settings,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ContinuityReport, GenerationJob, SceneBeat, SceneCard, SceneStatus, StudioAsset } from "../types";
import type { GenerationMode, SceneVideoState } from "../lib/workflowState";
import { GlassPanel } from "../components/GlassPanel";
import { SectionHeading } from "../components/SectionHeading";
import { StatusPill } from "../components/StatusPill";

type SceneComposerProps = {
  scenes: SceneCard[];
  selectedScene: SceneCard;
  projectProvider?: string;
  promptProviders: readonly string[];
  sceneJobs: GenerationJob[];
  sceneVideoState: SceneVideoState;
  generationMode: GenerationMode;
  onSelectScene: (sceneId: string) => void;
  sceneAsset?: StudioAsset;
  onCopyPrompt: (sceneId: string, provider: string, label?: string) => void;
  onSelectProvider: (sceneId: string, provider: string) => void;
  onUpdateStatus: (sceneId: string, status: SceneStatus) => void;
  onAttachVideo: (sceneId: string, file: File) => void;
  onRegeneratePrompt: (sceneId: string, provider?: string) => void;
  onPolishPrompt: (sceneId: string, provider: string) => void;
  onGenerateVideo: (sceneId: string) => void;
  onRunSceneJob: (jobId: string) => void;
  onOpenProviderSettings: () => void;
  onUpdateScene: (scene: SceneCard) => void;
  onAddScene: () => void;
  onDeleteScene: (sceneId: string) => void;
  continuityReport?: ContinuityReport;
};

export function SceneComposer({
  scenes,
  selectedScene,
  projectProvider = "Universal Prompt",
  promptProviders,
  sceneJobs,
  sceneVideoState,
  generationMode,
  sceneAsset,
  onSelectScene,
  onCopyPrompt,
  onSelectProvider,
  onUpdateStatus,
  onAttachVideo,
  onRegeneratePrompt,
  onPolishPrompt,
  onGenerateVideo,
  onRunSceneJob,
  onOpenProviderSettings,
  onUpdateScene,
  onAddScene,
  onDeleteScene,
  continuityReport,
}: SceneComposerProps) {
  const [tab, setTab] = useState<"brief" | "prompt" | "video">("brief");
  const [promptProvider, setPromptProvider] = useState(selectedScene.promptProvider ?? projectProvider);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasSceneVideo = Boolean(sceneAsset || selectedScene.uploadedAsset);
  const hasApprovedSceneVideo = Boolean(sceneAsset?.status === "Approved" || selectedScene.approvedAssetId);

  useEffect(() => {
    setPromptProvider(selectedScene.externalProvider ?? selectedScene.promptProvider ?? projectProvider);
  }, [projectProvider, selectedScene.externalProvider, selectedScene.id, selectedScene.promptProvider]);

  const changePromptProvider = (provider: string) => {
    setPromptProvider(provider);
    onSelectProvider(selectedScene.id, provider);
  };

  const triggerUpload = () => fileInputRef.current?.click();
  const handleUpload = (file?: File) => {
    if (!file) return;
    onAttachVideo(selectedScene.id, file);
    setTab("video");
  };

  return (
    <div className="scene-composer-layout">
      <GlassPanel className="scene-list-panel">
        <SectionHeading
          title="Scene Cards"
          meta={`${scenes.length} scenes / ${scenes.length * 10}-second film`}
          action={
            <button className="ghost-button small-button" type="button" onClick={onAddScene}>
              Add
            </button>
          }
        />
        <div className="scene-list">
          {scenes.map((scene) => (
            <button
              className={`scene-list-item ${scene.id === selectedScene.id ? "is-active" : ""}`}
              key={scene.id}
              onClick={() => onSelectScene(scene.id)}
              type="button"
            >
              <span className="scene-number">SCENE {String(scene.number).padStart(2, "0")}</span>
              <strong>{scene.title}</strong>
              <StatusPill label={scene.status} compact />
            </button>
          ))}
        </div>
      </GlassPanel>

      <GlassPanel className="scene-editor-panel" variant="strong">
        <div className="scene-editor-head">
          <div>
            <p>Scene Composer</p>
            <h2>SCENE {String(selectedScene.number).padStart(2, "0")} - {selectedScene.title}</h2>
            <div className="hero-meta">
              <StatusPill label={selectedScene.status} />
              <span>{selectedScene.durationSeconds} seconds</span>
              <span>{selectedScene.output}</span>
              <span>{selectedScene.format}</span>
            </div>
          </div>
          <div className="scene-rule">
            <strong>1 Scene Card = 1 generated 10-second video</strong>
            <span>Internal beats are instructions inside the same prompt.</span>
          </div>
        </div>

        <ClipGenerationPanel
          scene={selectedScene}
          sceneJobs={sceneJobs}
          sceneVideoState={sceneVideoState}
          generationMode={generationMode}
          onCopyPrompt={() => onCopyPrompt(selectedScene.id, promptProvider, "Scene prompt")}
          onGenerateVideo={() => onGenerateVideo(selectedScene.id)}
          onRunSceneJob={() => sceneVideoState.job && onRunSceneJob(sceneVideoState.job.id)}
          onUpload={triggerUpload}
          onPreview={() => setTab("video")}
          onApprove={() => onUpdateStatus(selectedScene.id, "Approved")}
          onOpenProviderSettings={onOpenProviderSettings}
        />

        <div className="scene-tabs" role="tablist" aria-label="Scene composer views">
          <button className={tab === "brief" ? "is-active" : ""} type="button" onClick={() => setTab("brief")}>
            Brief
          </button>
          <button className={tab === "prompt" ? "is-active" : ""} type="button" onClick={() => setTab("prompt")}>
            Full Prompt
          </button>
          <button className={tab === "video" ? "is-active" : ""} type="button" onClick={() => setTab("video")}>
            Video
          </button>
        </div>

        {tab === "brief" ? <SceneBrief scene={selectedScene} continuityReport={continuityReport} onUpdateScene={onUpdateScene} /> : null}
        {tab === "prompt" ? (
          <PromptEditor
            scene={selectedScene}
            promptProvider={promptProvider}
            promptProviders={promptProviders}
            onChangeProvider={changePromptProvider}
            onCopyPrompt={onCopyPrompt}
            onRegeneratePrompt={onRegeneratePrompt}
            onPolishPrompt={onPolishPrompt}
          />
        ) : null}
        {tab === "video" ? <VideoPanel scene={selectedScene} asset={sceneAsset} /> : null}

        <div className="scene-actions">
          <button className="primary-button" type="button" onClick={() => onCopyPrompt(selectedScene.id, promptProvider, "Scene prompt")}>
            <Clipboard size={17} />
            Copy Scene Prompt
          </button>
          <button className="ghost-button" type="button" onClick={() => onRegeneratePrompt(selectedScene.id, promptProvider)}>
            <RefreshCcw size={17} />
            Regenerate Scene Prompt
          </button>
          <button className="ghost-button" type="button" onClick={() => onGenerateVideo(selectedScene.id)} disabled={!sceneVideoState.canGenerate && sceneVideoState.status !== "Failed"}>
            <WandSparkles size={17} />
            {sceneVideoState.status === "Failed" ? "Retry Video" : generationMode.canRunVideo ? "Generate Video" : "Copy Video Prompt"}
          </button>
          <button className="ghost-button" type="button" onClick={triggerUpload}>
            <Upload size={17} />
            Upload Video
          </button>
          <button className="ghost-button" type="button" onClick={() => setTab("video")}>
            <Play size={17} />
            Preview Video
          </button>
          <button
            className="success-button"
            type="button"
            disabled={!hasSceneVideo}
            title={hasSceneVideo ? "Approve the attached scene video" : "Upload a generated video before approval"}
            onClick={() => onUpdateStatus(selectedScene.id, "Approved")}
          >
            <CheckCircle2 size={17} />
            Mark Approved
          </button>
          <button
            className="cyan-button"
            type="button"
            disabled={!hasApprovedSceneVideo}
            title={hasApprovedSceneVideo ? "Send the approved scene video to NOX Cut" : "Approve an uploaded scene video before timeline assembly"}
            onClick={() => onUpdateStatus(selectedScene.id, "Added to Timeline")}
          >
            <Send size={17} />
            Send to Timeline
          </button>
          <button className="danger-button" type="button" onClick={() => onDeleteScene(selectedScene.id)}>
            Delete Scene
          </button>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="video/*"
            onChange={(event) => handleUpload(event.target.files?.[0])}
          />
        </div>
      </GlassPanel>
    </div>
  );
}

function ClipGenerationPanel({
  scene,
  sceneJobs,
  sceneVideoState,
  generationMode,
  onCopyPrompt,
  onGenerateVideo,
  onRunSceneJob,
  onUpload,
  onPreview,
  onApprove,
  onOpenProviderSettings,
}: {
  scene: SceneCard;
  sceneJobs: GenerationJob[];
  sceneVideoState: SceneVideoState;
  generationMode: GenerationMode;
  onCopyPrompt: () => void;
  onGenerateVideo: () => void;
  onRunSceneJob: () => void;
  onUpload: () => void;
  onPreview: () => void;
  onApprove: () => void;
  onOpenProviderSettings: () => void;
}) {
  const activeJob = sceneVideoState.job;
  const primaryLabel =
    sceneVideoState.status === "Queued"
      ? "Run Now"
      : sceneVideoState.status === "Running"
        ? "Generating"
        : sceneVideoState.status === "Failed"
          ? "Retry"
          : generationMode.canRunVideo
            ? "Generate Clip"
            : "Copy Prompt";
  const primaryAction =
    sceneVideoState.status === "Queued"
      ? onRunSceneJob
      : generationMode.canRunVideo || sceneVideoState.status === "Failed"
        ? onGenerateVideo
        : onCopyPrompt;
  const primaryDisabled = sceneVideoState.status === "Running";

  return (
    <div className="clip-generation-panel">
      <div>
        <span>Clip Generation</span>
        <strong>Scene {String(scene.number).padStart(2, "0")} / {sceneVideoState.status}</strong>
        <p>{sceneVideoState.label}</p>
      </div>
      <div className="clip-generation-meta">
        <StatusPill label={generationMode.label} compact />
        <span>{sceneJobs.length} focused job{sceneJobs.length === 1 ? "" : "s"}</span>
        <span>{activeJob ? activeJob.task : "No open job"}</span>
      </div>
      <div className="clip-generation-actions">
        <button className="primary-button small-button" type="button" disabled={primaryDisabled} onClick={primaryAction}>
          <WandSparkles size={15} />
          {primaryLabel}
        </button>
        {generationMode.id === "manual-handoff" || generationMode.id === "desktop-grok-missing-key" ? (
          <button className="ghost-button small-button" type="button" onClick={onOpenProviderSettings}>
            <Settings size={15} />
            Set Up Grok
          </button>
        ) : null}
        <button className="ghost-button small-button" type="button" onClick={onUpload}>
          <Upload size={15} />
          Upload Clip
        </button>
        <button className="ghost-button small-button" type="button" disabled={!sceneVideoState.canPreview} onClick={onPreview}>
          <Play size={15} />
          Preview
        </button>
        <button className="success-button small-button" type="button" disabled={!sceneVideoState.canApprove} onClick={onApprove}>
          <CheckCircle2 size={15} />
          Approve
        </button>
      </div>
    </div>
  );
}

function SceneBrief({
  scene,
  continuityReport,
  onUpdateScene,
}: {
  scene: SceneCard;
  continuityReport?: ContinuityReport;
  onUpdateScene: (scene: SceneCard) => void;
}) {
  const [draft, setDraft] = useState(scene);

  useEffect(() => {
    setDraft(scene);
  }, [scene]);

  const updateDraft = <Key extends keyof SceneCard>(key: Key, value: SceneCard[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateBeat = (beatId: string, updater: (beat: SceneBeat) => SceneBeat) => {
    setDraft((current) => ({
      ...current,
      beats: current.beats.map((beat) => (beat.id === beatId ? updater(beat) : beat)),
    }));
  };

  const addBeat = () => {
    setDraft((current) => {
      if (current.beats.length >= 3) return current;
      const nextIndex = current.beats.length;
      return {
        ...current,
        beats: [...current.beats, createDraftBeat(nextIndex)],
      };
    });
  };

  const deleteBeat = (beatId: string) => {
    setDraft((current) => {
      if (current.beats.length <= 1) return current;
      return { ...current, beats: current.beats.filter((beat) => beat.id !== beatId) };
    });
  };

  return (
    <div className="scene-brief-grid">
      {continuityReport ? <ContinuityPanel report={continuityReport} /> : null}
      <div className="field-panel wide">
        <span>Scene Purpose</span>
        <textarea value={draft.purpose} onChange={(event) => updateDraft("purpose", event.target.value)} />
      </div>
      <div className="field-panel">
        <span>Location</span>
        <textarea value={draft.location} onChange={(event) => updateDraft("location", event.target.value)} />
      </div>
      <div className="field-panel">
        <span>Characters</span>
        <input
          value={draft.characters.join(", ")}
          onChange={(event) =>
            updateDraft(
              "characters",
              event.target.value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            )
          }
        />
      </div>
      <div className="field-panel">
        <span>Mood</span>
        <input value={draft.mood} onChange={(event) => updateDraft("mood", event.target.value)} />
      </div>
      <div className="field-panel wide">
        <span>Visual Style</span>
        <textarea value={draft.visualStyle} onChange={(event) => updateDraft("visualStyle", event.target.value)} />
      </div>
      <div className="beats-panel">
        <div className="beats-head">
          <div>
            <Clapperboard size={17} />
            <strong>Internal Timed Shot Beats</strong>
          </div>
          <button className="ghost-button small-button" type="button" onClick={addBeat} disabled={draft.beats.length >= 3}>
            <Plus size={14} />
            Add Beat
          </button>
        </div>
        <div className="beat-list">
          {draft.beats.map((beat) => (
            <div className="beat-row editable-beat" key={beat.id}>
              <div className="beat-range-tools">
                <input
                  aria-label="Beat timing"
                  value={beat.range}
                  onChange={(event) => updateBeat(beat.id, (item) => ({ ...item, range: event.target.value }))}
                />
                <button
                  className="icon-button compact-icon-button"
                  type="button"
                  title="Delete beat"
                  disabled={draft.beats.length <= 1}
                  onClick={() => deleteBeat(beat.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div>
                <input
                  aria-label="Beat title"
                  value={beat.title}
                  onChange={(event) => updateBeat(beat.id, (item) => ({ ...item, title: event.target.value }))}
                />
                <textarea
                  aria-label="Beat description"
                  value={beat.description}
                  onChange={(event) => updateBeat(beat.id, (item) => ({ ...item, description: event.target.value }))}
                />
                <input
                  aria-label="Beat camera"
                  value={beat.camera}
                  onChange={(event) => updateBeat(beat.id, (item) => ({ ...item, camera: event.target.value }))}
                />
                <input
                  aria-label="Beat audio"
                  value={beat.audio}
                  onChange={(event) => updateBeat(beat.id, (item) => ({ ...item, audio: event.target.value }))}
                />
                <textarea
                  aria-label="Beat dialogue"
                  placeholder="Optional spoken line for this timed shot"
                  value={beat.dialogue ?? ""}
                  onChange={(event) => updateBeat(beat.id, (item) => ({ ...item, dialogue: event.target.value || undefined }))}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="field-panel">
        <span>Dialogue</span>
        <textarea value={draft.dialogue} onChange={(event) => updateDraft("dialogue", event.target.value)} />
      </div>
      <div className="field-panel">
        <span>Audio</span>
        <textarea value={draft.audio} onChange={(event) => updateDraft("audio", event.target.value)} />
      </div>
      <div className="field-panel wide">
        <span>Continuity Rules</span>
        <textarea
          value={draft.continuityRules.join("\n")}
          onChange={(event) =>
            updateDraft(
              "continuityRules",
              event.target.value
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean),
            )
          }
        />
      </div>
      <div className="field-panel wide">
        <span>Negative Prompt</span>
        <textarea value={draft.negativePrompt} onChange={(event) => updateDraft("negativePrompt", event.target.value)} />
      </div>
      <div className="field-panel wide save-scene-panel">
        <span>Scene Save</span>
        <p>Save changes here, then regenerate the prompt when you want the full provider prompt rewritten.</p>
        <button className="primary-button small-button" type="button" onClick={() => onUpdateScene(draft)}>
          Save Scene Card
        </button>
      </div>
    </div>
  );
}

function createDraftBeat(index: number): SceneBeat {
  const ranges = ["0-3s", "3-7s", "7-10s"];
  const titles = ["Visual hook", "Story pressure", "Ending hook"];
  const descriptions = [
    "Open with one strong cinematic image.",
    "Push the conflict or character decision forward.",
    "End on a reveal that motivates the next Scene Card.",
  ];
  return {
    id: makeSceneBeatId(),
    range: ranges[index] ?? "7-10s",
    title: titles[index] ?? `Beat ${index + 1}`,
    description: descriptions[index] ?? "Describe the timed action inside this one generated 10-second video.",
    camera: index === 0 ? "Wide establishing frame." : index === 1 ? "Smooth push-in." : "Tight close-up.",
    audio: index === 0 ? "Atmospheric intro." : index === 1 ? "Rising tension." : "Final hit or hook.",
  };
}

function makeSceneBeatId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function ContinuityPanel({ report }: { report: ContinuityReport }) {
  const warnings = report.issues.filter((issue) => issue.severity !== "Pass");

  return (
    <div className="field-panel wide continuity-panel">
      <div className="continuity-head">
        {report.status === "Pass" ? <ShieldCheck size={17} /> : <TriangleAlert size={17} />}
        <div>
          <span>Continuity Check</span>
          <strong>{report.summary}</strong>
        </div>
        <StatusPill label={report.status} compact />
      </div>
      <div className="continuity-matches">
        <span>Characters: {report.matchedCharacters.length ? report.matchedCharacters.join(", ") : "No match"}</span>
        <span>Worlds: {report.matchedWorlds.length ? report.matchedWorlds.join(", ") : "No match"}</span>
        <span>Locations: {report.matchedLocations.length ? report.matchedLocations.join(", ") : "No match"}</span>
        <span>Factions: {report.matchedFactions.length ? report.matchedFactions.join(", ") : "No match"}</span>
      </div>
      <div className="continuity-issue-list">
        {(warnings.length ? warnings : report.issues).slice(0, 6).map((issue) => (
          <div className={`continuity-issue severity-${issue.severity.toLowerCase()}`} key={issue.id}>
            <strong>{issue.scope} / {issue.label}</strong>
            <p>{issue.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PromptEditor({
  scene,
  promptProvider,
  promptProviders,
  onChangeProvider,
  onCopyPrompt,
  onRegeneratePrompt,
  onPolishPrompt,
}: {
  scene: SceneCard;
  promptProvider: string;
  promptProviders: readonly string[];
  onChangeProvider: (provider: string) => void;
  onCopyPrompt: (sceneId: string, provider: string, label?: string) => void;
  onRegeneratePrompt: (sceneId: string, provider?: string) => void;
  onPolishPrompt: (sceneId: string, provider: string) => void;
}) {
  return (
    <div className="prompt-layout">
      <div className="prompt-editor">
        <div className="prompt-editor-head">
          <strong>Full Scene Prompt</strong>
          <button className="text-button" type="button" onClick={() => onCopyPrompt(scene.id, promptProvider, "Full scene prompt")}>
            Copy <Clipboard size={14} />
          </button>
        </div>
        <div className="prompt-control-bar">
          <label>
            <span>Prompt Provider</span>
            <select value={promptProvider} onChange={(event) => onChangeProvider(event.target.value)}>
              {promptProviders.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>
          <button className="ghost-button small-button" type="button" onClick={() => onRegeneratePrompt(scene.id, promptProvider)}>
            <RefreshCcw size={15} />
            Regenerate
          </button>
          <button className="primary-button small-button" type="button" onClick={() => onPolishPrompt(scene.id, promptProvider)}>
            <WandSparkles size={15} />
            Polish
          </button>
        </div>
        <pre>{scene.fullPrompt}</pre>
      </div>
      <div className="negative-panel">
        <strong>Negative Prompt</strong>
        <p>{scene.negativePrompt}</p>
        <strong>Provider Target</strong>
        <p>{promptProvider}</p>
        <strong>Manual Workflow</strong>
        <p>External provider: {scene.externalProvider ?? promptProvider}</p>
        <p>Prompt copied: {scene.promptCopiedAt ?? "Not copied yet"}</p>
        <strong>Required Sections</strong>
        <ul className="prompt-section-list">
          <li>[SCENE]</li>
          <li>[TIMING]</li>
          <li>[STYLE]</li>
          <li>[CAMERA]</li>
          <li>[AUDIO]</li>
          <li>[DIALOGUE]</li>
          <li>[NEGATIVE PROMPT]</li>
        </ul>
      </div>
    </div>
  );
}

function VideoPanel({ scene, asset }: { scene: SceneCard; asset?: StudioAsset }) {
  return (
    <div className="video-workspace">
      <div className="video-preview-frame">
        <div className="video-scanline" aria-hidden="true" />
        {asset?.fileUrl ? (
          <>
            <video controls src={asset.fileUrl} />
            <strong>{asset.filename}</strong>
            <span>{asset.status} / {asset.provider}</span>
          </>
        ) : scene.uploadedAsset ? (
          <>
            <FileVideo size={42} />
            <strong>{scene.uploadedAsset}</strong>
            <span>Attached to Scene {String(scene.number).padStart(2, "0")}</span>
          </>
        ) : (
          <>
            <Upload size={42} />
            <strong>No scene video attached</strong>
            <span>Upload one generated 10-second clip for this Scene Card.</span>
          </>
        )}
      </div>
      <div className="clip-metadata">
        <div>
          <span>Duration</span>
          <strong>10 seconds</strong>
        </div>
        <div>
          <span>External Provider</span>
          <strong>{scene.externalProvider ?? scene.promptProvider ?? "Manual Copy Mode"}</strong>
        </div>
        <div>
          <span>Prompt Copied</span>
          <strong>{scene.promptCopiedAt ?? "Not copied yet"}</strong>
        </div>
        <div>
          <span>Timeline State</span>
          <strong>{scene.status}</strong>
        </div>
        <div>
          <span>Output Rule</span>
          <strong>One generated video</strong>
        </div>
        <div>
          <span>Uploaded Source</span>
          <strong>{asset?.provider ?? scene.uploadedAsset ?? "Awaiting upload"}</strong>
        </div>
      </div>
    </div>
  );
}
