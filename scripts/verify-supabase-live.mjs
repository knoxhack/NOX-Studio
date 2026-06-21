import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

loadDotEnvFiles([".env.local", ".env"]);

const requiredTables = [
  "profiles",
  "workspaces",
  "workspace_members",
  "projects",
  "characters",
  "worlds",
  "locations",
  "factions",
  "scenes",
  "scene_beats",
  "assets",
  "generation_jobs",
  "publish_kits",
  "timeline_items",
  "brand_kits",
  "provider_settings",
];

const storageBuckets = ["nox-videos", "nox-images", "nox-audio", "nox-exports", "nox-brand"];
const generationFunctions = ["generate-concept", "generate-scene-prompt", "process-generation-job", "manage-provider-secret"];

const config = {
  url: process.env.VITE_SUPABASE_URL,
  anonKey: process.env.VITE_SUPABASE_ANON_KEY,
  email: process.env.NOX_SUPABASE_TEST_EMAIL,
  password: process.env.NOX_SUPABASE_TEST_PASSWORD,
  otherEmail: process.env.NOX_SUPABASE_OTHER_EMAIL,
  otherPassword: process.env.NOX_SUPABASE_OTHER_PASSWORD,
  keepData: process.env.NOX_LIVE_AUDIT_KEEP_DATA === "1",
  strictIsolation: process.env.NOX_SUPABASE_STRICT_ISOLATION === "1",
  requireGrok: process.env.NOX_LIVE_AUDIT_REQUIRE_GROK === "1",
  runGrokMedia: process.env.NOX_LIVE_AUDIT_RUN_GROK_MEDIA === "1",
  testGrokSecret: process.env.NOX_LIVE_AUDIT_TEST_GROK_SECRET,
  providerCallbackToken: process.env.NOX_PROVIDER_CALLBACK_TOKEN,
  requireProviderCallback: process.env.NOX_LIVE_AUDIT_REQUIRE_PROVIDER_CALLBACK === "1",
};

const missingConfig = Object.entries({
  VITE_SUPABASE_URL: config.url,
  VITE_SUPABASE_ANON_KEY: config.anonKey,
  NOX_SUPABASE_TEST_EMAIL: config.email,
  NOX_SUPABASE_TEST_PASSWORD: config.password,
})
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (config.strictIsolation) {
  if (!config.otherEmail) missingConfig.push("NOX_SUPABASE_OTHER_EMAIL");
  if (!config.otherPassword) missingConfig.push("NOX_SUPABASE_OTHER_PASSWORD");
}
if (config.requireProviderCallback && !config.providerCallbackToken) missingConfig.push("NOX_PROVIDER_CALLBACK_TOKEN");

if (missingConfig.length) {
  console.error("NOX live Supabase audit requires real deployment credentials.");
  console.error(`Missing: ${missingConfig.join(", ")}`);
  console.error("Set them in the shell or .env.local, then rerun npm run verify:supabase-live.");
  process.exit(1);
}

const supabase = createAuditClient();

const auditId = randomUUID();
const workspaceId = randomUUID();
const brandKit = {
  studioName: "NOX Films",
  creatorName: "NOX Live Audit",
  introText: "A NOX Films Original",
  outroText: "Watch more on NOX Films",
  defaultStyle: "Futuristic cyberglass cinematic",
  defaultExport: "9:16 TikTok + 16:9 YouTube",
  subtitleStyle: "Bold white cinematic subtitles with shadow",
  colors: ["cyan", "magenta", "green"],
  hashtags: ["#NOXFilms", "#LiveAudit"],
};
const providerSettings = [
  {
    id: "manual",
    name: "Manual Mode",
    supportedTasks: "Copy prompts, upload generated clips",
    speed: "User-paced",
    quality: "Provider-dependent",
    enabled: true,
    mode: "Manual",
  },
  {
    id: "grok",
    name: "Grok",
    supportedTasks: "Story, prompts, continuity, metadata, images, and videos",
    speed: "Fast",
    quality: "High",
    enabled: true,
    mode: "API",
    apiEndpoint: "https://api.x.ai/v1",
    secretName: "",
    webhookEnabled: false,
    connectionStatus: "Configured",
    config: {
      textModel: "grok-4.3",
      imageModel: "grok-imagine-image-quality",
      videoModel: "grok-imagine-video",
    },
  },
];
const auditLanguage = {
  promptLanguage: "Spanish",
  dialogueLanguage: "Spanish",
  subtitles: "English",
  voiceStyle: "Garifuna-influenced Honduran Spanish",
};
const uploadedPaths = [];
let workspaceCreated = false;

try {
  const user = await signIn();
  await upsertProfile(user);
  await createAuditWorkspace(user);
  await verifyGrokSecretManager();
  await checkRlsTables();
  await checkFunctionHealth();
  const productionPackage = await generateProductionPackage();
  const polishedScene = await generateScenePrompt(productionPackage.scenes[0], productionPackage.project);
  productionPackage.scenes[0] = {
    ...polishedScene,
    promptCopiedAt: "Live audit",
    externalProvider: polishedScene.externalProvider ?? polishedScene.promptProvider ?? productionPackage.project.aiTarget,
  };
  await saveProductionPackage(productionPackage);
  await verifySceneBeatReplacement(productionPackage);
  await verifyGenerationJobProcessor(productionPackage);
  await verifyContinuityJobProcessor(productionPackage);
  await verifyOptionalGrokMediaJobs(productionPackage);
  await verifyGenerationQueueWorker(productionPackage);
  const storageResult = await checkStorageBuckets();
  await attachAuditAsset(productionPackage, storageResult.video);
  await verifyProviderCallback(productionPackage, storageResult.video);
  await verifyReleaseOperationProcessor(productionPackage, storageResult.uploaded["nox-exports"]);
  await verifyWorkspaceIsolation(storageResult.video);
  await verifySavedPackage(productionPackage);
  await verifyFreshSessionReload(productionPackage, storageResult.video);

  console.log("NOX live Supabase audit passed.");
  console.log(`Workspace: ${workspaceId}`);
  console.log(`Project: ${productionPackage.project.id}`);
  console.log("Verified: Auth session, workspace membership, provider settings, RLS tables, Edge Functions, remote generation job processing, continuity review processing, queue worker claiming, provider callback ingestion, release operation processing, private Storage, project CRUD, Scene Cards, Publish Kit, NOX Cut timeline rows, fresh-session reload survival, and configured cross-user isolation.");
} catch (error) {
  console.error("NOX live Supabase audit failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (config.keepData) {
    console.log(`NOX_LIVE_AUDIT_KEEP_DATA=1 set; preserved workspace ${workspaceId}.`);
  } else if (workspaceCreated || uploadedPaths.length) {
    try {
      const cleanup = await cleanupAuditData();
      console.log(`Verified cleanup removed ${cleanup.storageObjects} Storage object(s) and audit workspace ${workspaceId}.`);
    } catch (cleanupError) {
      console.error("NOX live Supabase cleanup failed:");
      console.error(cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
      process.exitCode = 1;
    }
  }
}

async function signIn() {
  return signInClient(supabase, config.email, config.password, "primary audit user");
}

async function signInClient(client, email, password, label) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`Auth sign-in failed for ${label}: ${error?.message ?? "No user returned."}`);

  const userCheck = await client.auth.getUser();
  if (userCheck.error || !userCheck.data.user) throw new Error(`Auth session check failed: ${userCheck.error?.message ?? "No user session."}`);
  return userCheck.data.user;
}

