import type { GenerationJob, Provider, SceneCard, StudioAsset, StudioState } from "../types";
import { generateScenePrompt } from "./generationGateway";
import { runContinuityCheck, type PromptContext } from "./noxCore";
import { createRenderManifest, summarizeRenderReadiness } from "./renderEngine";
import { isDesktop, desktopGrok, desktopRender, desktopPublish, type NoxDesktopAsset, type AsyncVideoJob } from "./desktopBridge";

export type GenerationJobRunResult = {
  job: GenerationJob;
  scene?: SceneCard;
  asset?: StudioAsset;
  message: string;
};

type GenerationJobRunInput = {
  job: GenerationJob;
  state: StudioState;
  promptContext?: PromptContext;
};

const promptTaskPattern = /prompt|story|continuity|caption|poster|metadata/i;
const continuityTaskPattern = /continuity check|continuity review|continuity audit|continuity/i;
const imageTaskPattern = /poster|thumbnail|image|reference|brand visual|brand asset/i;
const videoTaskPattern = /video|sora|veo|kling|runway|grok/i;
const releaseTaskPattern = /release operation|publishing|publish/i;
const terminalStatuses = new Set<GenerationJob["status"]>(["Completed", "Failed", "Approved"]);

export async function runGenerationJob({ job, state, promptContext }: GenerationJobRunInput): Promise<GenerationJobRunResult> {
  const provider = resolveJobProvider(job, state.providers);

  if (!provider.enabled && provider.id !== "manual") {
    const failedJob = settleJob(job, "Failed", `${provider.name} is disabled for this workspace. Enable it in Settings before running this job.`);
    return { job: failedJob, message: failedJob.errorMessage || `${job.task} failed.` };
  }

  if (isRenderJob(job)) {
    return runRenderHandoffJob(job, state);
  }

  if (isScenePromptJob(job)) {
    return runScenePromptJob(job, state, provider, promptContext);
  }

  if (isContinuityJob(job)) {
    return runContinuityReviewJob(job, state, provider);
  }

  if (isReleaseOperationJob(job)) {
    return runReleaseOperationJob(job, state);
  }

  if (isImageGenerationJob(job)) {
    return runImageGenerationHandoffJob(job, state, provider);
  }

  if (isVideoProviderJob(job)) {
    return runVideoProviderHandoffJob(job, state, provider);
  }

  if (promptTaskPattern.test(job.task)) {
    const nextJob = settleJob(
      job,
      provider.mode === "API" ? "Completed" : "Needs Review",
      `${provider.name} route prepared ${provider.mode === "API" ? "for metadata/prompt work" : "as a manual review handoff"}.`,
      {
        cost: provider.mode === "API" ? "$0.02 est" : "Manual",
        costActual: provider.mode === "API" ? 0.02 : undefined,
        costCurrency: "USD",
        usageMetadata: {
          route: "local-generation-runner",
          provider: provider.name,
          task: job.task,
        },
        outputPayload: `${job.task} routed through ${provider.name}.`,
      },
    );
    return { job: nextJob, message: `${job.task} routed through ${provider.name}.` };
  }

  const completedJob = settleJob(job, "Completed", "Local worker completed this queued production task.", {
    cost: job.cost || "Local worker",
    costActual: 0,
    costCurrency: "USD",
    usageMetadata: { route: "local-generation-runner", task: job.task },
  });
  return { job: completedJob, message: `${job.task} completed.` };
}

export function resolveJobProvider(job: GenerationJob, providers: Provider[]) {
  const routeText = `${job.provider} ${job.task}`.toLowerCase();
  const provider =
    providers.find((candidate) => candidate.id !== "manual" && routeText.includes(candidate.id.toLowerCase())) ??
    providers.find((candidate) => candidate.id !== "manual" && routeText.includes(candidate.name.toLowerCase())) ??
    providers.find((candidate) => routeText.includes(candidate.id.toLowerCase())) ??
    providers.find((candidate) => routeText.includes(candidate.name.toLowerCase())) ??
    providers.find((candidate) => candidate.id === "manual") ??
    providers[0];

  return provider ?? {
    id: "manual",
    name: "Manual Mode",
    supportedTasks: "Copy prompts, upload generated clips",
    speed: "User-paced",
    quality: "Provider-dependent",
    enabled: true,
    mode: "Manual" as const,
  };
}

