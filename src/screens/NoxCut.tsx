import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BadgePlus,
  CheckCircle2,
  Download,
  FileVideo,
  ListChecks,
  Music2,
  PlayCircle,
  Scissors,
  Shield,
  Subtitles,
  Type,
  Upload,
  Wand2,
} from "lucide-react";
import type { GenerationJob, SceneCard, StudioAsset, TimelineItem } from "../types";
import { GlassPanel } from "../components/GlassPanel";
import { SectionHeading } from "../components/SectionHeading";
import { StatusPill } from "../components/StatusPill";

type TimelineClipPatch = Partial<Pick<TimelineItem, "transitionOut" | "trimStartNote" | "trimEndNote" | "editorNotes">>;

type NoxCutProps = {
  scenes: SceneCard[];
  timelineItems: TimelineItem[];
  assets: StudioAsset[];
  generationJobs: GenerationJob[];
  renderJob?: GenerationJob;
  finalExportAsset?: StudioAsset;
  onGenerateMissingClips: () => void;
  onGenerateSceneClip: (sceneId: string) => void;
  onApproveSceneClip: (sceneId: string) => void;
  onRunRenderJob: () => void;
  onOpenScene: (sceneId: string) => void;
  onExportEditPlan: () => void;
  onExportRenderManifest: () => void;
  onQueueRender: () => void;
  onMoveScene: (sceneId: string, direction: "up" | "down") => void;
  onAddTimelineUtility: (trackType: "audio" | "subtitle" | "overlay" | "title") => void;
  onUpdateTimelineClip: (sceneId: string, patch: TimelineClipPatch) => void;
};

const readyStatuses = new Set(["Approved", "Added to Timeline", "Rendered", "Published"]);