async function upsertProfile(user) {
  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email ?? config.email,
    display_name: "NOX Live Audit",
  });
  if (error) throw new Error(`Profile upsert failed: ${error.message}`);
}

async function createAuditWorkspace(user) {
  const workspace = await supabase.from("workspaces").insert({
    id: workspaceId,
    name: `NOX Live Audit ${auditId.slice(0, 8)}`,
    owner_id: user.id,
    plan: "Studio",
  });
  if (workspace.error) throw new Error(`Workspace insert failed: ${workspace.error.message}`);
  workspaceCreated = true;

  const member = await supabase.from("workspace_members").insert({
    workspace_id: workspaceId,
    user_id: user.id,
    role: "owner",
  });
  if (member.error) throw new Error(`Workspace member insert failed: ${member.error.message}`);

  const brand = await supabase.from("brand_kits").upsert(brandKitToRow(brandKit, workspaceId), { onConflict: "workspace_id" });
  if (brand.error) throw new Error(`Brand Kit upsert failed: ${brand.error.message}`);

  const providers = await supabase
    .from("provider_settings")
    .upsert(providerSettings.map((provider) => providerToRow(provider, workspaceId)), { onConflict: "workspace_id,provider_id" });
  if (providers.error) throw new Error(`Provider settings upsert failed: ${providers.error.message}`);
}

async function verifyGrokSecretManager() {
  const status = await supabase.functions.invoke("manage-provider-secret", {
    body: { action: "status", workspaceId },
  });
  if (status.error) throw new Error(`Grok secret status failed: ${status.error.message}`);
  if (config.requireGrok && !status.data?.configured && !config.testGrokSecret) {
    throw new Error("NOX_LIVE_AUDIT_REQUIRE_GROK=1 but no saved Grok key, XAI_API_KEY, or NOX_LIVE_AUDIT_TEST_GROK_SECRET is available.");
  }

  if (!config.testGrokSecret) return;

  const verify = await supabase.functions.invoke("manage-provider-secret", {
    body: { action: "verify", workspaceId, apiKey: config.testGrokSecret },
  });
  if (verify.error || verify.data?.status !== "Verified") {
    throw new Error(`Grok secret verification failed: ${verify.error?.message ?? verify.data?.error ?? "Invalid response."}`);
  }

  const save = await supabase.functions.invoke("manage-provider-secret", {
    body: { action: "save", workspaceId, apiKey: config.testGrokSecret },
  });
  if (save.error || !save.data?.configured || save.data?.status !== "Saved") {
    throw new Error(`Grok secret save failed: ${save.error?.message ?? save.data?.error ?? "Invalid response."}`);
  }

  const savedStatus = await supabase.functions.invoke("manage-provider-secret", {
    body: { action: "status", workspaceId },
  });
  if (savedStatus.error || !savedStatus.data?.configured || savedStatus.data?.source !== "workspace-secret") {
    throw new Error(`Grok secret readback failed: ${savedStatus.error?.message ?? "Saved workspace secret was not reported."}`);
  }
}

async function checkRlsTables() {
  for (const table of requiredTables) {
    const { error } = await supabase.from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(`RLS table check failed for ${table}: ${error.message}`);
  }
}

async function checkFunctionHealth() {
  for (const functionName of generationFunctions) {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: { action: "health", workspaceId },
    });
    if (error || !data?.ok) throw new Error(`Edge Function health failed for ${functionName}: ${error?.message ?? "Missing ok response."}`);
    if (functionName === "process-generation-job") {
      if (!data.authRequired || !data.supabaseConfigured) {
        throw new Error("process-generation-job did not report authenticated Supabase runtime readiness.");
      }
      continue;
    }
    const runtime = getFunctionRuntimeHealth(data);
    if (!runtime) {
      throw new Error(`Edge Function health for ${functionName} did not report provider runtime configuration.`);
    }
    if (config.requireGrok && !runtime.configured) {
      throw new Error(`NOX_LIVE_AUDIT_REQUIRE_GROK=1 but ${functionName} reports ${runtime.provider} is not configured.`);
    }
  }
}

function getFunctionRuntimeHealth(data) {
  if (typeof data.grokConfigured === "boolean" && typeof data.grokTextModel === "string") {
    return {
      provider: "Grok",
      configured: data.grokConfigured,
      model: data.grokTextModel,
    };
  }

  return undefined;
}

async function generateProductionPackage() {
  const { data, error } = await supabase.functions.invoke("generate-concept", {
    body: {
      title: `Live Audit ${auditId.slice(0, 8)}`,
      idea: "A filmmaker proves NOX Studio can save a real Supabase production package.",
      type: "Shortfilm",
      format: "TikTok / Reels / Shorts - 9:16",
      length: "60 seconds = 6 scene cards",
      genre: "Sci-fi",
      tone: "Dark",
      target: "Grok",
      workspaceId,
      brandKit,
      language: auditLanguage,
    },
  });
  if (error || !data?.productionPackage) throw new Error(`generate-concept failed: ${error?.message ?? "No production package returned."}`);

  const productionPackage = data.productionPackage;
  if (productionPackage.project.workspaceId !== workspaceId) throw new Error("Generated package did not preserve workspace ownership.");
  if (
    productionPackage.project.language?.promptLanguage !== auditLanguage.promptLanguage ||
    productionPackage.project.language?.subtitles !== auditLanguage.subtitles ||
    productionPackage.project.language?.voiceStyle !== auditLanguage.voiceStyle
  ) {
    throw new Error("Generated package did not preserve custom project language settings.");
  }
  if (productionPackage.scenes.length !== 6) throw new Error(`Expected 6 Scene Cards, got ${productionPackage.scenes.length}.`);
  if (!productionPackage.scenes.every((scene) => scene.durationSeconds === 10 && scene.beats.length >= 1 && scene.beats.length <= 3)) {
    throw new Error("Generated Scene Cards do not satisfy the 10-second / 1-3 internal beat rule.");
  }
  if (
    !productionPackage.scenes.every(
      (scene) =>
        scene.fullPrompt.includes(`Prompt language: ${auditLanguage.promptLanguage}`) &&
        scene.fullPrompt.includes(`Subtitle language: ${auditLanguage.subtitles}`) &&
        scene.fullPrompt.includes(auditLanguage.voiceStyle),
    )
  ) {
    throw new Error("Generated Scene Card prompts did not preserve custom language settings.");
  }
  return productionPackage;
}

async function generateScenePrompt(scene, project) {
  const { data, error } = await supabase.functions.invoke("generate-scene-prompt", {
    body: {
      action: "polish",
      scene,
      provider: "Grok",
      context: {
        language: project.language,
      },
    },
  });
  if (error || !data?.scene) throw new Error(`generate-scene-prompt failed: ${error?.message ?? "No scene returned."}`);
  if (!data.scene.fullPrompt.includes("[POLISH PASS]")) throw new Error("Polished prompt did not include the expected polish pass.");
  if (
    !data.scene.fullPrompt.includes(`Prompt language: ${auditLanguage.promptLanguage}`) ||
    !data.scene.fullPrompt.includes(`Subtitle language: ${auditLanguage.subtitles}`) ||
    !data.scene.fullPrompt.includes(auditLanguage.voiceStyle)
  ) {
    throw new Error("Polished prompt did not preserve custom language settings.");
  }
  return data.scene;
}