function isRenderJob(job: GenerationJob) {
  return /render engine|ffmpeg|mp4 assembly/i.test(`${job.task} ${job.provider}`);
}

function isScenePromptJob(job: GenerationJob) {
  return Boolean(job.sceneId && /scene prompt|prompt regeneration|prompt polish/i.test(job.task));
}

function isContinuityJob(job: GenerationJob) {
  return Boolean(job.sceneId && continuityTaskPattern.test(`${job.task} ${job.provider}`));
}

function isVideoProviderJob(job: GenerationJob) {
  return videoTaskPattern.test(`${job.task} ${job.provider}`);
}

function isImageGenerationJob(job: GenerationJob) {
  return imageTaskPattern.test(`${job.task} ${job.inputPayload} ${job.provider}`);
}

function isReleaseOperationJob(job: GenerationJob) {
  return releaseTaskPattern.test(`${job.task} ${job.provider}`) || parseReleaseOperationPlan(job.inputPayload)?.operation === "NOX Release Operation";
}

function runRenderHandoffJob(job: GenerationJob, state: StudioState): Promise<GenerationJobRunResult> | GenerationJobRunResult {
  const projectId = job.projectId ?? state.projects[0]?.id;
  const manifest = parseManifest(job.inputPayload) ?? (projectId ? createRenderManifest(state, projectId) : undefined);

  if (!manifest) {
    const failedJob = settleJob(job, "Failed", "Render job is missing a project or manifest payload.");
    return { job: failedJob, message: failedJob.errorMessage || "Render job failed." };
  }

  if (!manifest.readiness.ready) {
    const detail = `${summarizeRenderReadiness(manifest)} ${manifest.readiness.blockers.join(" ")}`;
    const reviewJob = settleJob(job, "Needs Review", detail, {
      outputPayload: detail,
      errorMessage: manifest.readiness.blockers.join("\n"),
    });
    return { job: reviewJob, message: "Render job needs approved Scene Card videos before export." };
  }

  if (isDesktop()) {
    return runDesktopRender(job, manifest);
  }

  const outputPayload = `Renderer handoff ready for ${manifest.outputFilename}. Run npm run render:worker -- ${job.projectId ?? "render-manifest"}.json ${manifest.outputFilename} on a worker with FFmpeg; set NOX_RENDER_UPLOAD=1 to upload the finished MP4 to nox-exports.`;
  const reviewJob = settleJob(job, "Needs Review", "FFmpeg render handoff is ready for worker execution.", {
    cost: "Local worker",
    outputPayload,
  });
  return { job: reviewJob, message: "Render worker handoff prepared." };
}

