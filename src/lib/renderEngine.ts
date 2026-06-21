import type { Project, SceneCard, StudioAsset, StudioState, TimelineItem } from "../types";

export type RenderClip = {
  sceneId: string;
  sceneNumber: number;
  label: string;
  sourceAssetId?: string;
  sourceFilename?: string;
  sourceUrl?: string;
  storagePath?: string;
  startTime: number;
  endTime: number;
  durationSeconds: number;
  transitionIn: string;
  transitionOut: string;
  trimStartNote: string;
  trimEndNote: string;
  editorNotes: string;
  provider: string;
  promptId: string;
  ready: boolean;
  missingReason?: string;
};

export type RenderUtilityTrack = {
  id: string;
  trackType: TimelineItem["trackType"];
  label: string;
  startTime: number;
  endTime: number;
  transitionIn: string;
  transitionOut: string;
  textOverlay?: string;
  subtitleText?: string;
  assetId?: string;
  assetFilename?: string;
  assetSourceUrl?: string;
  assetStoragePath?: string;
  assetMimeType?: string;
  assetType?: StudioAsset["type"];
};

export type RenderManifest = {
  schemaVersion: 1;
  engine: "NOX Render Engine V1";
  workspaceId: string;
  projectId: string;
  projectTitle: string;
  outputFilename: string;
  format: string;
  runtimeSeconds: number;
  fps: number;
  width: number;
  height: number;
  clips: RenderClip[];
  utilityTracks: RenderUtilityTrack[];
  readiness: {
    ready: boolean;
    approvedClipCount: number;
    totalClipCount: number;
    blockers: string[];
  };
  ffmpeg: {
    concatMode: "reencode-concat";
    rendererScript: "scripts/render-nox-cut.mjs";
    workerScript: "scripts/render-worker.mjs";
    notes: string[];
  };
  createdAt: string;
};

const approvedStatuses = new Set(["Approved", "Added to Timeline", "Rendered", "Published"]);

export function createRenderManifest(state: StudioState, projectId: string): RenderManifest {
  const project = state.projects.find((item) => item.id === projectId);
  const scenes = state.scenes
    .filter((scene) => scene.projectId === projectId)
    .sort((a, b) => a.number - b.number);
  const timeline = state.timelineItems
    .filter((item) => item.projectId === projectId)
    .sort(compareTimelineItems);
  const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
  const videoItems = timeline.filter((item) => item.trackType === "video");
  const utilityTracks = timeline.filter((item) => item.trackType !== "video").map((item) => toRenderUtilityTrack(item, assetsById));
  const clips = scenes.map((scene, index) => toRenderClip(scene, index, videoItems, state.assets, assetsById));
  const blockers = clips.filter((clip) => !clip.ready).map((clip) => clip.missingReason ?? `${clip.label} needs an approved source video.`);
  const runtimeSeconds = clips.reduce((total, clip) => total + clip.durationSeconds, 0);

  return {
    schemaVersion: 1,
    engine: "NOX Render Engine V1",
    workspaceId: state.workspace.id,
    projectId,
    projectTitle: project?.title ?? projectId,
    outputFilename: `${slugify(project?.title ?? projectId)}-final.mp4`,
    format: project?.format ?? "9:16",
    runtimeSeconds,
    fps: 30,
    width: project?.format.includes("16:9") ? 1920 : 1080,
    height: project?.format.includes("16:9") ? 1080 : 1920,
    clips,
    utilityTracks,
    readiness: {
      ready: blockers.length === 0 && clips.length > 0,
      approvedClipCount: clips.filter((clip) => clip.ready).length,
      totalClipCount: clips.length,
      blockers,
    },
    ffmpeg: {
      concatMode: "reencode-concat",
      rendererScript: "scripts/render-nox-cut.mjs",
      workerScript: "scripts/render-worker.mjs",
      notes: [
        "Run scripts/render-worker.mjs to resolve Supabase Storage paths or source URLs into local files before FFmpeg assembly.",
        "V1 preserves timeline order, trim notes, transition labels, title/subtitle/audio/overlay metadata, and approved asset lineage.",
        "The renderer applies clip fades, title/subtitle text, image/text watermark overlays, and local music beds when their utility asset files are resolvable.",
        "Unsupported transition labels fall back to short cinematic fades or clean cuts.",
        "Set NOX_RENDER_UPLOAD=1 when the worker should upload the final MP4 to nox-exports after rendering.",
      ],
    },
    createdAt: new Date().toISOString(),
  };
}