async function saveProductionPackage(productionPackage) {
  await insertRows("projects", [projectToRow(productionPackage.project)], "project");
  await insertRows("characters", productionPackage.characters.map(characterToRow), "characters");
  await insertRows("worlds", productionPackage.worlds.map(worldToRow), "worlds");
  await insertRows("locations", productionPackage.locations.map(locationToRow), "locations");
  await insertRows("factions", productionPackage.factions.map(factionToRow), "factions");
  await insertRows("scenes", productionPackage.scenes.map(sceneToRow), "scenes");
  await insertRows("scene_beats", productionPackage.scenes.flatMap((scene) => scene.beats.map((beat, index) => beatToRow(beat, scene.id, index))), "scene beats");
  await insertRows("publish_kits", [publishKitToRow(productionPackage.publishKit)], "publish kit");
  await insertRows("timeline_items", productionPackage.timelineItems.map(timelineItemToRow), "timeline items");
  await insertRows("generation_jobs", productionPackage.generationJobs.map(generationJobToRow), "generation jobs");
}

async function verifySceneBeatReplacement(productionPackage) {
  const scene = productionPackage.scenes[0];
  const replacementBeat = {
    ...scene.beats[0],
    id: randomUUID(),
    range: "0-10s",
    title: `Live audit replacement beat ${auditId.slice(0, 8)}`,
    description: "A saved Scene Card edit replaces stale timed beat rows with one internal instruction.",
    camera: "Single continuous proof shot.",
    audio: "Low pulse confirming beat persistence.",
  };
  const editedScene = {
    ...scene,
    beats: [replacementBeat],
    summary: `${scene.summary} Edited by live beat replacement audit.`,
  };

  const sceneUpdate = await supabase.from("scenes").upsert(sceneToRow(editedScene));
  if (sceneUpdate.error) throw new Error(`Edited Scene Card upsert failed: ${sceneUpdate.error.message}`);

  const deleteOldBeats = await supabase.from("scene_beats").delete().eq("scene_id", scene.id);
  if (deleteOldBeats.error) throw new Error(`Edited Scene Beat cleanup failed: ${deleteOldBeats.error.message}`);

  await insertRows("scene_beats", editedScene.beats.map((beat, index) => beatToRow(beat, scene.id, index)), "edited scene beats");

  const readback = await supabase.from("scene_beats").select("*").eq("scene_id", scene.id).order("beat_number", { ascending: true });
  if (readback.error) throw new Error(`Edited Scene Beat readback failed: ${readback.error.message}`);
  if ((readback.data ?? []).length !== 1 || readback.data[0].title !== replacementBeat.title || readback.data[0].end_second !== 10) {
    throw new Error("Edited Scene Beat replacement did not remove stale rows or preserve the replacement beat.");
  }

  productionPackage.scenes[0] = editedScene;
}

async function verifyGenerationJobProcessor(productionPackage) {
  const scene = productionPackage.scenes[0];
  const job = {
    id: randomUUID(),
    workspaceId,
    projectId: productionPackage.project.id,
    sceneId: scene.id,
    task: "Scene prompt polish",
    project: productionPackage.project.title,
    provider: "Grok",
    status: "Queued",
    cost: "$0 est",
    inputPayload: scene.fullPrompt,
    outputPayload: "",
    retryCount: 0,
    maxRetries: 2,
    logs: [`${new Date().toISOString()} - Queued: Live audit remote processor job.`],
    createdAt: new Date().toISOString(),
  };
  await insertRows("generation_jobs", [generationJobToRow(job)], "remote generation processor job");

  const { data, error } = await supabase.functions.invoke("process-generation-job", {
    body: {
      jobId: job.id,
      context: {
        language: productionPackage.project.language,
      },
    },
  });
  if (error || !data?.job) throw new Error(`process-generation-job failed: ${error?.message ?? "No generation job returned."}`);
  if (data.job.status !== "Completed") throw new Error(`process-generation-job did not complete the prompt job; got ${data.job.status}.`);
  if (!Array.isArray(data.job.logs) || !data.job.logs.some((line) => line.includes("Supabase Edge job processor started"))) {
    throw new Error("process-generation-job did not return processor lifecycle logs.");
  }

  const [jobReadback, sceneReadback] = await Promise.all([
    supabase.from("generation_jobs").select("*").eq("id", job.id).single(),
    supabase.from("scenes").select("*").eq("id", scene.id).single(),
  ]);
  if (jobReadback.error) throw new Error(`Remote processor job readback failed: ${jobReadback.error.message}`);
  if (sceneReadback.error) throw new Error(`Remote processor scene readback failed: ${sceneReadback.error.message}`);
  if (jobReadback.data.status !== "Completed" || jobReadback.data.output_payload?.route !== "supabase-edge") {
    throw new Error("Remote processor job readback did not persist completed Edge route metadata.");
  }
  if (!sceneReadback.data.full_prompt.includes("[POLISH PASS]") || sceneReadback.data.metadata?.externalProvider !== "Grok") {
    throw new Error("Remote processor did not persist the polished Scene Card prompt and provider metadata.");
  }
}

async function verifyContinuityJobProcessor(productionPackage) {
  const scene = productionPackage.scenes[0];
  const job = {
    id: randomUUID(),
    workspaceId,
    projectId: productionPackage.project.id,
    sceneId: scene.id,
    task: "Scene 01 continuity check",
    project: productionPackage.project.title,
    provider: "Grok Continuity",
    status: "Queued",
    cost: "$0.01 est",
    inputPayload: scene.fullPrompt,
    outputPayload: "",
    retryCount: 0,
    maxRetries: 2,
    logs: [`${new Date().toISOString()} - Queued: Live audit continuity review job.`],
    createdAt: new Date().toISOString(),
  };
  await insertRows("generation_jobs", [generationJobToRow(job)], "continuity review job");

  const { data, error } = await supabase.functions.invoke("process-generation-job", {
    body: {
      jobId: job.id,
      context: {
        continuityAudit: true,
      },
    },
  });
  if (error || !data?.job || !data?.continuityReport) {
    throw new Error(`Continuity review processing failed: ${error?.message ?? "No continuity report returned."}`);
  }
  if (!["Completed", "Needs Review"].includes(data.job.status)) {
    throw new Error(`Continuity review returned unexpected status ${data.job.status}.`);
  }
  if (!Array.isArray(data.continuityReport.issues) || !Array.isArray(data.continuityReport.matchedCharacters)) {
    throw new Error("Continuity review did not return a structured report.");
  }

  const readback = await supabase.from("generation_jobs").select("*").eq("id", job.id).single();
  if (readback.error) throw new Error(`Continuity review job readback failed: ${readback.error.message}`);
  if (readback.data.output_payload?.route !== "continuity-review" || !readback.data.output_payload?.report?.summary) {
    throw new Error("Continuity review job readback did not preserve structured route/report metadata.");
  }
}

