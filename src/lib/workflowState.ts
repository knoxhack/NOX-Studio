import type { GenerationJob, Project, SceneCard, StudioAsset, StudioState, ViewKey } from "../types";
import { isDesktop } from "./desktopBridge";
import { createRenderManifest } from "./renderEngine";
import { isSupabaseConfigured } from "./supabaseClient";

export type GenerationModeId = "desktop-grok-ready" | "desktop-grok-missing-key" | "browser-supabase-ready" | "manual-handoff";

export type GenerationMode = {
  id: GenerationModeId;
  label: string;
  description: string;
  canRunVideo: boolean;
  primaryAction: string;
};

export type SceneVideoState = {
  status: "No clip" | "Queued" | "Running" | "Ready for review" | "Approved" | "Failed";
  label: string;
  job?: GenerationJob;
  asset?: StudioAsset;
  canGenerate: boolean;
  canRun: boolean;
  canPreview: boolean;
  canApprove: boolean;
};

export type ProjectWorkflowState = {
  project: Project;
  sceneCount: number;
  approvedClipCount: number;
  missingClipCount: number;
  reviewClipCount: number;
  queuedClipCount: number;
  runningClipCount: number;
  failedClipCount: number;
  renderState: ReturnType<typeof getRenderState>;
  finalExportAsset?: StudioAsset;
  renderJob?: GenerationJob;
  blockers: string[];
  nextActionLabel: string;
  nextView: ViewKey;
};

const openStatuses = new Set<GenerationJob["status"]>(["Queued", "Running"]);
const reviewStatuses = new Set<GenerationJob["status"]>(["Completed", "Needs Review"]);
const renderTaskPattern = /render engine|ffmpeg|mp4 assembly/i;
const sceneVideoTaskPattern = /scene\s+\d+.*video|video generation|grok video|manual video|manual handoff|storage/i;
const imageTaskPattern = /poster|thumbnail|image|reference|brand visual|brand asset/i;

export function getGenerationMode(state: StudioState): GenerationMode {
  const grokProvider = state.providers.find((provider) => provider.id === "grok");
  const grokEnabled = Boolean(grokProvider?.enabled);
  const grokConfigured = grokEnabled && grokProvider?.connectionStatus === "Configured";

  if (isDesktop() && grokEnabled && grokConfigured) {
    return {
      id: "desktop-grok-ready",
      label: "Grok Desktop Ready",
      description: "Scene clips can be queued and run through the desktop Grok worker.",
      canRunVideo: true,
      primaryAction: "Generate with Grok",
    };
  }

  if (isDesktop() && grokEnabled && !grokConfigured) {
    return {
      id: "desktop-grok-missing-key",
      label: "Grok Key Missing",
      description: "Grok is enabled, but a configured key is required before real video generation can run.",
      canRunVideo: false,
      primaryAction: "Set Up Grok",
    };
  }

  if (isSupabaseConfigured && grokEnabled) {
    return {
      id: "browser-supabase-ready",
      label: "Hosted Worker Ready",
      description: "Jobs can be queued for the hosted generation worker.",
      canRunVideo: true,
      primaryAction: "Queue Hosted Job",
    };
  }

  return {
    id: "manual-handoff",
    label: "Manual Handoff",
    description: "Copy the prompt into an external provider, then upload the finished clip.",
    canRunVideo: false,
    primaryAction: "Copy Prompt",
  };
}