export function NoxCut({
  scenes,
  timelineItems,
  assets,
  generationJobs,
  renderJob,
  finalExportAsset,
  onGenerateMissingClips,
  onGenerateSceneClip,
  onApproveSceneClip,
  onRunRenderJob,
  onOpenScene,
  onExportEditPlan,
  onExportRenderManifest,
  onQueueRender,
  onMoveScene,
  onAddTimelineUtility,
  onUpdateTimelineClip,
}: NoxCutProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0);
  const videoItems = useMemo(
    () => timelineItems.filter((item) => item.trackType === "video").sort((a, b) => a.orderIndex - b.orderIndex),
    [timelineItems],
  );
  const assemblyClips = useMemo(() => {
    const timelineByScene = new Map(videoItems.filter((item) => item.sceneId).map((item) => [item.sceneId, item]));
    const orderedScenes = videoItems.length
      ? [
          ...videoItems
            .map((item) => scenes.find((scene) => scene.id === item.sceneId))
            .filter((scene): scene is SceneCard => Boolean(scene)),
          ...scenes.filter((scene) => !timelineByScene.has(scene.id)),
        ]
      : scenes;

    return orderedScenes.map((scene) => ({
      scene,
      timelineItem: timelineByScene.get(scene.id),
      asset: getSceneSourceAsset(scene, assets),
      ready: isSceneAssemblyReady(scene, assets),
    }));
  }, [assets, scenes, videoItems]);
  const selectedClipIndex = assemblyClips.length ? Math.min(selectedPreviewIndex, assemblyClips.length - 1) : 0;
  const selectedClip = assemblyClips[selectedClipIndex];
  const runtime = Math.max(scenes.reduce((total, scene) => total + scene.durationSeconds, 0), 0);
  const readyScenes = scenes.filter((scene) => isSceneAssemblyReady(scene, assets));
  const missingScenes = scenes.filter((scene) => !isSceneAssemblyReady(scene, assets));
  const allScenesReady = scenes.length > 0 && missingScenes.length === 0;
  const reviewScenes = scenes.filter((scene) => getSceneSourceAsset(scene, assets) && !isSceneAssemblyReady(scene, assets));
  const openClipJobs = generationJobs.filter((job) => /video/i.test(`${job.task} ${job.provider}`) && ["Queued", "Running"].includes(job.status));
  const renderStatus = finalExportAsset
    ? "Final MP4 Ready"
    : renderJob?.status === "Running"
      ? "Rendering"
      : renderJob?.status === "Queued"
        ? "Render Queued"
        : allScenesReady
          ? "Ready To Render"
          : "Needs Clips";
  const primaryCtaLabel = finalExportAsset
    ? "Preview Final MP4"
    : !scenes.length
      ? "Create Scene Cards first"
      : openClipJobs.length
        ? "Open Active Clip Jobs"
        : missingScenes.length
          ? "Generate Missing Clips"
          : reviewScenes.length
            ? "Review Clips"
            : "Generate Full Short Film";
  const primaryCtaDisabled = !scenes.length || renderJob?.status === "Running";

  return (
    <div className="single-screen">
      <GlassPanel variant="strong">
        <SectionHeading
          title="NOX Cut Editor"
          meta="Full short-film assembly, clip review, render state, and final export control."
          action={
            <details className="advanced-export-menu">
              <summary>Advanced Export</summary>
              <div className="section-action-group">
                <button className="ghost-button small-button" type="button" onClick={onExportRenderManifest}>
                  <Download size={16} />
                  Render Manifest
                </button>
                <button className="ghost-button small-button" type="button" onClick={onQueueRender}>
                  <Wand2 size={16} />
                  Queue Render Job
                </button>
                <button className="primary-button small-button" type="button" onClick={onExportEditPlan}>
                  <Download size={16} />
                  Export Edit Plan
                </button>
              </div>
            </details>
          }
        />
        <div className="full-film-generator-panel">
          <div>
            <span>Full Short Film</span>
            <strong>{renderStatus}</strong>
            <p>
              {finalExportAsset
                ? finalExportAsset.filename
                : `${readyScenes.length}/${scenes.length} approved clips, ${missingScenes.length} missing, ${reviewScenes.length} awaiting review.`}
            </p>
          </div>
          <div className="full-film-actions">
            <button className="primary-button" type="button" disabled={primaryCtaDisabled} onClick={onRunRenderJob}>
              <Wand2 size={17} />
              {primaryCtaLabel}
            </button>
            {missingScenes.length ? (
              <button className="ghost-button" type="button" onClick={onGenerateMissingClips}>
                <FileVideo size={17} />
                Queue Missing Clips
              </button>
            ) : null}
          </div>
        </div>
        <div className="cut-layout">
          <div className="cut-preview">
            <div className="video-scanline" aria-hidden="true" />
            <strong>Preview Assembly</strong>
            <span>{scenes.length ? `Scene 01 to Scene ${String(scenes.length).padStart(2, "0")} / ${runtime}s / 9:16` : "No Scene Cards yet"}</span>
            <div className="assembly-player">
              {selectedClip?.asset?.fileUrl ? (
                <video controls src={selectedClip.asset.fileUrl} />
              ) : (
                <div className="assembly-player-empty">
                  <FileVideo size={34} />
                  <strong>{selectedClip ? "Clip source missing" : "No timeline source"}</strong>
                  <span>{selectedClip ? selectedClip.scene.title : "Create Scene Cards to preview assembly."}</span>
                </div>
              )}
            </div>
            {selectedClip ? (
              <div className="assembly-player-meta">
                <strong>SC {String(selectedClip.scene.number).padStart(2, "0")} - {selectedClip.scene.title}</strong>
                <span>{selectedClip.asset?.filename ?? selectedClip.scene.uploadedAsset ?? "Awaiting approved video"}</span>
                <span>
                  {selectedClip.timelineItem
                    ? `${selectedClip.timelineItem.startTime}s-${selectedClip.timelineItem.endTime}s / ${selectedClip.timelineItem.transitionOut}`
                    : `${selectedClip.scene.durationSeconds}s / timeline clip not saved`}
                </span>
              </div>
            ) : null}
            <div className="assembly-score" aria-label="Assembly readiness">
              <CheckCircle2 size={17} />
              <strong>{readyScenes.length}</strong>
              <span>ready</span>
              <AlertTriangle size={17} />
              <strong>{missingScenes.length}</strong>
              <span>needs video</span>
            </div>
            <button className="primary-button" type="button" onClick={() => setPreviewOpen((current) => !current)}>
              <PlayCircle size={17} />
              Assembly Check
            </button>
            {previewOpen ? (
              <div className={allScenesReady ? "assembly-preview-card is-ready" : "assembly-preview-card"}>
                <ListChecks size={18} />
                <div>
                  <strong>{allScenesReady ? "Ready for edit-plan handoff" : "Assembly needs review"}</strong>
                  <span>
                    {allScenesReady
                      ? `${readyScenes.length} approved 10-second scene videos are in order.`
                      : `${missingScenes.length} Scene Card${missingScenes.length === 1 ? "" : "s"} need approved video before the final cut.`}
                  </span>
                </div>
              </div>
            ) : null}
            <div className="assembly-playlist" aria-label="Assembly preview clips">
              {assemblyClips.map((clip, index) => (
                <button
                  className={`${index === selectedClipIndex ? "is-active" : ""} ${clip.ready ? "is-ready" : ""}`}
                  key={clip.scene.id}
                  type="button"
                  onClick={() => setSelectedPreviewIndex(index)}
                >
                  <span>SC {String(clip.scene.number).padStart(2, "0")}</span>
                  <strong>{clip.ready ? "Ready" : "Needs Video"}</strong>
                </button>
              ))}
            </div>
            <div className="cut-tool-grid">
              <button className="ghost-button small-button" type="button" onClick={() => onAddTimelineUtility("title")}>
                <Type size={15} />
                Title Card
              </button>
              <button className="ghost-button small-button" type="button" onClick={() => onAddTimelineUtility("subtitle")}>
                <Subtitles size={15} />
                Subtitles
              </button>
              <button className="ghost-button small-button" type="button" onClick={() => onAddTimelineUtility("audio")}>
                <Music2 size={15} />
                Music
              </button>
              <button className="ghost-button small-button" type="button" onClick={() => onAddTimelineUtility("overlay")}>
                <Shield size={15} />
                Watermark
              </button>
            </div>
          </div>
          <div className="track-stack">
            <Track
              title="Scene Video Track"
              icon={<Scissors size={16} />}
              scenes={scenes}
              assets={assets}
              timelineItems={videoItems}
              onMoveScene={onMoveScene}
              onUpdateTimelineClip={onUpdateTimelineClip}
              onGenerateSceneClip={onGenerateSceneClip}
              onApproveSceneClip={onApproveSceneClip}
              onOpenScene={onOpenScene}
            />
            <div className="timeline-summary">
              <strong>{videoItems.length} saved video timeline clips</strong>
              <span>{readyScenes.length}/{scenes.length} Scene Cards have approved video sources. Queue a render job after every source is approved.</span>
            </div>
            <UtilityTrack icon={<Music2 size={16} />} title="Music Track" items={timelineItems.filter((item) => item.trackType === "audio")} fallback="No music track yet" />
            <UtilityTrack icon={<Subtitles size={16} />} title="Subtitle Track" items={timelineItems.filter((item) => item.trackType === "subtitle")} fallback="No subtitle track yet" />
            <UtilityTrack icon={<Shield size={16} />} title="Overlay Track" items={timelineItems.filter((item) => item.trackType === "overlay" || item.trackType === "title")} fallback="No title or watermark yet" />
            <div className="track-row utility-track">
              <Wand2 size={16} />
              <span>Transition Track</span>
              <strong>{videoItems.length ? `${videoItems.length} transition notes saved` : "No transition notes yet"}</strong>
            </div>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}