async function verifyOptionalGrokMediaJobs(productionPackage) {
  if (!config.runGrokMedia) {
    console.log("Grok media live audit skipped; set NOX_LIVE_AUDIT_RUN_GROK_MEDIA=1 to spend credits on image/video generation checks.");
    return;
  }

  const scene = productionPackage.scenes[0];
  const imageJob = {
    id: randomUUID(),
    workspaceId,
    projectId: productionPackage.project.id,
    task: "Poster image generation",
    project: productionPackage.project.title,
    provider: "Grok",
    status: "Queued",
    cost: "Grok image",
    inputPayload: productionPackage.publishKit.posterPrompt,
    outputPayload: "Live audit Grok image job queued.",
    retryCount: 0,
    maxRetries: 1,
    usageMetadata: { route: "grok-image", assetKind: "poster", assetType: "Poster" },
    createdAt: new Date().toISOString(),
  };
  const videoJob = {
    id: randomUUID(),
    workspaceId,
    projectId: productionPackage.project.id,
    sceneId: scene.id,
    task: `Scene ${String(scene.number).padStart(2, "0")} video generation`,
    project: productionPackage.project.title,
    provider: "Grok",
    status: "Queued",
    cost: "Grok video",
    inputPayload: scene.fullPrompt,
    outputPayload: "Live audit Grok video job queued.",
    retryCount: 0,
    maxRetries: 1,
    usageMetadata: { route: "grok-video", assetType: "Video" },
    createdAt: new Date().toISOString(),
  };

  await insertRows("generation_jobs", [generationJobToRow(imageJob), generationJobToRow(videoJob)], "Grok media jobs");
  for (const job of [imageJob, videoJob]) {
    const { data, error } = await supabase.functions.invoke("process-generation-job", {
      body: { jobId: job.id },
    });
    if (error || !data?.job) throw new Error(`Grok media job failed: ${error?.message ?? "No job returned."}`);
    if (!["Running", "Needs Review", "Completed"].includes(data.job.status)) {
      throw new Error(`Grok media job returned unexpected status ${data.job.status}.`);
    }
  }

  const readback = await supabase
    .from("generation_jobs")
    .select("id, output_payload, usage_metadata")
    .in("id", [imageJob.id, videoJob.id]);
  if (readback.error) throw new Error(`Grok media job readback failed: ${readback.error.message}`);
  if (!(readback.data ?? []).every((job) => ["grok-image", "grok-video"].includes(job.output_payload?.route) || ["grok-image", "grok-video"].includes(job.usage_metadata?.route))) {
    throw new Error("Grok media jobs did not preserve image/video route metadata.");
  }
}

async function verifyGenerationQueueWorker(productionPackage) {
  const job = {
    id: randomUUID(),
    workspaceId,
    projectId: productionPackage.project.id,
    task: "Metadata caption draft",
    project: productionPackage.project.title,
    provider: "Grok",
    status: "Queued",
    cost: "$0.02 est",
    inputPayload: "Draft release metadata for the live audit project.",
    outputPayload: "",
    retryCount: 0,
    maxRetries: 2,
    priority: 50,
    runAfter: new Date(Date.now() - 1000).toISOString(),
    logs: [`${new Date().toISOString()} - Queued: Live audit queue worker claim job.`],
    createdAt: new Date().toISOString(),
  };
  await insertRows("generation_jobs", [generationJobToRow(job)], "queue worker generation job");

  const workerId = `live-audit-worker-${auditId.slice(0, 8)}`;
  const { data, error } = await supabase.functions.invoke("process-generation-job", {
    body: {
      action: "process-next",
      workspaceId,
      workerId,
      context: {
        language: productionPackage.project.language,
      },
    },
  });
  if (error || !data?.job) throw new Error(`process-next generation worker failed: ${error?.message ?? "No generation job returned."}`);
  if (data.job.id !== job.id || data.job.status !== "Completed") {
    throw new Error(`process-next did not claim and complete the expected queued job; got ${data.job.id} / ${data.job.status}.`);
  }
  if (!Array.isArray(data.job.logs) || !data.job.logs.some((line) => line.includes(workerId))) {
    throw new Error("process-next did not persist queue worker claim logs.");
  }

  const readback = await supabase.from("generation_jobs").select("*").eq("id", job.id).single();
  if (readback.error) throw new Error(`Queue worker job readback failed: ${readback.error.message}`);
  if (readback.data.status !== "Completed" || readback.data.output_payload?.route !== "supabase-edge") {
    throw new Error("Queue worker job readback did not preserve completed Edge route metadata.");
  }
  if (readback.data.locked_at || readback.data.locked_by) {
    throw new Error("Queue worker job lock was not released after completion.");
  }

  const emptyClaim = await supabase.functions.invoke("process-generation-job", {
    body: {
      action: "process-next",
      workspaceId,
      workerId: `${workerId}-empty`,
    },
  });
  if (emptyClaim.error) throw new Error(`Empty process-next check failed: ${emptyClaim.error.message}`);
  if (emptyClaim.data?.job !== null) throw new Error("process-next should return job: null when no due queued jobs remain.");
}

async function checkStorageBuckets() {
  const uploaded = {};
  for (const bucket of storageBuckets) {
    const path = `${workspaceId}/_live-audit/${auditId}-${bucket}.json`;
    const body = new Blob([JSON.stringify({ auditId, bucket, checkedAt: new Date().toISOString() })], {
      type: "application/json",
    });
    const upload = await supabase.storage.from(bucket).upload(path, body, {
      contentType: "application/json",
      upsert: true,
    });
    if (upload.error) throw new Error(`Storage upload failed for ${bucket}: ${upload.error.message}`);
    uploadedPaths.push({ bucket, path });

    const signedUrl = await supabase.storage.from(bucket).createSignedUrl(path, 60);
    if (signedUrl.error || !signedUrl.data?.signedUrl) throw new Error(`Storage signed URL failed for ${bucket}: ${signedUrl.error?.message ?? "No signed URL."}`);
    uploaded[bucket] = { bucket, path, signedUrl: signedUrl.data.signedUrl };
  }
  return { video: uploaded["nox-videos"], uploaded };
}

async function attachAuditAsset(productionPackage, videoUpload) {
  const scene = productionPackage.scenes[0];
  const assetId = randomUUID();
  const asset = {
    id: assetId,
    workspace_id: workspaceId,
    project_id: productionPackage.project.id,
    scene_id: scene.id,
    type: "Video",
    file_url: videoUpload.signedUrl,
    mime_type: "application/json",
    filename: `${auditId}-scene-01.json`,
    status: "Approved",
    provider: "NOX Live Audit / Supabase Storage / nox-videos",
    notes: "Live audit storage object attached as a Scene Card source placeholder.",
    tags: ["live-audit", "scene-video", "supabase-storage"],
    duration_seconds: 10,
    prompt_id: scene.id,
    metadata: {
      attachedTo: `${productionPackage.project.title} / Scene 01`,
      storagePath: videoUpload.path,
      promptUsed: scene.fullPrompt,
    },
  };
  await insertRows("assets", [asset], "asset");

  const sceneUpdate = await supabase
    .from("scenes")
    .update({
      status: "Approved",
      approved_asset_id: assetId,
      metadata: {
        uploadedAsset: asset.filename,
        promptProvider: scene.promptProvider,
        promptCopiedAt: "Live audit",
        externalProvider: scene.externalProvider ?? scene.promptProvider,
      },
    })
    .eq("id", scene.id);
  if (sceneUpdate.error) throw new Error(`Approved scene update failed: ${sceneUpdate.error.message}`);

  const timelineUpdate = await supabase
    .from("timeline_items")
    .update({
      asset_id: assetId,
      editor_notes: `Live audit approved source: ${asset.filename}`,
    })
    .eq("scene_id", scene.id)
    .eq("track_type", "video");
  if (timelineUpdate.error) throw new Error(`Timeline asset link failed: ${timelineUpdate.error.message}`);

  const projectUpdate = await supabase
    .from("projects")
    .update({
      status: "Editing",
      release_status: "NOX Films Draft",
      updated_at: new Date().toISOString(),
    })
    .eq("id", productionPackage.project.id);
  if (projectUpdate.error) throw new Error(`Project update failed: ${projectUpdate.error.message}`);

  const publishKitUpdate = await supabase
    .from("publish_kits")
    .update({
      release_status: "NOX Films Draft",
      updated_at: new Date().toISOString(),
    })
    .eq("project_id", productionPackage.project.id);
  if (publishKitUpdate.error) throw new Error(`Publish Kit release update failed: ${publishKitUpdate.error.message}`);
}