export function getSceneVideoState(state: StudioState, sceneId: string): SceneVideoState {
  const scene = state.scenes.find((item) => item.id === sceneId);
  const asset = getSceneVideoAsset(state.assets, scene);
  const job = state.generationJobs.find((item) => item.sceneId === sceneId && isSceneVideoGenerationJob(item));

  if (asset?.status === "Approved" || scene?.approvedAssetId) {
    return {
      status: "Approved",
      label: "Approved clip ready for NOX Cut.",
      job,
      asset,
      canGenerate: true,
      canRun: false,
      canPreview: Boolean(asset),
      canApprove: false,
    };
  }

  if (asset || scene?.uploadedAsset || job?.status === "Completed" || job?.status === "Needs Review") {
    return {
      status: "Ready for review",
      label: "Clip is ready to preview and approve.",
      job,
      asset,
      canGenerate: true,
      canRun: false,
      canPreview: Boolean(asset || scene?.uploadedAsset),
      canApprove: Boolean(asset || scene?.uploadedAsset),
    };
  }

  if (job?.status === "Running") {
    return {
      status: "Running",
      label: "Generation is currently running.",
      job,
      asset,
      canGenerate: false,
      canRun: false,
      canPreview: false,
      canApprove: false,
    };
  }

  if (job?.status === "Queued") {
    return {
      status: "Queued",
      label: "Clip job is queued for this Scene Card.",
      job,
      asset,
      canGenerate: false,
      canRun: true,
      canPreview: false,
      canApprove: false,
    };
  }

  if (job?.status === "Failed") {
    return {
      status: "Failed",
      label: job.errorMessage || "The last clip job failed.",
      job,
      asset,
      canGenerate: true,
      canRun: false,
      canPreview: false,
      canApprove: false,
    };
  }

  return {
    status: "No clip",
    label: "Generate or upload one 10-second clip for this Scene Card.",
    job,
    asset,
    canGenerate: true,
    canRun: false,
    canPreview: false,
    canApprove: false,
  };
}

export function getProjectWorkflowState(state: StudioState, projectId: string): ProjectWorkflowState | undefined {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return undefined;

  const scenes = getProjectScenes(state, projectId);
  const sceneStates = scenes.map((scene) => getSceneVideoState(state, scene.id));
  const approvedClipCount = sceneStates.filter((item) => item.status === "Approved").length;
  const missingClipCount = sceneStates.filter((item) => item.status === "No clip" || item.status === "Failed").length;
  const reviewClipCount = sceneStates.filter((item) => item.status === "Ready for review").length;
  const queuedClipCount = sceneStates.filter((item) => item.status === "Queued").length;
  const runningClipCount = sceneStates.filter((item) => item.status === "Running").length;
  const failedClipCount = sceneStates.filter((item) => item.status === "Failed").length;
  const renderState = getRenderState(state, projectId);
  const blockers = getProjectBlockers(state, projectId);
  const renderJob = getLatestRenderJob(state, projectId);
  const finalExportAsset = getFinalExportAsset(state, projectId);

  return {
    project,
    sceneCount: scenes.length,
    approvedClipCount,
    missingClipCount,
    reviewClipCount,
    queuedClipCount,
    runningClipCount,
    failedClipCount,
    renderState,
    finalExportAsset,
    renderJob,
    blockers,
    ...getNextProjectAction({
      sceneCount: scenes.length,
      approvedClipCount,
      missingClipCount,
      reviewClipCount,
      queuedClipCount,
      runningClipCount,
      finalExportAsset,
      renderState,
    }),
  };
}

export function getRenderState(state: StudioState, projectId: string) {
  const scenes = getProjectScenes(state, projectId);
  const finalExportAsset = getFinalExportAsset(state, projectId);
  const renderJob = getLatestRenderJob(state, projectId);
  const manifest = scenes.length ? createRenderManifest(state, projectId) : undefined;

  if (finalExportAsset) {
    return { id: "final-ready" as const, label: "Final MP4 Ready", ready: true, blockers: [], renderJob, finalExportAsset };
  }
  if (!scenes.length) {
    return { id: "no-scenes" as const, label: "Create Scene Cards first", ready: false, blockers: ["No Scene Cards exist yet."], renderJob };
  }
  if (renderJob?.status === "Running") {
    return { id: "rendering" as const, label: "Rendering", ready: false, blockers: [], renderJob };
  }
  if (renderJob?.status === "Queued") {
    return { id: "queued" as const, label: "Render Queued", ready: true, blockers: [], renderJob };
  }
  if (renderJob?.status === "Failed") {
    return { id: "failed" as const, label: "Render Failed", ready: false, blockers: [renderJob.errorMessage || "Render job failed."], renderJob };
  }
  if (manifest?.readiness.ready) {
    return { id: "ready" as const, label: "Ready To Render", ready: true, blockers: [], renderJob };
  }
  return {
    id: "not-ready" as const,
    label: "Not Ready",
    ready: false,
    blockers: manifest?.readiness.blockers ?? ["Approved scene videos are required before rendering."],
    renderJob,
  };
}