function Track({
  title,
  icon,
  scenes,
  assets,
  timelineItems,
  onMoveScene,
  onUpdateTimelineClip,
  onGenerateSceneClip,
  onApproveSceneClip,
  onOpenScene,
}: {
  title: string;
  icon: JSX.Element;
  scenes: SceneCard[];
  assets: StudioAsset[];
  timelineItems: TimelineItem[];
  onMoveScene: (sceneId: string, direction: "up" | "down") => void;
  onUpdateTimelineClip: (sceneId: string, patch: TimelineClipPatch) => void;
  onGenerateSceneClip: (sceneId: string) => void;
  onApproveSceneClip: (sceneId: string) => void;
  onOpenScene: (sceneId: string) => void;
}) {
  return (
    <div className="timeline-track">
      <div className="track-label">
        {icon}
        <span>{title}</span>
      </div>
      <div className="timeline-clips">
        {scenes.map((scene, index) => {
          const timelineItem = timelineItems.find((item) => item.sceneId === scene.id && item.trackType === "video");
          const sourceAsset = getSceneSourceAsset(scene, assets);
          const ready = isSceneAssemblyReady(scene, assets);
          const sourceLabel = sourceAsset?.filename ?? scene.uploadedAsset ?? "Awaiting approved video";
          return (
            <div className={ready ? "timeline-clip is-ready" : "timeline-clip"} key={scene.id}>
              <div className="timeline-clip-head">
                <span>SC {String(scene.number).padStart(2, "0")}</span>
                <StatusPill label={ready ? "Ready" : "Needs Video"} compact />
              </div>
              <strong>{scene.title}</strong>
              <div className="clip-source-line">
                <FileVideo size={14} />
                <span>{sourceLabel}</span>
              </div>
              <div className="clip-meta-row">
                <span>{scene.durationSeconds}s</span>
                <span>{scene.status}</span>
              </div>
              <div className="clip-control-row">
                <button
                  className="clip-icon-button"
                  type="button"
                  title={ready ? "Regenerate clip" : "Generate clip"}
                  onClick={(event) => {
                    event.stopPropagation();
                    onGenerateSceneClip(scene.id);
                  }}
                >
                  <Wand2 size={13} />
                </button>
                <button
                  className="clip-icon-button"
                  type="button"
                  title="Upload or replace clip in Scene Composer"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenScene(scene.id);
                  }}
                >
                  <Upload size={13} />
                </button>
                <button
                  className="clip-icon-button"
                  type="button"
                  title="Preview clip"
                  disabled={!sourceAsset?.fileUrl}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenScene(scene.id);
                  }}
                >
                  <PlayCircle size={13} />
                </button>
                <button
                  className="clip-icon-button"
                  type="button"
                  title="Approve clip"
                  disabled={!sourceAsset || ready}
                  onClick={(event) => {
                    event.stopPropagation();
                    onApproveSceneClip(scene.id);
                  }}
                >
                  <CheckCircle2 size={13} />
                </button>
                <button
                  className="clip-icon-button"
                  type="button"
                  title="Move earlier"
                  onClick={(event) => {
                    event.stopPropagation();
                    onMoveScene(scene.id, "up");
                  }}
                  disabled={index === 0}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  className="clip-icon-button"
                  type="button"
                  title="Move later"
                  onClick={(event) => {
                    event.stopPropagation();
                    onMoveScene(scene.id, "down");
                  }}
                  disabled={index === scenes.length - 1}
                >
                  <ArrowDown size={13} />
                </button>
              </div>
              <label className="clip-note-field span-2">
                <span>Transition out</span>
                <select
                  aria-label={`Scene ${scene.number} transition`}
                  value={timelineItem?.transitionOut ?? "Signal Glitch"}
                  onChange={(event) => {
                    event.stopPropagation();
                    onUpdateTimelineClip(scene.id, { transitionOut: event.target.value });
                  }}
                >
                  <option>Signal Glitch</option>
                  <option>Cyberglass Swipe</option>
                  <option>Blackout Cut</option>
                  <option>Hologram Dissolve</option>
                  <option>Neon Pulse Zoom</option>
                </select>
              </label>
              <label className="clip-note-field">
                <span>Trim start</span>
                <input
                  aria-label={`Scene ${scene.number} trim start note`}
                  defaultValue={timelineItem?.trimStartNote ?? "Start on first clean usable frame."}
                  onBlur={(event) => onUpdateTimelineClip(scene.id, { trimStartNote: event.target.value })}
                />
              </label>
              <label className="clip-note-field">
                <span>Trim end</span>
                <input
                  aria-label={`Scene ${scene.number} trim end note`}
                  defaultValue={timelineItem?.trimEndNote ?? "End before provider reset."}
                  onBlur={(event) => onUpdateTimelineClip(scene.id, { trimEndNote: event.target.value })}
                />
              </label>
              <label className="clip-note-field span-2">
                <span>Editor notes</span>
                <textarea
                  aria-label={`Scene ${scene.number} editor notes`}
                  defaultValue={timelineItem?.editorNotes ?? "Needs approved source asset before final assembly."}
                  onBlur={(event) => onUpdateTimelineClip(scene.id, { editorNotes: event.target.value })}
                />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UtilityTrack({ icon, title, items, fallback }: { icon: JSX.Element; title: string; items: TimelineItem[]; fallback: string }) {
  return (
    <div className="track-row utility-track">
      {icon}
      <span>{title}</span>
      <strong>{items.length ? items.map((item) => item.label).join(" / ") : fallback}</strong>
      {items.length ? <BadgePlus size={15} /> : null}
    </div>
  );
}

function getSceneSourceAsset(scene: SceneCard, assets: StudioAsset[]) {
  return (
    (scene.approvedAssetId ? assets.find((asset) => asset.id === scene.approvedAssetId) : undefined) ??
    assets.find((asset) => asset.sceneId === scene.id && asset.type === "Video" && asset.status === "Approved") ??
    assets.find((asset) => asset.sceneId === scene.id && asset.type === "Video")
  );
}

function isSceneAssemblyReady(scene: SceneCard, assets: StudioAsset[]) {
  const sourceAsset = getSceneSourceAsset(scene, assets);
  return readyStatuses.has(scene.status) && Boolean(scene.uploadedAsset || sourceAsset?.status === "Approved");
}