async function verifyProviderCallback(productionPackage, videoUpload) {
  if (!config.providerCallbackToken) {
    if (config.requireProviderCallback) throw new Error("Provider callback audit requires NOX_PROVIDER_CALLBACK_TOKEN.");
    console.log("Provider callback audit skipped; set NOX_PROVIDER_CALLBACK_TOKEN to verify token-protected provider ingestion.");
    return;
  }

  const scene = productionPackage.scenes[1] ?? productionPackage.scenes[0];
  const job = {
    id: randomUUID(),
    workspaceId,
    projectId: productionPackage.project.id,
    sceneId: scene.id,
    task: `Scene ${String(scene.number).padStart(2, "0")} video generation`,
    project: productionPackage.project.title,
    provider: "Grok",
    status: "Running",
    cost: "Provider API",
    inputPayload: scene.fullPrompt,
    outputPayload: "Provider job submitted; awaiting callback.",
    retryCount: 0,
    maxRetries: 2,
    logs: [`${new Date().toISOString()} - Running: Live audit provider callback job.`],
    startedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  await insertRows("generation_jobs", [generationJobToRow(job)], "provider callback job");

  const externalJobId = `provider-callback-${auditId.slice(0, 8)}`;
  const { data, error } = await supabase.functions.invoke("process-generation-job", {
    headers: {
      "x-nox-callback-token": config.providerCallbackToken,
    },
    body: {
      action: "provider-callback",
      jobId: job.id,
      provider: "Grok",
      status: "succeeded",
      externalJobId,
      costActual: 1.25,
      costCurrency: "USD",
      usageMetadata: {
        providerCredits: 12,
        renderedSeconds: 10,
        providerModel: "runway-live-audit",
      },
      autoApprove: true,
      asset: {
        url: videoUpload.signedUrl,
        storagePath: videoUpload.path,
        storageBucket: videoUpload.bucket,
        filename: `${auditId}-provider-callback-scene-${scene.number}.mp4`,
        mimeType: "video/mp4",
        durationSeconds: 10,
        promptUsed: scene.fullPrompt,
      },
      providerResponse: {
        id: externalJobId,
        status: "succeeded",
      },
    },
  });
  if (error || !data?.job || !data?.asset) throw new Error(`Provider callback failed: ${error?.message ?? "No callback job/asset returned."}`);
  if (data.job.status !== "Approved" || data.asset.status !== "Approved") {
    throw new Error(`Provider callback did not approve the generated asset; got job ${data.job.status} / asset ${data.asset.status}.`);
  }

  const [jobReadback, sceneReadback, assetReadback] = await Promise.all([
    supabase.from("generation_jobs").select("*").eq("id", job.id).single(),
    supabase.from("scenes").select("*").eq("id", scene.id).single(),
    supabase.from("assets").select("*").eq("id", data.asset.id).single(),
  ]);
  for (const [label, result] of Object.entries({ jobReadback, sceneReadback, assetReadback })) {
    if (result.error) throw new Error(`Provider callback ${label} failed: ${result.error.message}`);
  }
  if (jobReadback.data.output_payload?.route !== "provider-callback" || jobReadback.data.output_payload?.externalJobId !== externalJobId) {
    throw new Error("Provider callback job readback did not preserve route/external job metadata.");
  }
  if (Number(jobReadback.data.cost_actual) !== 1.25 || jobReadback.data.cost_currency !== "USD" || jobReadback.data.usage_metadata?.providerCredits !== 12) {
    throw new Error("Provider callback job readback did not preserve actual cost and usage metadata.");
  }
  if (sceneReadback.data.status !== "Approved" || sceneReadback.data.approved_asset_id !== data.asset.id) {
    throw new Error("Provider callback did not persist approved Scene Card asset linkage.");
  }
  if (assetReadback.data.metadata?.externalJobId !== externalJobId || assetReadback.data.metadata?.storagePath !== videoUpload.path) {
    throw new Error("Provider callback asset readback did not preserve provider metadata and Storage path.");
  }
}

async function verifyReleaseOperationProcessor(productionPackage, exportUpload) {
  const finalAssetId = randomUUID();
  const finalExport = {
    id: finalAssetId,
    workspace_id: workspaceId,
    project_id: productionPackage.project.id,
    type: "Final Export",
    file_url: exportUpload.signedUrl,
    mime_type: "video/mp4",
    filename: `${auditId}-final-render.mp4`,
    status: "Stored",
    provider: "NOX Live Audit / Render Worker / nox-exports",
    notes: "Live audit final export placeholder proves release operation status sync.",
    tags: ["live-audit", "rendered-mp4", "export", "nox-cut"],
    duration_seconds: 60,
    metadata: {
      attachedTo: `${productionPackage.project.title} / Render Engine V1`,
      storagePath: exportUpload.path,
      storageBucket: exportUpload.bucket,
      renderJobId: `live-audit-${auditId}`,
    },
  };
  await insertRows("assets", [finalExport], "final export asset");

  const approvedAssets = await supabase
    .from("assets")
    .select("*")
    .eq("project_id", productionPackage.project.id)
    .eq("type", "Video")
    .eq("status", "Approved");
  if (approvedAssets.error) throw new Error(`Release operation approved assets read failed: ${approvedAssets.error.message}`);

  const plan = {
    schemaVersion: 1,
    operation: "NOX Release Operation",
    platform: "TikTok",
    projectId: productionPackage.project.id,
    projectTitle: productionPackage.project.title,
    releaseStatus: "NOX Films Draft",
    ready: true,
    blockers: [],
    schedule: {
      status: "NOX Films Draft",
      recommendedWindow: "Live audit release window",
      timezone: "workspace local time",
    },
    preset: {
      aspectRatio: "9:16",
      maxDuration: "60 seconds",
      deliveryFile: "vertical .mp4, h.264, AAC audio",
      captionStyle: "short hook, caption, hashtags, pinned comment",
    },
    metadata: {
      title: productionPackage.publishKit.tiktokTitle,
      description: productionPackage.publishKit.caption,
      hashtags: productionPackage.publishKit.hashtags,
      tags: productionPackage.publishKit.tags,
      pinnedComment: productionPackage.publishKit.pinnedComment,
    },
    thumbnail: {
      prompt: productionPackage.publishKit.thumbnailPrompt,
      safeZones: "Keep title and face inside center-safe vertical crop.",
    },
    files: {
      finalVideo: releaseAssetFileFromRow(finalExport),
      approvedSceneVideos: (approvedAssets.data ?? []).map(releaseAssetFileFromRow),
      exports: [releaseAssetFileFromRow(finalExport)],
      timeline: productionPackage.timelineItems.map((item) => ({
        id: item.id,
        trackType: item.trackType,
        label: item.label,
        startTime: item.startTime,
        endTime: item.endTime,
        assetId: item.assetId,
      })),
    },
    checklist: [
      { label: "Final MP4 attached", done: true },
      { label: "All Scene Card videos approved", done: true },
      { label: "Thumbnail prompt ready", done: true },
      { label: "TikTok metadata ready", done: true },
    ],
    steps: [
      { label: "Confirm final MP4 and approved Scene Card video manifest", done: true },
      { label: "Review TikTok metadata, thumbnail prompt, and posting window", done: true },
      { label: "Upload or schedule on TikTok", done: false },
      { label: "Archive posted URL and final package in Asset Vault", done: false },
    ],
    generatedAt: new Date().toISOString(),
  };
  const job = {
    id: randomUUID(),
    workspaceId,
    projectId: productionPackage.project.id,
    task: "TikTok release operation",
    project: productionPackage.project.title,
    provider: "TikTok Publishing",
    status: "Queued",
    cost: "Manual",
    inputPayload: JSON.stringify(plan),
    outputPayload: "",
    retryCount: 0,
    maxRetries: 2,
    priority: 90,
    runAfter: new Date(Date.now() - 1000).toISOString(),
    logs: [`${new Date().toISOString()} - Queued: Live audit release operation.`],
    createdAt: new Date().toISOString(),
  };
  await insertRows("generation_jobs", [generationJobToRow(job)], "release operation job");

  const { data, error } = await supabase.functions.invoke("process-generation-job", {
    body: {
      jobId: job.id,
      context: {
        releaseAudit: true,
      },
    },
  });
  if (error || !data?.job) throw new Error(`Release operation processing failed: ${error?.message ?? "No release job returned."}`);
  if (data.job.status !== "Completed" || !data.job.outputPayload?.includes("ready to upload or schedule")) {
    throw new Error(`Release operation did not complete through the release route; got ${data.job.status}.`);
  }

  const [projectReadback, publishKitReadback, jobReadback] = await Promise.all([
    supabase.from("projects").select("release_status").eq("id", productionPackage.project.id).single(),
    supabase.from("publish_kits").select("release_status").eq("project_id", productionPackage.project.id).single(),
    supabase.from("generation_jobs").select("*").eq("id", job.id).single(),
  ]);
  for (const [label, result] of Object.entries({ projectReadback, publishKitReadback, jobReadback })) {
    if (result.error) throw new Error(`Release operation ${label} failed: ${result.error.message}`);
  }
  if (projectReadback.data.release_status !== "Scheduled" || publishKitReadback.data.release_status !== "Scheduled") {
    throw new Error("Release operation did not persist Scheduled status to both Project and Publish Kit.");
  }
  if (jobReadback.data.output_payload?.releaseStatus !== "Scheduled" || jobReadback.data.output_payload?.route !== "release-operation") {
    throw new Error("Release operation job readback did not preserve release route metadata.");
  }
}

async function verifySavedPackage(productionPackage) {
  const [project, workspaceMember, providerReadback, scenes, beats, assets, generationJobs, publishKit, timelineItems] = await Promise.all([
    supabase.from("projects").select("*").eq("id", productionPackage.project.id).single(),
    supabase.from("workspace_members").select("*").eq("workspace_id", workspaceId).eq("role", "owner").single(),
    supabase.from("provider_settings").select("*").eq("workspace_id", workspaceId),
    supabase.from("scenes").select("*").eq("project_id", productionPackage.project.id),
    supabase.from("scene_beats").select("*").in("scene_id", productionPackage.scenes.map((scene) => scene.id)),
    supabase.from("assets").select("*").eq("project_id", productionPackage.project.id),
    supabase.from("generation_jobs").select("*").eq("project_id", productionPackage.project.id),
    supabase.from("publish_kits").select("*").eq("project_id", productionPackage.project.id).single(),
    supabase.from("timeline_items").select("*").eq("project_id", productionPackage.project.id),
  ]);

  for (const [label, result] of Object.entries({ project, workspaceMember, providerReadback, scenes, beats, assets, generationJobs, publishKit, timelineItems })) {
    if (result.error) throw new Error(`Readback failed for ${label}: ${result.error.message}`);
  }

  if (project.data.status !== "Editing") throw new Error("Project CRUD update did not persist.");
  if (workspaceMember.data.role !== "owner") throw new Error("Workspace member readback did not preserve owner role.");
  if (!providerReadback.data.some((provider) => provider.provider_id === "manual" && provider.enabled === true && provider.mode === "Manual")) {
    throw new Error("Provider settings readback did not preserve Manual Mode routing.");
  }
  if (!providerReadback.data.some((provider) => provider.provider_id === "grok" && provider.enabled === true && provider.mode === "API")) {
    throw new Error("Provider settings readback did not preserve Grok API routing.");
  }
  if (!providerReadback.data.some((provider) => provider.provider_id === "grok" && provider.connection_status === "Configured")) {
    throw new Error("Provider settings readback did not preserve Grok connection metadata.");
  }
  if (scenes.data.length !== productionPackage.scenes.length) throw new Error(`Scene readback count mismatch: ${scenes.data.length}.`);
  if (beats.data.length !== productionPackage.scenes.reduce((total, scene) => total + scene.beats.length, 0)) throw new Error("Scene Beat readback count mismatch.");
  if (!assets.data.some((asset) => asset.status === "Approved" && asset.metadata?.promptUsed?.includes("[SCENE]"))) {
    throw new Error("Approved Asset Vault prompt lineage did not persist.");
  }
  if (!generationJobs.data.some((job) => Array.isArray(job.logs) && typeof job.retry_count === "number" && typeof job.max_retries === "number")) {
    throw new Error("Generation job lifecycle readback did not preserve retry/log metadata.");
  }
  if (project.data.release_status !== "Scheduled") throw new Error("Project release operation status did not persist.");
  if (!publishKit.data.thumbnail_prompt || publishKit.data.release_status !== "Scheduled") throw new Error("Publish Kit readback did not match generated metadata.");
  if (!timelineItems.data.some((item) => item.asset_id && item.track_type === "video")) throw new Error("NOX Cut timeline asset link did not persist.");
}

async function verifyFreshSessionReload(productionPackage, videoUpload) {
  const freshClient = createAuditClient();
  try {
    await signInClient(freshClient, config.email, config.password, "fresh-session reload user");

    const [
      workspace,
      workspaceMember,
      project,
      providerReadback,
      scenes,
      beats,
      assets,
      generationJobs,
      publishKit,
      timelineItems,
      signedUrl,
    ] = await Promise.all([
      freshClient.from("workspaces").select("*").eq("id", workspaceId).single(),
      freshClient.from("workspace_members").select("*").eq("workspace_id", workspaceId).eq("role", "owner").single(),
      freshClient.from("projects").select("*").eq("id", productionPackage.project.id).single(),
      freshClient.from("provider_settings").select("*").eq("workspace_id", workspaceId),
      freshClient.from("scenes").select("*").eq("project_id", productionPackage.project.id),
      freshClient.from("scene_beats").select("*").in("scene_id", productionPackage.scenes.map((scene) => scene.id)),
      freshClient.from("assets").select("*").eq("project_id", productionPackage.project.id),
      freshClient.from("generation_jobs").select("*").eq("project_id", productionPackage.project.id),
      freshClient.from("publish_kits").select("*").eq("project_id", productionPackage.project.id).single(),
      freshClient.from("timeline_items").select("*").eq("project_id", productionPackage.project.id),
      freshClient.storage.from(videoUpload.bucket).createSignedUrl(videoUpload.path, 60),
    ]);

    for (const [label, result] of Object.entries({
      workspace,
      workspaceMember,
      project,
      providerReadback,
      scenes,
      beats,
      assets,
      generationJobs,
      publishKit,
      timelineItems,
      signedUrl,
    })) {
      if (result.error) throw new Error(`Fresh-session reload failed for ${label}: ${result.error.message}`);
    }

    if (workspace.data.id !== workspaceId || workspaceMember.data.role !== "owner") {
      throw new Error("Fresh-session reload did not preserve workspace ownership visibility.");
    }
    if (project.data.status !== "Editing" || project.data.release_status !== "Scheduled") {
      throw new Error("Fresh-session reload did not preserve project CRUD/release state.");
    }
    if (!providerReadback.data.some((provider) => provider.provider_id === "manual" && provider.enabled === true && provider.mode === "Manual")) {
      throw new Error("Fresh-session reload did not preserve workspace provider settings.");
    }
    if (!providerReadback.data.some((provider) => provider.provider_id === "grok" && provider.connection_status === "Configured")) {
      throw new Error("Fresh-session reload did not preserve Grok provider connection metadata.");
    }
    if (scenes.data.length !== productionPackage.scenes.length) {
      throw new Error(`Fresh-session reload Scene Card count mismatch: ${scenes.data.length}.`);
    }
    if (!scenes.data.some((scene) => scene.status === "Approved" && scene.approved_asset_id)) {
      throw new Error("Fresh-session reload did not preserve approved Scene Card asset linkage.");
    }
    if (beats.data.length !== productionPackage.scenes.reduce((total, scene) => total + scene.beats.length, 0)) {
      throw new Error("Fresh-session reload did not preserve Scene Beat rows.");
    }
    if (!assets.data.some((asset) => asset.status === "Approved" && asset.metadata?.storagePath === videoUpload.path && asset.metadata?.promptUsed?.includes("[SCENE]"))) {
      throw new Error("Fresh-session reload did not preserve approved Asset Vault storage and prompt lineage.");
    }
    if (!generationJobs.data.some((job) => job.status === "Completed" && job.output_payload?.route === "supabase-edge")) {
      throw new Error("Fresh-session reload did not preserve processed generation job output metadata.");
    }
    if (!publishKit.data.thumbnail_prompt || publishKit.data.release_status !== "Scheduled") {
      throw new Error("Fresh-session reload did not preserve Publish Kit metadata.");
    }
    if (!timelineItems.data.some((item) => item.asset_id && item.track_type === "video")) {
      throw new Error("Fresh-session reload did not preserve NOX Cut timeline asset links.");
    }
    if (!signedUrl.data?.signedUrl) {
      throw new Error("Fresh-session reload did not preserve private Storage signed preview access.");
    }
  } finally {
    await freshClient.auth.signOut();
  }
}

async function verifyWorkspaceIsolation(videoUpload) {
  if (!config.otherEmail || !config.otherPassword) {
    if (config.strictIsolation) throw new Error("Strict isolation mode requires NOX_SUPABASE_OTHER_EMAIL and NOX_SUPABASE_OTHER_PASSWORD.");
    console.log("Cross-user isolation audit skipped; set NOX_SUPABASE_OTHER_EMAIL and NOX_SUPABASE_OTHER_PASSWORD to verify denial from a second user.");
    return;
  }

  const otherClient = createAuditClient();
  const otherUser = await signInClient(otherClient, config.otherEmail, config.otherPassword, "secondary isolation user");
  const primaryUser = (await supabase.auth.getUser()).data.user;
  if (primaryUser?.id === otherUser.id) {
    throw new Error("Isolation audit requires two different Supabase users.");
  }

  const visibleWorkspace = await otherClient.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  if (visibleWorkspace.error) throw new Error(`Secondary workspace visibility check failed unexpectedly: ${visibleWorkspace.error.message}`);
  if (visibleWorkspace.data) throw new Error("Secondary user can read the primary audit workspace.");

  const deleteAttempt = await otherClient.from("workspaces").delete().eq("id", workspaceId).select("id");
  if (deleteAttempt.error) throw new Error(`Secondary workspace delete attempt returned an unexpected transport error: ${deleteAttempt.error.message}`);
  if ((deleteAttempt.data ?? []).length) throw new Error("Secondary user deleted the primary audit workspace.");

  const primaryReadback = await supabase.from("workspaces").select("id").eq("id", workspaceId).single();
  if (primaryReadback.error || !primaryReadback.data) throw new Error(`Primary workspace disappeared after isolation delete attempt: ${primaryReadback.error?.message ?? "No row."}`);

  const signedUrlAttempt = await otherClient.storage.from(videoUpload.bucket).createSignedUrl(videoUpload.path, 60);
  if (!signedUrlAttempt.error && signedUrlAttempt.data?.signedUrl) {
    throw new Error("Secondary user can create a signed URL for the primary workspace storage object.");
  }

  const uploadAttempt = await otherClient.storage.from(videoUpload.bucket).upload(
    `${workspaceId}/_live-audit/secondary-denied-${auditId}.json`,
    new Blob([JSON.stringify({ auditId, outsider: true })], { type: "application/json" }),
    { contentType: "application/json", upsert: true },
  );
  if (!uploadAttempt.error) throw new Error("Secondary user can upload into the primary workspace storage prefix.");
}

async function cleanupAuditData() {
  const cleanupFailures = [];

  for (const { bucket, path } of uploadedPaths) {
    const remove = await supabase.storage.from(bucket).remove([path]);
    if (remove.error) {
      cleanupFailures.push(`Storage cleanup failed for ${bucket}/${path}: ${remove.error.message}`);
      continue;
    }

    const { prefix, filename } = splitStoragePath(path);
    const list = await supabase.storage.from(bucket).list(prefix, { limit: 100, search: filename });
    if (list.error) {
      cleanupFailures.push(`Storage cleanup verification failed for ${bucket}/${path}: ${list.error.message}`);
    } else if ((list.data ?? []).some((object) => object.name === filename)) {
      cleanupFailures.push(`Storage cleanup left ${bucket}/${path} visible.`);
    }
  }

  if (workspaceCreated) {
    const deleteWorkspace = await supabase.from("workspaces").delete().eq("id", workspaceId).select("id");
    if (deleteWorkspace.error) {
      cleanupFailures.push(`Workspace cleanup delete failed: ${deleteWorkspace.error.message}`);
    }

    const workspaceReadback = await supabase.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
    if (workspaceReadback.error) {
      cleanupFailures.push(`Workspace cleanup verification failed: ${workspaceReadback.error.message}`);
    } else if (workspaceReadback.data) {
      cleanupFailures.push("Workspace cleanup left workspace visible.");
    }
  }

  if (cleanupFailures.length) throw new Error(cleanupFailures.join("\n"));
  return { storageObjects: uploadedPaths.length };
}

function splitStoragePath(path) {
  const parts = path.split("/");
  const filename = parts.pop();
  return { prefix: parts.join("/"), filename };
}

function releaseAssetFileFromRow(asset) {
  return {
    assetId: asset.id,
    filename: asset.filename,
    storagePath: asset.metadata?.storagePath,
    fileUrl: asset.file_url,
    provider: asset.provider,
    mimeType: asset.mime_type,
    status: asset.status,
  };
}

async function insertRows(table, rows, label) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).insert(rows);
  if (error) throw new Error(`Insert failed for ${label}: ${error.message}`);
}