async function runDesktopRender(job: GenerationJob, manifest: ReturnType<typeof createRenderManifest>): Promise<GenerationJobRunResult> {
  try {
    const renderResult = await desktopRender.runRender({ manifest: manifest as unknown as Record<string, unknown> });
    const desktopAsset = renderResult.asset;
    const asset = toStudioAsset(desktopAsset, job.workspaceId, job.projectId);
    const completedJob = settleJob(job, "Completed", `NOX Cut rendered ${manifest.outputFilename} locally.`, {
      cost: "Local render",
      costActual: 0,
      costCurrency: "USD",
      usageMetadata: {
        route: "desktop-render",
        renderer: "NOX Render Engine V1",
        outputPath: desktopAsset.filePath,
      },
      outputPayload: JSON.stringify({ outputPath: desktopAsset.filePath, assetId: asset.id }, null, 2),
    });
    return { job: completedJob, asset, message: `Rendered ${asset.filename} locally.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedJob = settleJob(job, "Failed", `Local render failed: ${message}`, {
      errorMessage: message,
    });
    return { job: failedJob, message: `Render failed: ${message}` };
  }
}

async function runScenePromptJob(job: GenerationJob, state: StudioState, provider: Provider, promptContext?: PromptContext) {
  const scene = state.scenes.find((item) => item.id === job.sceneId);
  if (!scene) {
    const failedJob = settleJob(job, "Failed", "Scene prompt job could not find its linked Scene Card.");
    return { job: failedJob, message: failedJob.errorMessage || "Scene prompt job failed." };
  }

  const providerName = provider.id === "manual" ? scene.promptProvider ?? scene.externalProvider ?? "Universal Prompt" : provider.name;
  const action = /polish/i.test(job.task) ? "polish" : "regenerate";
  const result = await generateScenePrompt({ scene, provider: providerName, workspaceId: state.workspace.id, context: promptContext, action });
  const nextScene = { ...result.data, externalProvider: providerName };
  const detail = result.error
    ? `${providerName} prompt job used local fallback after provider error: ${result.error}`
    : `${providerName} prompt job completed via ${result.mode === "supabase" ? "Supabase Edge Function" : "local NOX Core"}.`;
  const nextJob = settleJob(job, "Completed", detail, {
    cost: result.mode === "supabase" ? "$0.02 est" : "$0 local",
    costActual: result.mode === "supabase" ? 0.02 : 0,
    costCurrency: "USD",
    usageMetadata: {
      route: result.mode === "supabase" ? "supabase-edge" : "local-nox-core",
      provider: providerName,
      action,
    },
    outputPayload: `${nextScene.promptProvider ?? providerName} ${action} pass generated.`,
  });

  return { job: nextJob, scene: nextScene, message: detail };
}

function runContinuityReviewJob(job: GenerationJob, state: StudioState, provider: Provider): GenerationJobRunResult {
  const scene = state.scenes.find((item) => item.id === job.sceneId);
  if (!scene) {
    const failedJob = settleJob(job, "Failed", "Continuity review could not find its linked Scene Card.");
    return { job: failedJob, message: failedJob.errorMessage || "Continuity review failed." };
  }

  const report = runContinuityCheck(scene, state.characters, state.worlds, state.locations, state.factions);
  const issueCount = report.issues.filter((issue) => issue.severity !== "Pass").length;
  const status = report.status === "Pass" ? "Completed" : "Needs Review";
  const outputPayload = JSON.stringify(
    {
      operation: "NOX Continuity Review",
      route: "local-generation-runner",
      provider: provider.name,
      report,
      nextAction:
        report.status === "Pass"
          ? "Scene Card is ready for prompt/video work."
          : "Fix missing continuity links in Character Vault, World Bible, Location, or Faction records before final approval.",
    },
    null,
    2,
  );
  const nextJob = settleJob(job, status, `${provider.name} continuity review: ${report.summary}`, {
    cost: provider.mode === "API" ? "$0.01 est" : "Local continuity",
    costActual: provider.mode === "API" ? 0.01 : 0,
    costCurrency: "USD",
    usageMetadata: {
      route: "local-continuity-review",
      issueCount,
      matchedCharacters: report.matchedCharacters.length,
      matchedWorlds: report.matchedWorlds.length,
    },
    outputPayload,
    errorMessage: status === "Needs Review" ? report.issues.map((issue) => `${issue.severity}: ${issue.label} - ${issue.message}`).join("\n") : "",
  });

  return { job: nextJob, message: `${report.summary} ${issueCount} issue${issueCount === 1 ? "" : "s"} reported.` };
}

async function runVideoProviderHandoffJob(job: GenerationJob, state: StudioState, provider: Provider): Promise<GenerationJobRunResult> {
  if (!isDesktop()) {
    const scene = job.sceneId ? state.scenes.find((item) => item.id === job.sceneId) : undefined;
    const modeDetail = provider.mode === "API" ? "API handoff queued for provider execution" : "manual handoff package prepared";
    const outputPayload = scene
      ? `${modeDetail}: paste/upload Scene ${String(scene.number).padStart(2, "0")} prompt into ${provider.name}, then attach the generated 10-second clip to this Scene Card.`
      : `${modeDetail}: ${job.inputPayload}`;
    const nextJob = settleJob(job, "Needs Review", `${provider.name} ${modeDetail}.`, {
      cost: provider.mode === "API" ? "Provider API" : "External",
      outputPayload,
    });
    return { job: nextJob, message: `${job.task} routed to ${provider.name}.` };
  }

  const prompt = extractPromptFromJob(job);
  if (!prompt) {
    const failedJob = settleJob(job, "Failed", "Video generation job is missing a prompt.");
    return { job: failedJob, message: failedJob.errorMessage || "Video generation failed." };
  }

  try {
    const result = await desktopGrok.generateVideo({
      prompt,
      workspaceId: job.workspaceId,
      projectId: job.projectId ?? state.projects[0]?.id ?? job.workspaceId,
      sceneId: job.sceneId,
    });

    if (isAsyncVideoJob(result)) {
      const pollResult = await desktopGrok.pollVideoJob({ jobId: result.jobId });
      if (isAsyncVideoJob(pollResult)) {
        const runningJob = settleJob(job, "Running", `Grok video job is still processing. Provider job id: ${result.jobId}`, {
          providerJobId: result.jobId,
          usageMetadata: {
            route: "desktop-grok-video-async",
            providerJobId: result.jobId,
            model: result.model,
          },
          outputPayload: JSON.stringify({ providerJobId: result.jobId, status: "Running" }),
        });
        return { job: runningJob, message: `Grok video job ${result.jobId} is still processing.` };
      }
      const completedDesktopAsset = pollResult as NoxDesktopAsset;
      const asset = toStudioAsset(completedDesktopAsset, job.workspaceId, job.projectId, job.sceneId);
      const scene = job.sceneId ? state.scenes.find((item) => item.id === job.sceneId) : undefined;
      const nextScene = scene
        ? {
            ...scene,
            status: "Video Uploaded" as const,
            uploadedAsset: asset.filename,
            approvedAssetId: undefined,
            externalProvider: "Grok",
          }
        : undefined;

      const completedJob = settleJob(job, "Completed", `Grok generated video saved to ${asset.filename}.`, {
        cost: "Grok video",
        costActual: completedDesktopAsset.estimatedCostUsd,
        costCurrency: "USD",
        providerJobId: completedDesktopAsset.providerJobId,
        usageMetadata: {
          route: "desktop-grok-video-async",
          model: completedDesktopAsset.providerModel,
          outputPath: completedDesktopAsset.filePath,
          ...completedDesktopAsset.usage,
        },
        providerResponse: completedDesktopAsset.providerResponseSummary,
        outputPayload: JSON.stringify({ assetId: asset.id, filePath: completedDesktopAsset.filePath }),
      });
      return { job: completedJob, asset, scene: nextScene, message: `Grok video generated: ${asset.filename}.` };
    }

    const desktopAsset = result as NoxDesktopAsset;
    const asset = toStudioAsset(desktopAsset, job.workspaceId, job.projectId, job.sceneId);
    const scene = job.sceneId ? state.scenes.find((item) => item.id === job.sceneId) : undefined;
    const nextScene = scene
      ? {
          ...scene,
          status: "Video Uploaded" as const,
          uploadedAsset: asset.filename,
          approvedAssetId: undefined,
          externalProvider: "Grok",
        }
      : undefined;

    const completedJob = settleJob(job, "Completed", `Grok generated video saved to ${asset.filename}.`, {
      cost: "Grok video",
      costActual: desktopAsset.estimatedCostUsd,
      costCurrency: "USD",
      providerJobId: desktopAsset.providerJobId,
      usageMetadata: {
        route: "desktop-grok-video",
        model: desktopAsset.providerModel,
        outputPath: desktopAsset.filePath,
        ...desktopAsset.usage,
      },
      providerResponse: desktopAsset.providerResponseSummary,
      outputPayload: JSON.stringify({ assetId: asset.id, filePath: desktopAsset.filePath }),
    });
    return { job: completedJob, asset, scene: nextScene, message: `Grok video generated: ${asset.filename}.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedJob = settleJob(job, "Failed", `Grok video generation failed: ${message}`, {
      errorMessage: message,
    });
    return { job: failedJob, message: `Grok video generation failed: ${message}` };
  }
}

async function runImageGenerationHandoffJob(job: GenerationJob, state: StudioState, provider: Provider): Promise<GenerationJobRunResult> {
  if (!isDesktop()) {
    const detail =
      provider.mode === "API"
        ? `${provider.name} image generation needs the Supabase Grok processor or hosted worker to complete.`
        : `${provider.name} image prompt package prepared for manual review.`;
    const nextJob = settleJob(job, "Needs Review", detail, {
      cost: provider.mode === "API" ? "Grok image" : "Manual",
      outputPayload: detail,
      usageMetadata: {
        route: provider.mode === "API" ? "grok-image" : "manual-image-handoff",
        provider: provider.name,
        assetType: resolveImageAssetType(job),
      },
    });
    return { job: nextJob, message: detail };
  }

  const prompt = extractPromptFromJob(job);
  if (!prompt) {
    const failedJob = settleJob(job, "Failed", "Image generation job is missing a prompt.");
    return { job: failedJob, message: failedJob.errorMessage || "Image generation failed." };
  }

  try {
    const result = await desktopGrok.generateImage({
      prompt,
      workspaceId: job.workspaceId,
      projectId: job.projectId ?? state.projects[0]?.id ?? job.workspaceId,
      sceneId: job.sceneId,
      type: resolveImageAssetType(job),
    });

    const asset = toStudioAsset(result, job.workspaceId, job.projectId, job.sceneId);
    const completedJob = settleJob(job, "Completed", `Grok generated ${asset.type} saved to ${asset.filename}.`, {
      cost: "Grok image",
      costActual: result.estimatedCostUsd,
      costCurrency: "USD",
      providerJobId: result.providerJobId,
      usageMetadata: {
        route: "desktop-grok-image",
        model: result.providerModel,
        outputPath: result.filePath,
        ...result.usage,
      },
      providerResponse: result.providerResponseSummary,
      outputPayload: JSON.stringify({ assetId: asset.id, filePath: result.filePath }),
    });
    return { job: completedJob, asset, message: `Grok ${asset.type} generated: ${asset.filename}.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedJob = settleJob(job, "Failed", `Grok image generation failed: ${message}`, {
      errorMessage: message,
    });
    return { job: failedJob, message: `Grok image generation failed: ${message}` };
  }
}

function runReleaseOperationJob(job: GenerationJob, state: StudioState): GenerationJobRunResult | Promise<GenerationJobRunResult> {
  const plan = parseReleaseOperationPlan(job.inputPayload);
  if (!plan) {
    const failedJob = settleJob(job, "Failed", "Release operation job is missing a NOX Release Operation payload.");
    return { job: failedJob, message: failedJob.errorMessage || "Release operation failed." };
  }

  const blockers = Array.isArray(plan.blockers) ? plan.blockers.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  const finalVideo = plan.files && typeof plan.files === "object" ? (plan.files as { finalVideo?: unknown }).finalVideo : undefined;
  const metadata = plan.metadata && typeof plan.metadata === "object" ? (plan.metadata as { title?: unknown; description?: unknown }) : {};
  const schedule = plan.schedule && typeof plan.schedule === "object" ? (plan.schedule as { status?: unknown; recommendedWindow?: unknown }) : {};
  const ready = Boolean(plan.ready) && blockers.length === 0 && Boolean(finalVideo);

  if (!ready) {
    const detail = `${plan.platform ?? "Platform"} release operation needs review: ${blockers.join(", ") || "final MP4 or release metadata missing"}.`;
    const reviewJob = settleJob(job, "Needs Review", detail, {
      outputPayload: JSON.stringify({ ...plan, uploadMode: "export-package", nextAction: "Resolve readiness blockers, then queue the release operation again." }, null, 2),
      errorMessage: blockers.join("\n") || "final MP4 or release metadata missing",
    });
    return { job: reviewJob, message: detail };
  }

  if (isDesktop()) {
    return runDesktopReleasePackage(job, state, plan, finalVideo as Partial<StudioAsset>, metadata, schedule);
  }

  const detail = `${plan.platform ?? "Platform"} release operation is ready to upload or schedule.`;
  const uploadId = `nox-${slugForId(String(plan.platform ?? "platform"))}-${job.id}`;
  const outputPayload = JSON.stringify(
    {
      operation: "NOX Release Operation Result",
      route: "local-generation-runner",
      platform: plan.platform,
      ready,
      blockers,
      releaseStatus: "Scheduled",
      uploadMode: "export-package",
      uploadId,
      finalUrl: "",
      finalVideo,
      metadata,
      schedule,
      nextAction: "Upload or schedule the final package on the target platform.",
    },
    null,
    2,
  );
  const nextJob = settleJob(job, "Completed", detail, {
    cost: "Publishing ops",
    costActual: 0,
    costCurrency: "USD",
    usageMetadata: {
      route: "local-release-operation",
      platform: plan.platform,
      blockerCount: blockers.length,
      uploadMode: "export-package",
      uploadId,
      scheduledFor: schedule.recommendedWindow,
      finalUrl: "",
    },
    outputPayload,
  });

  return { job: nextJob, message: detail };
}

async function runDesktopReleasePackage(
  job: GenerationJob,
  state: StudioState,
  plan: Record<string, unknown>,
  finalVideo: Partial<StudioAsset>,
  metadata: Record<string, unknown>,
  schedule: Record<string, unknown>,
): Promise<GenerationJobRunResult> {
  try {
    const project = state.projects.find((p) => p.id === job.projectId);
    const publishKit = state.publishKits.find((kit) => kit.projectId === job.projectId);
    const finalExportAsset = state.assets.find((asset) => asset.id === finalVideo?.id) ?? finalVideo;
    const posterAsset = state.assets.find((asset) => asset.projectId === job.projectId && asset.type === "Poster" && asset.status === "Approved");
    const thumbnailAsset = state.assets.find((asset) => asset.projectId === job.projectId && asset.type === "Image" && asset.status === "Approved");
    const scenes = state.scenes.filter((scene) => scene.projectId === job.projectId).sort((a, b) => a.number - b.number);

    const result = await desktopPublish.createReleasePackage({
      project: project as unknown as Record<string, unknown>,
      publishKit: publishKit as unknown as Record<string, unknown>,
      platform: String(plan.platform || "Platform"),
      finalExportAsset: finalExportAsset || {},
      posterAsset,
      thumbnailAsset,
      scenes: scenes as unknown as Record<string, unknown>[],
      brandKit: state.brandKit,
    });

    const completedJob = settleJob(job, "Completed", `Local release package created at ${result.packagePath}.`, {
      cost: "Local publish",
      costActual: 0,
      costCurrency: "USD",
      usageMetadata: {
        route: "desktop-publish",
        platform: plan.platform,
        packagePath: result.packagePath,
        files: result.files,
      },
      outputPayload: JSON.stringify(result, null, 2),
    });
    return { job: completedJob, message: `Release package created: ${result.packagePath}.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedJob = settleJob(job, "Failed", `Local release package creation failed: ${message}`, {
      errorMessage: message,
    });
    return { job: failedJob, message: `Release package failed: ${message}` };
  }
}

function extractPromptFromJob(job: GenerationJob): string {
  if (!job.inputPayload) return "";
  try {
    const parsed = JSON.parse(job.inputPayload);
    if (parsed.prompt) return String(parsed.prompt);
    if (parsed.fullPrompt) return String(parsed.fullPrompt);
  } catch {
    // inputPayload is a plain string prompt
  }
  return job.inputPayload.trim();
}

function toStudioAsset(desktopAsset: NoxDesktopAsset, workspaceId: string, projectId?: string, sceneId?: string): StudioAsset {
  return {
    id: desktopAsset.id,
    workspaceId,
    projectId: projectId || desktopAsset.projectId,
    sceneId: sceneId || desktopAsset.sceneId,
    characterId: desktopAsset.characterId,
    filename: desktopAsset.filename,
    type: desktopAsset.type,
    fileUrl: desktopAsset.url,
    storagePath: desktopAsset.storagePath,
    mimeType: desktopAsset.mimeType,
    attachedTo: sceneId ? `Scene ${sceneId}` : projectId ? `Project ${projectId}` : workspaceId,
    status: "Needs Review",
    provider: desktopAsset.providerModel ? `Grok / ${desktopAsset.providerModel}` : "Grok",
    promptId: sceneId || projectId,
    promptUsed: undefined,
    externalJobId: desktopAsset.providerJobId,
    providerModel: desktopAsset.providerModel,
    providerResponse: desktopAsset.providerResponseSummary,
    width: desktopAsset.width,
    height: desktopAsset.height,
    notes: "Generated locally by NOX Desktop.",
    tags: ["desktop-generated"],
    createdAt: new Date().toISOString(),
  };
}

function isAsyncVideoJob(value: NoxDesktopAsset | AsyncVideoJob): value is AsyncVideoJob {
  return typeof value === "object" && value !== null && "async" in value && (value as AsyncVideoJob).async === true;
}

function resolveImageAssetType(job: GenerationJob) {
  const text = `${job.task} ${job.inputPayload}`.toLowerCase();
  if (text.includes("poster")) return "Poster";
  if (text.includes("brand")) return "Brand File";
  if (text.includes("reference")) return "Image";
  return "Image";
}

function slugForId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "platform";
}

function parseManifest(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (parsed?.engine === "NOX Render Engine V1") return parsed as ReturnType<typeof createRenderManifest>;
  } catch {
    return undefined;
  }

  return undefined;
}

