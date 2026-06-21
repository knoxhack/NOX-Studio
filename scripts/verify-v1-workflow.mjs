import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = process.cwd();
const tempDir = await mkdtemp(join(tmpdir(), "nox-v1-workflow-"));
const outfile = join(tempDir, "workflow-check.mjs");

const entry = `
import {
  createRenderManifest,
  exportRenderManifestJson,
  summarizeRenderReadiness,
} from "./src/lib/renderEngine.ts";

import {
  providers as defaultProviders,
} from "./src/data/studioData.ts";

import {
  runGenerationJob,
} from "./src/lib/generationJobRunner.ts";

import {
  createProductionPackage,
  exportEditPlan,
  exportProjectJson,
  exportProjectMarkdown,
  exportProjectText,
  createReleaseBundle,
  createReleaseOperationPlan,
  exportReleaseBundleJson,
  exportReleaseBundleText,
  generatePublishKit,
  getSceneCount,
  polishScenePrompt,
  regenerateScenePrompt,
  runContinuityCheck,
} from "./src/lib/noxCore.ts";

const failures = [];
const passes = [];

function check(label, condition) {
  if (condition) passes.push(label);
  else failures.push(label);
}

const brandKit = {
  studioName: "NOX Films",
  creatorName: "Knox",
  introText: "A NOX Films Original",
  outroText: "Watch more on NOX Films",
  defaultStyle: "Futuristic cyberglass cinematic",
  defaultExport: "9:16 TikTok + 16:9 YouTube",
  subtitleStyle: "Bold white cinematic subtitles with shadow",
  colors: ["cyan", "magenta", "green"],
  hashtags: ["#NOXFilms", "#AIFilm", "#Cyberglass"],
};

const sceneCountVariants = [
  ["30 seconds = 3 scene cards", 3],
  ["60 seconds = 6 scene cards", 6],
  ["90 seconds = 9 scene cards", 9],
  ["120 seconds = 12 scene cards", 12],
];

for (const [length, expectedCount] of sceneCountVariants) {
  const variantPackage = createProductionPackage({
    title: \`Verifier \${expectedCount} Scene Variant\`,
    idea: "A signal detective tests every supported NOX runtime length.",
    type: "Shortfilm",
    format: "TikTok / Reels / Shorts - 9:16",
    length,
    genre: "Cyberglass thriller",
    tone: "Dark",
    target: "Universal Prompt",
    workspaceId: "workspace-verifier",
    brandKit,
  });

  check(\`\${expectedCount} Scene Card runtime maps correctly\`, getSceneCount(length) === expectedCount);
  check(\`\${expectedCount} Scene Card package generated\`, variantPackage.scenes.length === expectedCount && variantPackage.project.sceneCount === expectedCount);
  check(\`\${expectedCount} Scene Card timeline generated\`, variantPackage.timelineItems.length === expectedCount);
  check(
    \`\${expectedCount} Scene Card timeline is continuous 10-second clips\`,
    variantPackage.timelineItems.every((item, index) => item.startTime === index * 10 && item.endTime === index * 10 + 10),
  );
  check(
    \`\${expectedCount} Scene Card package preserves one-video-per-card invariant\`,
    variantPackage.scenes.every(
      (scene) =>
        scene.durationSeconds === 10 &&
        scene.output === "One generated video" &&
        scene.beats.length >= 1 &&
        scene.beats.length <= 3 &&
        scene.continuityRules.some((rule) => rule.includes("Do not split this Scene Card")),
    ),
  );
}

const productionPackage = createProductionPackage({
  title: "Verifier Signal",
  idea: "A courier finds a hidden AI saint inside an old market speaker.",
  type: "Shortfilm",
  format: "TikTok / Reels / Shorts - 9:16",
  length: "60 seconds = 6 scene cards",
  genre: "Urban Honduran cinema",
  tone: "Dark",
  target: "Grok",
  workspaceId: "workspace-verifier",
  brandKit,
  language: {
    promptLanguage: "Spanish",
    dialogueLanguage: "Spanish",
    subtitles: "English",
    voiceStyle: "Garifuna-influenced Honduran Spanish",
  },
});

const { project, scenes, characters, worlds, locations, factions } = productionPackage;

check("project generated", project.title.includes("Verifier Signal"));
check("six Scene Cards generated", scenes.length === 6 && project.sceneCount === 6);
check("characters generated", characters.length >= 2);
check("world bible generated", worlds.length >= 1 && worlds[0].visualRules.length >= 3);
check("world bible includes locations", worlds[0].locations.length >= 1);
check("world bible includes timeline anchors", worlds[0].timeline.length >= 1);
check("first-class locations generated", locations.length >= 2 && locations.every((location) => location.worldId === worlds[0].id));
check("first-class factions generated", factions.length >= 2 && factions.every((faction) => faction.worldId === worlds[0].id));
check("publish kit generated", productionPackage.publishKit.projectId === project.id);
check("timeline items generated", productionPackage.timelineItems.length === scenes.length);
check("generation job recorded", productionPackage.generationJobs.some((job) => job.task.includes("NOX Core")));
check("generation job lifecycle metadata recorded", productionPackage.generationJobs.some((job) => job.completedAt && job.logs?.length && job.retryCount === 0 && job.maxRetries === 2));
check("custom language settings persist to project", project.language.promptLanguage === "Spanish" && project.language.subtitles === "English");

for (const scene of scenes) {
  check(\`scene \${scene.number} has 1-3 timed beats\`, scene.beats.length >= 1 && scene.beats.length <= 3);
  check(\`scene \${scene.number} is one 10-second output\`, scene.durationSeconds === 10 && scene.output.includes("One generated video"));
  check(\`scene \${scene.number} prompt ready\`, scene.status === "Prompt Ready");
  check(\`scene \${scene.number} external provider persisted\`, scene.externalProvider === "Grok");
  for (const section of ["[SCENE]", "[TIMING]", "[STYLE]", "[CAMERA]", "[AUDIO]", "[DIALOGUE]", "[NEGATIVE PROMPT]"]) {
    check(\`scene \${scene.number} prompt has \${section}\`, scene.fullPrompt.includes(section));
  }
  check(\`scene \${scene.number} prompt provider persisted\`, scene.promptProvider === "Grok");
  check(\`scene \${scene.number} prompt uses custom language settings\`, scene.fullPrompt.includes("Prompt language: Spanish") && scene.fullPrompt.includes("Subtitle language: English") && scene.fullPrompt.includes("Garifuna-influenced Honduran Spanish"));
}

const lead = characters[0];
const world = worlds[0];
const context = {
  characterRules: [\`\${lead.name}: \${lead.promptIdentity}\`, ...lead.wardrobeRules],
  worldRules: [\`\${world.name}: \${world.description}\`, ...world.visualRules],
  language: project.language,
};
const regenerated = regenerateScenePrompt(scenes[0], "Grok", context);
check("regenerated prompt uses Grok", regenerated.promptProvider === "Grok" && regenerated.fullPrompt.includes("Provider: Grok"));
check("regenerated prompt includes character continuity", regenerated.fullPrompt.includes(lead.name));
check("regenerated prompt includes world continuity", regenerated.fullPrompt.includes(world.name));

const continuityReport = runContinuityCheck(regenerated, characters, worlds, locations, factions);
check("continuity checker matches characters", continuityReport.matchedCharacters.includes(lead.name));
check("continuity checker matches world", continuityReport.matchedWorlds.includes(world.name));
check("continuity checker tracks locations", continuityReport.matchedLocations.length >= 1);
check("continuity checker reports no missing links", continuityReport.status === "Pass");
check("continuity checker tracks reference image warning", continuityReport.issues.some((issue) => issue.message.includes("Face/reference image")));
const referencedCharacters = characters.map((character, index) => ({
  ...character,
  referenceImageUrl: \`nox-vault://characters/\${character.id}/reference-\${index + 1}.png\`,
}));
const referencedContinuityReport = runContinuityCheck(regenerated, referencedCharacters, worlds, locations, factions);
check("continuity checker accepts linked character reference images", !referencedContinuityReport.issues.some((issue) => issue.message.includes("Face/reference image")));

const polished = polishScenePrompt(regenerated, "Grok", context);
check("polished prompt uses Grok", polished.promptProvider === "Grok" && polished.fullPrompt.includes("Provider: Grok"));
check("polished prompt adds polish pass", polished.fullPrompt.includes("[POLISH PASS]"));
check("polished prompt preserves regional voice option", polished.fullPrompt.includes("Honduran / Central American voice option"));

const readyScenes = scenes.map((scene) => ({
  ...scene,
  status: "Approved",
  uploadedAsset: \`scene-\${String(scene.number).padStart(2, "0")}.mp4\`,
  promptCopiedAt: "Just now",
  externalProvider: scene.externalProvider ?? scene.promptProvider,
}));

const videoAssets = readyScenes.map((scene) => ({
  id: \`asset-\${scene.id}\`,
  workspaceId: project.workspaceId,
  projectId: project.id,
  sceneId: scene.id,
  filename: scene.uploadedAsset,
  type: "Video",
  fileUrl: \`local://\${scene.uploadedAsset}\`,
  storagePath: \`\${project.workspaceId}/\${project.id}/\${scene.id}/\${scene.uploadedAsset}\`,
  mimeType: "video/mp4",
  attachedTo: \`\${project.title} / Scene \${scene.number}\`,
  status: "Approved",
  provider: "Manual Mode / Local verifier",
  duration: "10s",
  promptId: scene.id,
  promptUsed: scene.fullPrompt,
  notes: "Verifier approved scene video.",
  tags: ["scene-video", "manual-upload", scene.externalProvider.toLowerCase()],
  createdAt: "Just now",
}));

const utilityAssets = [
  {
    id: "asset-low-cinematic-pulse",
    workspaceId: project.workspaceId,
    projectId: project.id,
    filename: "low-cinematic-pulse.wav",
    type: "Audio",
    fileUrl: "local://low-cinematic-pulse.wav",
    storagePath: \`\${project.workspaceId}/\${project.id}/audio/low-cinematic-pulse.wav\`,
    mimeType: "audio/wav",
    attachedTo: \`\${project.title} / NOX Cut music bed\`,
    status: "Approved",
    provider: "NOX Audio Library",
    duration: "60s",
    notes: "Verifier local music bed.",
    tags: ["music", "nox-cut", "audio"],
    createdAt: "Just now",
  },
  {
    id: "asset-nox-films-watermark",
    workspaceId: project.workspaceId,
    projectId: project.id,
    filename: "nox-films-watermark.png",
    type: "Brand File",
    fileUrl: "local://nox-films-watermark.png",
    storagePath: \`\${project.workspaceId}/\${project.id}/brand/nox-films-watermark.png\`,
    mimeType: "image/png",
    attachedTo: \`\${project.title} / Brand Kit watermark\`,
    status: "Approved",
    provider: "NOX Brand Kit",
    notes: "Verifier local watermark image.",
    tags: ["brand-kit", "watermark", "nox-brand"],
    createdAt: "Just now",
  },
];

const finalExportAsset = {
  id: "asset-final-rendered-mp4",
  workspaceId: project.workspaceId,
  projectId: project.id,
  filename: \`\${project.id}-final-render.mp4\`,
  type: "Final Export",
  fileUrl: \`local://\${project.id}-final-render.mp4\`,
  storagePath: \`\${project.workspaceId}/\${project.id}/renders/\${project.id}-final-render.mp4\`,
  mimeType: "video/mp4",
  attachedTo: \`\${project.title} / Render Engine V1\`,
  status: "Stored",
  provider: "NOX Render Worker / FFmpeg",
  duration: "60s",
  notes: "Verifier final MP4 render.",
  tags: ["rendered-mp4", "export", "nox-cut"],
  createdAt: "Just now",
};

const allAssets = [...videoAssets, ...utilityAssets, finalExportAsset];

const approvedReadyScenes = readyScenes.map((scene, index) => ({
  ...scene,
  approvedAssetId: videoAssets[index].id,
}));

const videoTimeline = productionPackage.timelineItems.map((item, index) => ({
  ...item,
  sceneId: approvedReadyScenes[index].id,
  assetId: videoAssets[index].id,
  trimStartNote: "Start on first clean frame.",
  trimEndNote: "Cut before provider reset.",
  editorNotes: "Verifier edit note.",
}));

const utilityTimeline = [
  {
    id: "timeline-title-card",
    projectId: project.id,
    trackType: "title",
    label: "Title Card",
    startTime: 0,
    endTime: 2,
    orderIndex: 900,
    transitionIn: "Fade In",
    transitionOut: "Signal Glitch",
    textOverlay: "A NOX Films Original",
  },
  {
    id: "timeline-subtitles",
    projectId: project.id,
    trackType: "subtitle",
    label: "Spanish Subtitles",
    startTime: 0,
    endTime: 60,
    orderIndex: 200,
    transitionIn: "None",
    transitionOut: "None",
    subtitleText: "Bold white cinematic subtitles with shadow",
  },
  {
    id: "timeline-music",
    projectId: project.id,
    trackType: "audio",
    label: "Low Cinematic Pulse",
    assetId: "asset-low-cinematic-pulse",
    startTime: 0,
    endTime: 60,
    orderIndex: 100,
    transitionIn: "Fade In",
    transitionOut: "Fade Out",
  },
  {
    id: "timeline-watermark",
    projectId: project.id,
    trackType: "overlay",
    label: "NOX Films Watermark",
    assetId: "asset-nox-films-watermark",
    startTime: 0,
    endTime: 60,
    orderIndex: 50,
    transitionIn: "None",
    transitionOut: "None",
    textOverlay: "NOX Films",
  },
];

const publishKit = generatePublishKit(project, approvedReadyScenes, brandKit);
check("publish kit has TikTok title", publishKit.tiktokTitle.length > 8);
check("publish kit has YouTube tags", publishKit.tags.includes(project.genre));
check("publish kit chapters match scenes", publishKit.chapters.length === approvedReadyScenes.length);
check("publish kit has poster prompt", publishKit.posterPrompt.includes(project.title));

const state = {
  schemaVersion: 1,
  user: { id: "user-verifier", email: "verifier@nox.test", name: "Verifier" },
  workspace: { id: project.workspaceId, name: "Verifier Workspace", ownerId: "user-verifier", plan: "Creator" },
  projects: [project],
  scenes: approvedReadyScenes,
  assets: allAssets,
  characters,
  worlds,
  locations,
  factions,
  generationJobs: productionPackage.generationJobs,
  providers: defaultProviders,
  publishKits: [publishKit],
  timelineItems: [...videoTimeline, ...utilityTimeline],
  brandKit,
};

const markdown = exportProjectMarkdown(state, project.id);
check("markdown export includes project", markdown.includes(project.title));
check("markdown export includes Scene Cards", markdown.includes("## Scene Cards"));
check("markdown export includes Asset Vault", markdown.includes("## Asset Vault"));
check("markdown export includes Continuity Vault", markdown.includes("## Continuity Vault"));
check("markdown export includes first-class locations", markdown.includes(locations[0].name));
check("markdown export preserves prompt lineage", markdown.includes("Prompt used:") && markdown.includes(approvedReadyScenes[0].fullPrompt.slice(0, 24)));
check("markdown export includes publish kit", markdown.includes("## Publish Kit"));

const text = exportProjectText(state, project.id);
check("TXT export includes production package header", text.includes("NOX STUDIO PRODUCTION PACKAGE"));
check("TXT export includes Scene Cards", text.includes("SCENE CARDS"));
check("TXT export includes Asset Vault", text.includes("ASSET VAULT"));
check("TXT export includes Publish Kit", text.includes("PUBLISH KIT"));
check("TXT export preserves platform metadata", text.includes(publishKit.tiktokTitle) && text.includes(publishKit.youtubeTitle));
check("TXT export preserves prompt lineage", text.includes("Prompt used:") && text.includes(approvedReadyScenes[0].fullPrompt.slice(0, 24)));

const releasePlatforms = ["TikTok", "YouTube", "NOX Films"];
for (const platform of releasePlatforms) {
  const releaseBundle = createReleaseBundle(state, project.id, platform);
  check(platform + " release bundle has platform preset", releaseBundle.platform === platform && releaseBundle.preset.aspectRatio.length > 0 && releaseBundle.preset.deliveryFile.includes(".mp4"));
  check(platform + " release bundle has metadata", releaseBundle.metadata.title.length > 0 && releaseBundle.metadata.description.length > 0);
  check(platform + " release bundle has schedule status", releaseBundle.schedule.status === publishKit.releaseStatus && releaseBundle.schedule.recommendedWindow.length > 0);
  check(platform + " release bundle has thumbnail prompt", releaseBundle.thumbnail.prompt.length > 0 && releaseBundle.thumbnail.safeZones.length > 0);
  check(platform + " release bundle has release file manifest", releaseBundle.files.approvedSceneVideos.length === videoAssets.length && releaseBundle.files.timeline.length === state.timelineItems.length);
  check(platform + " release bundle has readiness checklist", releaseBundle.checklist.some((item) => item.label.includes("Final MP4")) && releaseBundle.checklist.some((item) => item.label.includes("metadata")));
  const releaseBundleJson = JSON.parse(exportReleaseBundleJson(state, project.id, platform));
  check(platform + " release bundle JSON round-trips", releaseBundleJson.platform === platform && releaseBundleJson.files.approvedSceneVideos.length === videoAssets.length);
  const releaseBundleText = exportReleaseBundleText(state, project.id, platform);
  check(platform + " release bundle TXT includes metadata and checklist", releaseBundleText.includes("NOX RELEASE BUNDLE") && releaseBundleText.includes("METADATA") && releaseBundleText.includes("CHECKLIST"));
  const releaseOperation = createReleaseOperationPlan(state, project.id, platform);
  check(platform + " release operation has readiness and blockers", releaseOperation.operation === "NOX Release Operation" && Array.isArray(releaseOperation.blockers) && typeof releaseOperation.ready === "boolean");
  check(platform + " release operation reuses bundle files and schedule", releaseOperation.files.approvedSceneVideos.length === videoAssets.length && releaseOperation.schedule.status === publishKit.releaseStatus && releaseOperation.steps.some((step) => step.label.includes("Upload or schedule")));
}

const json = JSON.parse(exportProjectJson(state, project.id));
check("JSON export includes project", json.project.id === project.id);
check("JSON export includes scenes", json.scenes.length === approvedReadyScenes.length);
check("JSON export includes assets", json.assets.length === allAssets.length);
check("JSON export includes locations", json.locations.length === locations.length);
check("JSON export includes factions", json.factions.length === factions.length);
check("JSON export preserves asset prompt snapshots", json.assets.filter((asset) => asset.type === "Video").every((asset) => asset.promptUsed && asset.promptUsed.includes("[SCENE]")));
check("JSON export preserves asset prompt ids", json.assets.filter((asset) => asset.type === "Video").every((asset, index) => asset.promptId === approvedReadyScenes[index].id));
check("JSON export includes timeline", json.timelineItems.length === state.timelineItems.length);
check("JSON export preserves prompt copy marker", json.scenes.every((scene) => scene.promptCopiedAt === "Just now"));
check("JSON export preserves external providers", json.scenes.every((scene) => scene.externalProvider === "Grok"));
check("JSON export preserves approved asset ids", json.scenes.every((scene, index) => scene.approvedAssetId === videoAssets[index].id));

const editPlan = exportEditPlan(state, project.id);
check("edit plan reports full readiness", editPlan.includes("Assembly readiness: 6/6 approved scene videos ready"));
check("edit plan includes video track", editPlan.includes("## Scene Video Track"));
check("edit plan includes provider lineage", editPlan.includes("Provider lineage: Manual Mode / Local verifier"));
check("edit plan includes prompt ids", editPlan.includes("Prompt ID: " + approvedReadyScenes[0].id));
check("edit plan includes title card", editPlan.includes("TITLE | Title Card"));
check("edit plan includes subtitles", editPlan.includes("SUBTITLE | Spanish Subtitles"));
check("edit plan includes music", editPlan.includes("AUDIO | Low Cinematic Pulse"));
check("edit plan includes watermark", editPlan.includes("OVERLAY | NOX Films Watermark"));
check("edit plan sorts utility tracks by timeline priority", editPlan.indexOf("TITLE | Title Card") < editPlan.indexOf("SUBTITLE | Spanish Subtitles") && editPlan.indexOf("SUBTITLE | Spanish Subtitles") < editPlan.indexOf("AUDIO | Low Cinematic Pulse") && editPlan.indexOf("AUDIO | Low Cinematic Pulse") < editPlan.indexOf("OVERLAY | NOX Films Watermark"));
check("edit plan has no missing-scene warnings", editPlan.includes("- All Scene Cards have approved videos for V1 assembly."));

const renderManifest = createRenderManifest(state, project.id);
check("render manifest targets NOX Render Engine V1", renderManifest.engine === "NOX Render Engine V1" && renderManifest.ffmpeg.rendererScript === "scripts/render-nox-cut.mjs" && renderManifest.ffmpeg.workerScript === "scripts/render-worker.mjs");
check("render manifest preserves workspace id for worker upload", renderManifest.workspaceId === project.workspaceId);
check("render manifest reports full readiness", renderManifest.readiness.ready && renderManifest.readiness.approvedClipCount === 6 && renderManifest.readiness.totalClipCount === 6);
check("render manifest carries six approved clips", renderManifest.clips.length === approvedReadyScenes.length && renderManifest.clips.every((clip, index) => clip.sourceAssetId === videoAssets[index].id && clip.ready));
check("render manifest preserves 60-second 9:16 assembly target", renderManifest.runtimeSeconds === 60 && renderManifest.width === 1080 && renderManifest.height === 1920 && renderManifest.outputFilename.endsWith(".mp4"));
check("render manifest preserves timeline trims and transitions", renderManifest.clips.every((clip) => clip.trimStartNote.includes("Start") && clip.trimEndNote.includes("Cut") && clip.transitionOut.length > 0));
check("render manifest includes utility tracks", renderManifest.utilityTracks.some((track) => track.trackType === "title") && renderManifest.utilityTracks.some((track) => track.trackType === "subtitle") && renderManifest.utilityTracks.some((track) => track.trackType === "audio") && renderManifest.utilityTracks.some((track) => track.trackType === "overlay"));
const renderMusicTrack = renderManifest.utilityTracks.find((track) => track.assetId === "asset-low-cinematic-pulse");
const renderWatermarkTrack = renderManifest.utilityTracks.find((track) => track.assetId === "asset-nox-films-watermark");
check("render manifest carries utility asset source paths", renderMusicTrack?.assetSourceUrl === "local://low-cinematic-pulse.wav" && renderMusicTrack?.assetMimeType === "audio/wav" && renderWatermarkTrack?.assetSourceUrl === "local://nox-films-watermark.png" && renderWatermarkTrack?.assetMimeType === "image/png");
check("render manifest documents finishing pass", renderManifest.ffmpeg.notes.some((note) => note.includes("title/subtitle/audio/overlay")) && renderManifest.ffmpeg.notes.some((note) => note.includes("local music beds")) && renderManifest.ffmpeg.notes.some((note) => note.includes("render-worker.mjs")));
const renderManifestJson = JSON.parse(exportRenderManifestJson(state, project.id));
check("render manifest JSON round-trips", renderManifestJson.engine === renderManifest.engine && renderManifestJson.clips.length === renderManifest.clips.length);
check("render readiness summary is user-facing", summarizeRenderReadiness(renderManifest).includes("6/6 clips ready"));

const stateWithEnabledGrok = {
  ...state,
  providers: state.providers.map((provider) =>
    provider.id === "grok"
      ? {
          ...provider,
          enabled: true,
          connectionStatus: "Configured" as const,
        }
      : provider,
  ),
};

const queuedVideoJob = {
  id: "job-video-runner-verifier",
  workspaceId: project.workspaceId,
  projectId: project.id,
  sceneId: approvedReadyScenes[0].id,
  task: "Scene 01 video generation",
  project: project.title,
  provider: "Grok video generation",
  status: "Queued" as const,
  cost: "External",
  inputPayload: approvedReadyScenes[0].fullPrompt,
  outputPayload: "Route prompt through Grok, then upload the generated 10-second video.",
  retryCount: 0,
  maxRetries: 2,
  logs: [],
  createdAt: "Just now",
};
const videoJobRun = await runGenerationJob({ job: queuedVideoJob, state: stateWithEnabledGrok, promptContext: context });
check("generation job runner routes enabled video providers", videoJobRun.job.status === "Needs Review" && videoJobRun.job.outputPayload.includes("Grok") && videoJobRun.job.logs?.some((log) => log.includes("Needs Review")));

const queuedPromptJob = {
  id: "job-prompt-runner-verifier",
  workspaceId: project.workspaceId,
  projectId: project.id,
  sceneId: approvedReadyScenes[0].id,
  task: "Scene prompt regeneration",
  project: project.title,
  provider: "Grok",
  status: "Queued" as const,
  cost: "$0.02 est",
  inputPayload: approvedReadyScenes[0].summary,
  retryCount: 0,
  maxRetries: 2,
  logs: [],
  createdAt: "Just now",
};
const promptJobRun = await runGenerationJob({ job: queuedPromptJob, state: stateWithEnabledGrok, promptContext: context });
check("generation job runner executes prompt jobs", promptJobRun.job.status === "Completed" && promptJobRun.scene?.fullPrompt.includes("[SCENE]") && promptJobRun.job.logs?.some((log) => log.includes("Completed")));

const queuedContinuityJob = {
  id: "job-continuity-runner-verifier",
  workspaceId: project.workspaceId,
  projectId: project.id,
  sceneId: approvedReadyScenes[0].id,
  task: "Scene 01 continuity check",
  project: project.title,
  provider: "Grok Continuity",
  status: "Queued" as const,
  cost: "$0.01 est",
  inputPayload: approvedReadyScenes[0].fullPrompt,
  retryCount: 0,
  maxRetries: 2,
  logs: [],
  createdAt: "Just now",
};
const continuityJobRun = await runGenerationJob({ job: queuedContinuityJob, state: stateWithEnabledGrok, promptContext: context });
check("generation job runner executes continuity review jobs", continuityJobRun.job.status === "Completed" && continuityJobRun.job.outputPayload?.includes("NOX Continuity Review") && continuityJobRun.job.outputPayload?.includes("matchedCharacters"));
check("generation job runner preserves actual cost usage metadata", continuityJobRun.job.costActual === 0.01 && continuityJobRun.job.costCurrency === "USD" && continuityJobRun.job.usageMetadata?.route === "local-continuity-review");

const releaseOperationJob = {
  id: "job-release-operation-verifier",
  workspaceId: project.workspaceId,
  projectId: project.id,
  task: "TikTok release operation",
  project: project.title,
  provider: "TikTok Publishing",
  status: "Queued" as const,
  cost: "Manual",
  inputPayload: JSON.stringify(createReleaseOperationPlan(state, project.id, "TikTok"), null, 2),
  retryCount: 0,
  maxRetries: 2,
  logs: [],
  createdAt: "Just now",
};
const releaseOperationRun = await runGenerationJob({ job: releaseOperationJob, state, promptContext: context });
check("generation job runner processes ready release operations", releaseOperationRun.job.status === "Completed" && releaseOperationRun.job.outputPayload?.includes("NOX Release Operation Result") && releaseOperationRun.job.outputPayload?.includes("Scheduled"));

if (failures.length) {
  console.error("NOX V1 workflow verification failed:");
  for (const failure of failures) console.error(\`- \${failure}\`);
  console.error(\`\\nPassed \${passes.length} checks before failing.\`);
  process.exit(1);
}

console.log(\`NOX V1 workflow verification passed (\${passes.length} checks).\`);
`;

try {
  await build({
    stdin: {
      contents: entry,
      loader: "ts",
      resolveDir: root,
      sourcefile: "nox-v1-workflow-entry.ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    sourcemap: false,
    logLevel: "silent",
  });

  await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