function projectToRow(project) {
  return {
    id: project.id,
    workspace_id: project.workspaceId,
    type: project.type,
    title: project.title,
    slug: project.id,
    idea: project.idea,
    logline: project.logline,
    synopsis: project.synopsis,
    status: project.status,
    release_status: project.releaseStatus,
    format: project.format,
    duration_seconds: project.sceneCount * 10,
    scene_count: project.sceneCount,
    genre: project.genre,
    tone: project.tone,
    world_name: project.world,
    ai_target: project.aiTarget,
    language: project.language,
    metadata: {
      nextStep: project.nextStep,
      posterTone: project.posterTone,
      runtime: project.runtime,
      mainCharacters: project.mainCharacters,
    },
  };
}

function sceneToRow(scene) {
  return {
    id: scene.id,
    project_id: scene.projectId,
    scene_number: scene.number,
    title: scene.title,
    purpose: scene.purpose,
    duration_seconds: scene.durationSeconds,
    output: scene.output,
    format: scene.format,
    location: scene.location,
    characters: scene.characters,
    mood: scene.mood,
    visual_style: scene.visualStyle,
    summary: scene.summary,
    full_prompt: scene.fullPrompt,
    negative_prompt: scene.negativePrompt,
    dialogue: scene.dialogue,
    audio_notes: scene.audio,
    continuity_rules: scene.continuityRules,
    status: scene.status,
    approved_asset_id: scene.approvedAssetId,
    metadata: {
      uploadedAsset: scene.uploadedAsset,
      promptProvider: scene.promptProvider,
      promptCopiedAt: scene.promptCopiedAt,
      externalProvider: scene.externalProvider,
    },
  };
}