export function getProjectBlockers(state: StudioState, projectId: string) {
  const scenes = getProjectScenes(state, projectId);
  const blockers: string[] = [];
  if (!scenes.length) blockers.push("Create Scene Cards before clip generation.");
  const missing = scenes.filter((scene) => getSceneVideoState(state, scene.id).status === "No clip" || getSceneVideoState(state, scene.id).status === "Failed");
  const review = scenes.filter((scene) => getSceneVideoState(state, scene.id).status === "Ready for review");
  if (missing.length) blockers.push(`${missing.length} Scene Card${missing.length === 1 ? "" : "s"} need video clips.`);
  if (review.length) blockers.push(`${review.length} generated clip${review.length === 1 ? "" : "s"} need review.`);
  return blockers;
}

export function getFocusedGenerationJobs(state: StudioState, projectId?: string, sceneId?: string) {
  return state.generationJobs.filter((job) => {
    if (sceneId && job.sceneId === sceneId) return true;
    if (projectId && job.projectId === projectId) return true;
    return !projectId && !sceneId;
  });
}

export function isSceneVideoGenerationJob(job: GenerationJob) {
  return sceneVideoTaskPattern.test(`${job.task} ${job.provider} ${job.usageMetadata?.route ?? ""}`);
}

export function isRenderGenerationJob(job: GenerationJob) {
  return renderTaskPattern.test(`${job.task} ${job.provider} ${job.usageMetadata?.route ?? ""}`);
}

export function isImageGenerationJob(job: GenerationJob) {
  return imageTaskPattern.test(`${job.task} ${job.provider} ${job.usageMetadata?.route ?? ""}`);
}

export function isOpenGenerationJob(job: GenerationJob) {
  return openStatuses.has(job.status);
}

export function isReviewGenerationJob(job: GenerationJob) {
  return reviewStatuses.has(job.status);
}

function getProjectScenes(state: StudioState, projectId: string) {
  return state.scenes.filter((scene) => scene.projectId === projectId).sort((a, b) => a.number - b.number);
}

function getSceneVideoAsset(assets: StudioAsset[], scene?: SceneCard) {
  if (!scene) return undefined;
  return (
    (scene.approvedAssetId ? assets.find((asset) => asset.id === scene.approvedAssetId) : undefined) ??
    assets.find((asset) => asset.sceneId === scene.id && asset.type === "Video" && asset.status === "Approved") ??
    assets.find((asset) => asset.sceneId === scene.id && asset.type === "Video" && asset.status !== "Rejected")
  );
}

function getLatestRenderJob(state: StudioState, projectId: string) {
  return state.generationJobs.find((job) => job.projectId === projectId && isRenderGenerationJob(job));
}

function getFinalExportAsset(state: StudioState, projectId: string) {
  return state.assets.find((asset) => asset.projectId === projectId && asset.type === "Final Export");
}

function getNextProjectAction({
  sceneCount,
  approvedClipCount,
  missingClipCount,
  reviewClipCount,
  queuedClipCount,
  runningClipCount,
  finalExportAsset,
  renderState,
}: {
  sceneCount: number;
  approvedClipCount: number;
  missingClipCount: number;
  reviewClipCount: number;
  queuedClipCount: number;
  runningClipCount: number;
  finalExportAsset?: StudioAsset;
  renderState: ReturnType<typeof getRenderState>;
}) {
  if (!sceneCount) return { nextActionLabel: "Create Scene Cards", nextView: "create" as ViewKey };
  if (missingClipCount) return { nextActionLabel: "Generate Missing Clips", nextView: "cut" as ViewKey };
  if (queuedClipCount || runningClipCount) return { nextActionLabel: "Open Generation Queue", nextView: "vault" as ViewKey };
  if (reviewClipCount) return { nextActionLabel: "Review Clips", nextView: "scene" as ViewKey };
  if (approvedClipCount === sceneCount && !finalExportAsset && renderState.ready) return { nextActionLabel: "Generate Full Short Film", nextView: "cut" as ViewKey };
  if (finalExportAsset) return { nextActionLabel: "Publish", nextView: "publish" as ViewKey };
  return { nextActionLabel: "Open NOX Cut", nextView: "cut" as ViewKey };
}