function parseReleaseOperationPlan(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (parsed?.operation === "NOX Release Operation") return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }

  return undefined;
}

function settleJob(
  job: GenerationJob,
  status: GenerationJob["status"],
  detail: string,
  options: Partial<Pick<GenerationJob, "cost" | "costActual" | "costCurrency" | "usageMetadata" | "errorMessage" | "outputPayload" | "providerJobId" | "providerResponse">> = {},
): GenerationJob {
  const timestamp = new Date().toISOString();
  return {
    ...job,
    status,
    cost: options.cost ?? job.cost,
    costActual: options.costActual ?? job.costActual,
    costCurrency: options.costCurrency ?? job.costCurrency,
    usageMetadata: options.usageMetadata ?? job.usageMetadata,
    providerJobId: options.providerJobId ?? job.providerJobId,
    providerResponse: options.providerResponse ?? job.providerResponse,
    outputPayload: options.outputPayload ?? (status === "Failed" ? job.outputPayload : detail),
    errorMessage: status === "Failed" ? detail : options.errorMessage ?? "",
    retryCount: job.retryCount ?? 0,
    maxRetries: job.maxRetries ?? 2,
    startedAt: job.startedAt ?? timestamp,
    completedAt: terminalStatuses.has(status) ? timestamp : undefined,
    logs: appendJobLog(job, `${status}: ${detail}`),
  };
}

function appendJobLog(job: GenerationJob, message: string) {
  return [...(job.logs ?? []), `${new Date().toISOString()} - ${message}`].slice(-12);
}