function beatToRow(beat, sceneId, index) {
  const [start, end] = beat.range.replace(/s/g, "").split("-").map((value) => Number(value.trim()));
  return {
    id: beat.id,
    scene_id: sceneId,
    beat_number: index + 1,
    start_second: Number.isFinite(start) ? start : index === 0 ? 0 : index === 1 ? 3 : 7,
    end_second: Number.isFinite(end) ? end : index === 0 ? 3 : index === 1 ? 7 : 10,
    title: beat.title,
    description: beat.description,
    camera_direction: beat.camera,
    action: beat.description,
    audio: beat.audio,
  };
}

function characterToRow(character) {
  return {
    id: character.id,
    workspace_id: character.workspaceId,
    name: character.name,
    alias: character.alias,
    role: character.role,
    personality: character.personality,
    backstory: character.backstory,
    visual_identity: character.visualIdentity,
    reference_image_url: character.referenceImageUrl,
    voice_style: character.voice,
    accent: character.accent,
    wardrobe_rules: character.wardrobeRules,
    prompt_identity: character.promptIdentity,
    negative_rules: character.negativeRules,
    appears_in: character.appearsIn,
  };
}

function worldToRow(world) {
  return {
    id: world.id,
    workspace_id: world.workspaceId,
    name: world.name,
    description: world.description,
    tone: world.tone,
    locations: world.locations,
    visual_rules: world.visualRules,
    technology: world.technology,
    factions: world.factions,
    recurring_symbols: world.recurringSymbols,
    timeline: world.timeline,
  };
}