export function exportRenderManifestJson(state: StudioState, projectId: string) {
  return JSON.stringify(createRenderManifest(state, projectId), null, 2);
}

export function summarizeRenderReadiness(manifest: RenderManifest) {
  if (manifest.readiness.ready) {
    return `${manifest.readiness.approvedClipCount}/${manifest.readiness.totalClipCount} clips ready for MP4 assembly.`;
  }

  return `${manifest.readiness.approvedClipCount}/${manifest.readiness.totalClipCount} clips ready; ${manifest.readiness.blockers.length} blocker${manifest.readiness.blockers.length === 1 ? "" : "s"} remain.`;
}

function toRenderClip(
  scene: SceneCard,
  index: number,
  videoItems: TimelineItem[],
  assets: StudioAsset[],
  assetsById: Map<string, StudioAsset>,
): RenderClip {
  const item = videoItems.find((timelineItem) => timelineItem.sceneId === scene.id);
  const asset = resolveSceneAsset(scene, item, assets, assetsById);
  const startTime = item?.startTime ?? index * scene.durationSeconds;
  const endTime = item?.endTime ?? startTime + scene.durationSeconds;
  const durationSeconds = Math.max(endTime - startTime, scene.durationSeconds);
  const hasApprovedAsset = Boolean(asset?.type === "Video" && asset.status === "Approved");
  const ready = approvedStatuses.has(scene.status) && hasApprovedAsset;
  const label = `SCENE ${String(scene.number).padStart(2, "0")} - ${scene.title}`;

  return {
    sceneId: scene.id,
    sceneNumber: scene.number,
    label,
    sourceAssetId: asset?.id,
    sourceFilename: asset?.filename ?? scene.uploadedAsset,
    sourceUrl: asset?.fileUrl,
    storagePath: asset?.storagePath,
    startTime,
    endTime,
    durationSeconds,
    transitionIn: item?.transitionIn ?? (index === 0 ? "Blackout Cut" : "Cyberglass Swipe"),
    transitionOut: item?.transitionOut ?? "Signal Glitch",
    trimStartNote: item?.trimStartNote ?? "Start on first clean usable frame.",
    trimEndNote: item?.trimEndNote ?? "End before provider reset or unwanted extra motion.",
    editorNotes: item?.editorNotes ?? "No additional editor notes.",
    provider: asset?.provider ?? scene.externalProvider ?? scene.promptProvider ?? "Unknown provider",
    promptId: asset?.promptId ?? scene.id,
    ready,
    missingReason: ready ? undefined : `${label} needs an approved video asset before MP4 rendering.`,
  };
}

function toRenderUtilityTrack(item: TimelineItem, assetsById: Map<string, StudioAsset>): RenderUtilityTrack {
  const asset = item.assetId ? assetsById.get(item.assetId) : undefined;

  return {
    id: item.id,
    trackType: item.trackType,
    label: item.label,
    startTime: item.startTime,
    endTime: item.endTime,
    transitionIn: item.transitionIn,
    transitionOut: item.transitionOut,
    textOverlay: item.textOverlay,
    subtitleText: item.subtitleText,
    assetId: item.assetId,
    assetFilename: asset?.filename,
    assetSourceUrl: asset?.fileUrl,
    assetStoragePath: asset?.storagePath,
    assetMimeType: asset?.mimeType,
    assetType: asset?.type,
  };
}

function resolveSceneAsset(
  scene: SceneCard,
  item: TimelineItem | undefined,
  assets: StudioAsset[],
  assetsById: Map<string, StudioAsset>,
) {
  return (
    (item?.assetId ? assetsById.get(item.assetId) : undefined) ??
    (scene.approvedAssetId ? assetsById.get(scene.approvedAssetId) : undefined) ??
    assets.find((asset) => asset.sceneId === scene.id && asset.type === "Video" && asset.status === "Approved") ??
    assets.find((asset) => asset.sceneId === scene.id && asset.type === "Video")
  );
}

function compareTimelineItems(a: TimelineItem, b: TimelineItem) {
  return (
    a.startTime - b.startTime ||
    trackSortRank(a.trackType) - trackSortRank(b.trackType) ||
    a.orderIndex - b.orderIndex ||
    a.label.localeCompare(b.label)
  );
}

function trackSortRank(trackType: TimelineItem["trackType"]) {
  const order: Record<TimelineItem["trackType"], number> = {
    title: 0,
    video: 1,
    subtitle: 2,
    audio: 3,
    overlay: 4,
    transition: 5,
  };
  return order[trackType];
}

function slugify(value: Project["title"]) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "nox-render";
}