function locationToRow(location) {
  return {
    id: location.id,
    workspace_id: location.workspaceId,
    world_id: location.worldId,
    name: location.name,
    description: location.description,
    visual_rules: location.visualRules,
    timeline_notes: location.timelineNotes,
  };
}

function factionToRow(faction) {
  return {
    id: faction.id,
    workspace_id: faction.workspaceId,
    world_id: faction.worldId,
    name: faction.name,
    description: faction.description,
    visual_rules: faction.visualRules,
    negative_rules: faction.negativeRules,
    timeline_notes: faction.timelineNotes,
  };
}

function publishKitToRow(kit) {
  return {
    id: kit.id,
    project_id: kit.projectId,
    tiktok_title: kit.tiktokTitle,
    caption: kit.caption,
    hashtags: kit.hashtags,
    hook_line: kit.hookLine,
    pinned_comment: kit.pinnedComment,
    youtube_title: kit.youtubeTitle,
    description: kit.description,
    tags: kit.tags,
    chapters: kit.chapters,
    nox_films_row: kit.noxFilmsRow,
    runtime: kit.runtime,
    genre: kit.genre,
    thumbnail_prompt: kit.thumbnailPrompt,
    poster_prompt: kit.posterPrompt,
    release_status: kit.releaseStatus,
  };
}

function timelineItemToRow(item) {
  return {
    id: item.id,
    project_id: item.projectId,
    asset_id: item.assetId,
    scene_id: item.sceneId,
    track_type: item.trackType,
    label: item.label,
    start_time: item.startTime,
    end_time: item.endTime,
    order_index: item.orderIndex,
    transition_in: item.transitionIn,
    transition_out: item.transitionOut,
    text_overlay: item.textOverlay,
    subtitle_text: item.subtitleText,
    trim_start_note: item.trimStartNote,
    trim_end_note: item.trimEndNote,
    editor_notes: item.editorNotes,
  };
}

function generationJobToRow(job) {
  return {
    id: job.id,
    workspace_id: job.workspaceId,
    project_id: job.projectId,
    scene_id: job.sceneId,
    job_type: job.task,
    provider: job.provider,
    status: job.status,
    input_payload: { text: job.inputPayload },
    output_payload: { text: job.outputPayload ?? "", project: job.project },
    error_message: job.errorMessage ?? "",
    cost_estimate: parseCost(job.cost),
    cost_actual: job.costActual ?? null,
    cost_currency: job.costCurrency ?? "USD",
    usage_metadata: job.usageMetadata ?? {},
    retry_count: job.retryCount ?? 0,
    max_retries: job.maxRetries ?? 2,
    logs: job.logs ?? [],
    priority: job.priority ?? 0,
    run_after: dateOrNow(job.runAfter),
    locked_at: dateOrNull(job.lockedAt),
    locked_by: job.lockedBy ?? null,
    started_at: dateOrNull(job.startedAt),
    completed_at: dateOrNull(job.completedAt),
  };
}

function dateOrNow(value) {
  return dateOrNull(value) ?? new Date().toISOString();
}

function dateOrNull(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function brandKitToRow(kit, targetWorkspaceId) {
  return {
    workspace_id: targetWorkspaceId,
    studio_name: kit.studioName,
    creator_name: kit.creatorName,
    intro_text: kit.introText,
    outro_text: kit.outroText,
    watermark_asset_id: kit.watermarkAssetId ?? null,
    default_style: kit.defaultStyle,
    default_export: kit.defaultExport,
    subtitle_style: kit.subtitleStyle,
    default_colors: kit.colors,
    default_hashtags: kit.hashtags,
  };
}

function providerToRow(provider, targetWorkspaceId) {
  return {
    workspace_id: targetWorkspaceId,
    provider_id: provider.id,
    name: provider.name,
    supported_tasks: provider.supportedTasks,
    speed: provider.speed,
    quality: provider.quality,
    enabled: provider.enabled,
    mode: provider.mode,
    api_endpoint: provider.apiEndpoint ?? "",
    secret_name: provider.secretName ?? "",
    webhook_enabled: provider.webhookEnabled ?? false,
    connection_status: provider.connectionStatus ?? "Not configured",
    config: provider.config ?? {},
    updated_at: new Date().toISOString(),
  };
}

function parseCost(cost) {
  const value = Number(String(cost).replace(/[^0-9.]/g, ""));
  return Number.isFinite(value) ? value : null;
}

function loadDotEnvFiles(files) {
  for (const file of files) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = stripEnvQuotes(match[2].trim());
    }
  }
}

function stripEnvQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function createAuditClient() {
  return createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
