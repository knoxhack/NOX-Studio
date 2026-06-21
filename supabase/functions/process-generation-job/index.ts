import { polishScenePrompt, regenerateScenePrompt } from "../_shared/nox-core.ts";
import { requestGrokImage, requestGrokVideo, requestStructuredOutput } from "../_shared/grok.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-nox-callback-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DbRow = Record<string, any>;
type RestConfig = {
  url: string;
  anonKey: string;
  authorization: string;
};

const promptTaskPattern = /prompt|story|continuity|caption|poster|metadata/i;
const imageTaskPattern = /poster|thumbnail|image|reference|brand visual|brand asset/i;
const scenePromptTaskPattern = /scene prompt|prompt regeneration|prompt polish/i;
const continuityTaskPattern = /continuity check|continuity review|continuity audit|continuity/i;
const videoTaskPattern = /video|sora|veo|kling|runway|grok/i;
const renderTaskPattern = /render engine|ffmpeg|mp4 assembly/i;
const releaseTaskPattern = /release operation|publishing|publish/i;
const terminalStatuses = new Set(["Completed", "Failed", "Approved"]);
const requiredPromptSections = ["[SCENE]", "[TIMING]", "[STYLE]", "[CAMERA]", "[AUDIO]", "[DIALOGUE]", "[NEGATIVE PROMPT]"];
const stringArraySchema = {
  type: "array",
  items: { type: "string" },
};
const scenePromptJobDraftSchema = {
  type: "object",
  properties: {
    purpose: { type: "string" },
    location: { type: "string" },
    mood: { type: "string" },
    visualStyle: { type: "string" },
    summary: { type: "string" },
    dialogue: { type: "string" },
    audio: { type: "string" },
    negativePrompt: { type: "string" },
    continuityRules: stringArraySchema,
    fullPrompt: { type: "string" },
  },
  required: ["purpose", "location", "mood", "visualStyle", "summary", "dialogue", "audio", "negativePrompt", "continuityRules", "fullPrompt"],
  additionalProperties: false,
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: corsHeaders });
  }

  try {
    const input = await request.json();
    if (input?.action === "health") {
      return Response.json(
        {
          ok: true,
          function: "process-generation-job",
          source: "supabase-edge",
          authRequired: true,
          supabaseConfigured: Boolean(getRequiredEnv("SUPABASE_URL", false) && getRequiredEnv("SUPABASE_ANON_KEY", false)),
        },
        { headers: corsHeaders },
      );
    }

    if (input?.action === "provider-callback") {
      validateProviderCallbackToken(request, input);
      const result = await processProviderCallback(getServiceRestConfig(), input);
      return Response.json(result, { headers: corsHeaders });
    }

    const authorization = request.headers.get("authorization");
    if (!authorization) {
      return Response.json({ error: "Authorization header is required." }, { status: 401, headers: corsHeaders });
    }

    const rest = getRestConfig(authorization);
    if (input?.action === "process-next") {
      if (!input?.workspaceId || typeof input.workspaceId !== "string") {
        return Response.json({ error: "workspaceId is required for process-next." }, { status: 400, headers: corsHeaders });
      }
      const result = await processNextGenerationJob(rest, input.workspaceId, asObject(input.context), asText(input.workerId, "edge-worker"));
      return Response.json(result, { headers: corsHeaders });
    }

    if (!input?.jobId || typeof input.jobId !== "string") {
      return Response.json({ error: "jobId is required." }, { status: 400, headers: corsHeaders });
    }

    const result = await processGenerationJob(rest, input.jobId, asObject(input.context));
    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Generation job processing failed." },
      { status: 500, headers: corsHeaders },
    );
  }
});

async function processGenerationJob(rest: RestConfig, jobId: string, context: DbRow) {
  let job = await fetchRequiredRow(rest, "generation_jobs", `id=eq.${encodeURIComponent(jobId)}&select=*`, "Generation job");
  job = await startJob(rest, job, "direct-job-run", "Supabase Edge job processor started.");
  return processClaimedGenerationJob(rest, job, context);
}

async function processNextGenerationJob(rest: RestConfig, workspaceId: string, context: DbRow, workerId: string) {
  const jobs = await rpcRows(rest, "claim_next_generation_job", {
    target_workspace_id: workspaceId,
    worker_id: workerId,
  });

  if (!jobs[0]) {
    return {
      job: null,
      message: "No queued generation jobs are due for this workspace.",
      source: "supabase-edge",
      workerId,
    };
  }

  return processClaimedGenerationJob(rest, jobs[0], context);
}

async function processClaimedGenerationJob(rest: RestConfig, job: DbRow, context: DbRow) {
  try {
    if (isRenderJob(job)) {
      return await processRenderJob(rest, job);
    }

    if (isScenePromptJob(job)) {
      return await processScenePromptJob(rest, job, context);
    }

    if (isContinuityJob(job)) {
      return await processContinuityReviewJob(rest, job);
    }

    if (isReleaseOperationJob(job)) {
      return await processReleaseOperationJob(rest, job);
    }

    if (isImageGenerationJob(job)) {
      return await processGrokImageJob(rest, job);
    }

    if (isVideoProviderJob(job)) {
      return await processVideoProviderJob(rest, job);
    }

    if (promptTaskPattern.test(asText(job.job_type))) {
      const provider = asText(job.provider, "Manual Mode");
      const status = /manual/i.test(provider) ? "Needs Review" : "Completed";
      const message = `${provider} route prepared ${status === "Completed" ? "for metadata/prompt work" : "as a manual review handoff"}.`;
      const nextJob = await settleJob(rest, job, status, message, {
        costEstimate: status === "Completed" ? 0.02 : null,
        outputPayload: buildOutputPayload(job, message, { route: "supabase-edge", provider }),
      });
      return { job: rowToGenerationJob(nextJob), message, source: "supabase-edge" };
    }

    const message = "Supabase Edge processor completed this queued production task.";
    const nextJob = await settleJob(rest, job, "Completed", message, {
      costEstimate: 0,
      outputPayload: buildOutputPayload(job, message, { route: "supabase-edge" }),
    });
    return { job: rowToGenerationJob(nextJob), message, source: "supabase-edge" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Generation job processing failed.";
    const failedJob = await settleJob(rest, job, "Failed", detail, {
      outputPayload: buildOutputPayload(job, detail, { route: "supabase-edge" }),
    });
    return { job: rowToGenerationJob(failedJob), message: detail, source: "supabase-edge" };
  }
}

async function startJob(rest: RestConfig, job: DbRow, workerId: string, detail: string) {
  return updateJob(rest, job, {
    status: "Running",
    started_at: job.started_at ?? new Date().toISOString(),
    completed_at: null,
    error_message: "",
    locked_at: new Date().toISOString(),
    locked_by: workerId,
    run_after: job.run_after ?? new Date().toISOString(),
    logs: appendLog(job.logs, `Running: ${detail}`),
  });
}

async function processScenePromptJob(rest: RestConfig, job: DbRow, context: DbRow) {
  if (!job.scene_id) throw new Error("Scene prompt job is missing its linked Scene Card.");

  const sceneRow = await fetchRequiredRow(rest, "scenes", `id=eq.${encodeURIComponent(job.scene_id)}&select=*`, "Scene Card");
  const beatRows = await fetchRows(rest, "scene_beats", `scene_id=eq.${encodeURIComponent(sceneRow.id)}&select=*&order=beat_number.asc`);
  const projectRows = await fetchRows(rest, "projects", `id=eq.${encodeURIComponent(sceneRow.project_id)}&select=title,ai_target,language`);
  const project = projectRows[0] ?? {};
  const scene = rowToSceneCard(sceneRow, beatRows);
  const provider = resolveProviderName(job, sceneRow, project);
  const action = /polish/i.test(asText(job.job_type)) ? "polish" : "regenerate";
  const promptContext = {
    ...context,
    language: asObject(context.language, asObject(project.language, undefined)),
  };
  const fallbackScene =
    action === "polish"
      ? polishScenePrompt(scene, provider, promptContext)
      : regenerateScenePrompt(scene, provider, promptContext);
  const grokResult = await requestStructuredOutput({
    workspaceId: asText(job.workspace_id),
    authorization: rest.authorization,
    name: "nox_scene_prompt_job",
    description: "A copy-ready NOX Studio provider prompt generated from a queued Scene Card job.",
    schema: scenePromptJobDraftSchema,
    developerPrompt: [
      "You are the NOX Scene Prompt Engine running inside the production queue.",
      "Return only structured JSON.",
      "Preserve the invariant: one Scene Card equals one generated 10-second video.",
      "The fullPrompt must include [SCENE], [TIMING], [STYLE], [CAMERA], [AUDIO], [DIALOGUE], and [NEGATIVE PROMPT] sections.",
      "Keep Spanish dialogue and Honduran / Central American voice style when present.",
    ].join("\n"),
    userPrompt: JSON.stringify({
      action,
      provider,
      scene,
      context: promptContext,
      fallbackPrompt: fallbackScene.fullPrompt,
      requiredPromptSections,
    }),
  });
  const nextScene = grokResult.data
    ? applyGrokScenePromptJobDraft(fallbackScene, grokResult.data, provider, action, promptContext.language)
    : fallbackScene;
  const scenePatch = {
    full_prompt: nextScene.fullPrompt,
    status: nextScene.status,
    metadata: {
      ...asObject(sceneRow.metadata),
      promptProvider: nextScene.promptProvider,
      externalProvider: provider,
      promptCopiedAt: nextScene.promptCopiedAt,
    },
    updated_at: new Date().toISOString(),
  };
  await patchRows(rest, "scenes", `id=eq.${encodeURIComponent(scene.id)}`, scenePatch);

  const message = grokResult.error
    ? `${provider} ${action} prompt used deterministic fallback after Grok error: ${grokResult.error}`
    : `${provider} ${action} prompt completed by Grok through the Supabase Edge processor.`;
  const nextJob = await settleJob(rest, job, "Completed", message, {
    costEstimate: grokResult.source === "grok-chat" ? 0.02 : 0,
    outputPayload: buildOutputPayload(job, `${nextScene.promptProvider ?? provider} ${action} pass generated.`, {
      route: "supabase-edge",
      providerSource: grokResult.source,
      provider,
      action,
      model: grokResult.model,
      sceneId: scene.id,
    }),
  });

  return {
    job: rowToGenerationJob(nextJob),
    scene: { ...nextScene, externalProvider: provider },
    message,
    source: "supabase-edge",
  };
}

function applyGrokScenePromptJobDraft(scene: DbRow, draft: DbRow, provider: string, action: string, language: DbRow | undefined) {
  const fullPrompt = normalizeGrokPrompt(asText(draft.fullPrompt, scene.fullPrompt), scene.fullPrompt, action, language);
  return {
    ...scene,
    purpose: asText(draft.purpose, scene.purpose),
    location: asText(draft.location, scene.location),
    mood: asText(draft.mood, scene.mood),
    visualStyle: asText(draft.visualStyle, scene.visualStyle),
    summary: asText(draft.summary, scene.summary),
    dialogue: asText(draft.dialogue, scene.dialogue),
    audio: asText(draft.audio, scene.audio),
    negativePrompt: asText(draft.negativePrompt, scene.negativePrompt),
    continuityRules: asTextArray(draft.continuityRules).length ? asTextArray(draft.continuityRules) : scene.continuityRules,
    fullPrompt,
    status: "Prompt Ready",
    promptProvider: provider,
  };
}

function normalizeGrokPrompt(candidate: string, fallback: string, action: string, language: DbRow | undefined) {
  const hasSections = requiredPromptSections.every((section) => candidate.includes(section));
  const hasLanguageMarkers = getLanguageMarkers(language).every((marker) => candidate.includes(marker));
  const prompt = hasSections && hasLanguageMarkers ? candidate : fallback;
  if (action !== "polish" || prompt.includes("[POLISH PASS]")) return prompt;
  return `${prompt}

[POLISH PASS]
- Grok provider pass applied while preserving the exact one-video Scene Card structure.
- Keep all timed beats inside this single generated 10-second clip.
- Preserve subject, wardrobe, location, and dialogue continuity.`;
}

function getLanguageMarkers(language: DbRow | undefined) {
  if (!language || typeof language !== "object") return [];
  return [
    typeof language.promptLanguage === "string" ? `Prompt language: ${language.promptLanguage}` : "",
    typeof language.subtitles === "string" ? `Subtitle language: ${language.subtitles}` : "",
    typeof language.voiceStyle === "string" ? language.voiceStyle : "",
  ].filter(Boolean);
}

async function processContinuityReviewJob(rest: RestConfig, job: DbRow) {
  if (!job.scene_id) throw new Error("Continuity review job is missing its linked Scene Card.");

  const sceneRow = await fetchRequiredRow(rest, "scenes", `id=eq.${encodeURIComponent(job.scene_id)}&select=*`, "Scene Card");
  const beatRows = await fetchRows(rest, "scene_beats", `scene_id=eq.${encodeURIComponent(sceneRow.id)}&select=*&order=beat_number.asc`);
  const projectRows = await fetchRows(rest, "projects", `id=eq.${encodeURIComponent(sceneRow.project_id)}&select=id,workspace_id,title,world_name`);
  const project = projectRows[0] ?? {};
  const workspaceId = asText(project.workspace_id, asText(job.workspace_id));
  const [characterRows, worldRows, locationRows, factionRows] = await Promise.all([
    fetchRows(rest, "characters", `workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*`),
    fetchRows(rest, "worlds", `workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*`),
    fetchRows(rest, "locations", `workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*`),
    fetchRows(rest, "factions", `workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*`),
  ]);

  const scene = rowToSceneCard(sceneRow, beatRows);
  const report = runContinuityReview(
    scene,
    characterRows.map(rowToContinuityCharacter),
    worldRows.map(rowToContinuityWorld),
    locationRows.map(rowToContinuityLocation),
    factionRows.map(rowToContinuityFaction),
  );
  const status = report.status === "Pass" ? "Completed" : "Needs Review";
  const provider = asText(job.provider, "Continuity Agent");
  const detail = `${provider} continuity review: ${report.summary}`;
  const nextJob = await settleJob(rest, job, status, detail, {
    costEstimate: /grok/i.test(provider) ? 0.01 : 0,
    errorMessage: status === "Needs Review" ? report.issues.map((issue: DbRow) => `${issue.severity}: ${issue.label} - ${issue.message}`).join("\n") : "",
    outputPayload: buildOutputPayload(job, detail, {
      route: "continuity-review",
      provider,
      report,
      projectTitle: asText(project.title),
      nextAction:
        report.status === "Pass"
          ? "Scene Card is ready for prompt/video work."
          : "Fix missing continuity links in Character Vault, World Bible, Location, or Faction records before final approval.",
    }),
  });

  return {
    job: rowToGenerationJob(nextJob),
    continuityReport: report,
    message: detail,
    source: "supabase-edge",
  };
}

async function processVideoProviderJob(rest: RestConfig, job: DbRow) {
  const scene = job.scene_id
    ? await fetchRows(rest, "scenes", `id=eq.${encodeURIComponent(job.scene_id)}&select=id,scene_number,title,full_prompt`)
    : [];
  const sceneRow = scene[0];
  const provider = asText(job.provider, "Manual Mode");
  const providerSettings = await resolveProviderSettings(rest, job, provider);
  if (isGrokProvider(providerSettings, provider)) {
    return processGrokVideoProviderJob(rest, job, sceneRow, providerSettings, provider);
  }
  const providerSecret = providerSettings ? getProviderSecret(providerSettings) : "";
  if (providerSettings?.webhook_enabled && providerSettings.api_endpoint && providerSecret) {
    const webhookResult = await invokeProviderWebhook(providerSettings, job, sceneRow);
    await updateProviderConnectionStatus(rest, providerSettings, webhookResult.ok ? "Configured" : "Error");
    if (!webhookResult.ok) {
      const failedJob = await settleJob(rest, job, "Failed", webhookResult.error, {
        outputPayload: buildOutputPayload(job, webhookResult.error, {
          route: "provider-webhook",
          provider,
          endpoint: providerSettings.api_endpoint,
        }),
      });
      return { job: rowToGenerationJob(failedJob), message: webhookResult.error, source: "supabase-edge" };
    }

    const message = `${providerSettings.name ?? provider} provider API accepted the queued video job.`;
    const nextJob = await settleJob(rest, job, "Needs Review", message, {
      costEstimate: 0,
      outputPayload: buildOutputPayload(job, message, {
        route: "provider-webhook",
        provider: providerSettings.name ?? provider,
        endpoint: providerSettings.api_endpoint,
        externalJobId: webhookResult.externalJobId,
        response: webhookResult.response,
        sceneId: sceneRow?.id,
      }),
    });
    return { job: rowToGenerationJob(nextJob), message, source: "supabase-edge" };
  }

  const handoff = sceneRow
    ? `Provider handoff prepared: paste/upload Scene ${String(sceneRow.scene_number).padStart(2, "0")} prompt into ${provider}, then attach the generated 10-second clip to this Scene Card.`
    : `Provider handoff prepared: ${payloadToText(job.input_payload)}`;
  const missingSecret = Boolean(providerSettings?.webhook_enabled && providerSettings?.api_endpoint && providerSettings.secret_name && !providerSecret);
  if (providerSettings && missingSecret) await updateProviderConnectionStatus(rest, providerSettings, "Secret missing");
  const detail = missingSecret
    ? `${providerSettings.name ?? provider} API route is configured but Supabase secret ${providerSettings.secret_name} is missing; manual review handoff prepared.`
    : `${provider} handoff package prepared.`;
  const nextJob = await settleJob(rest, job, "Needs Review", detail, {
    costEstimate: /manual/i.test(provider) ? null : 0,
    outputPayload: buildOutputPayload(job, handoff, {
      route: "supabase-edge",
      provider,
      providerConnectionStatus: providerSettings?.connection_status,
      sceneId: sceneRow?.id,
    }),
  });

  return { job: rowToGenerationJob(nextJob), message: detail, source: "supabase-edge" };
}

async function processGrokVideoProviderJob(rest: RestConfig, job: DbRow, sceneRow: DbRow | undefined, providerSettings: DbRow | undefined, provider: string) {
  const prompt = sceneRow?.full_prompt ? asText(sceneRow.full_prompt) : payloadToText(job.input_payload);
  if (!prompt) throw new Error("Grok video job is missing a Scene Card prompt.");
  const response = await requestGrokVideo(prompt, {
    workspaceId: asText(job.workspace_id),
    authorization: rest.authorization,
  });
  if (providerSettings) await updateProviderConnectionStatus(rest, providerSettings, "Configured");
  const externalJobId = extractExternalJobId(response);
  const assetUrl = extractGrokAssetUrl(response);
  const message = assetUrl
    ? "Grok video generation returned a generated asset for Scene Card review."
    : "Grok video generation accepted the queued Scene Card job.";
  const nextJob = await settleJob(rest, job, assetUrl ? "Needs Review" : "Running", message, {
    costEstimate: 0,
    outputPayload: buildOutputPayload(job, message, {
      route: "grok-video",
      provider: providerSettings?.name ?? provider,
      externalJobId,
      response,
      sceneId: sceneRow?.id,
      assetUrl,
    }),
  });
  return { job: rowToGenerationJob(nextJob), message, source: "supabase-edge" };
}

async function processGrokImageJob(rest: RestConfig, job: DbRow) {
  const prompt = payloadToText(job.input_payload);
  if (!prompt) throw new Error("Grok image job is missing a prompt payload.");

  const response = await requestGrokImage(prompt, {
    workspaceId: asText(job.workspace_id),
    authorization: rest.authorization,
  });
  const externalJobId = extractExternalJobId(response);
  const assetUrl = normalizeGrokAssetUrl(extractGrokAssetUrl(response));
  const imageKind = resolveImageAssetKind(job);
  const message = assetUrl
    ? `Grok ${imageKind.label.toLowerCase()} generation returned a reviewable asset.`
    : `Grok ${imageKind.label.toLowerCase()} generation accepted the queued job.`;
  const createdAsset = assetUrl ? await createGrokImageAsset(rest, job, imageKind, assetUrl, prompt, externalJobId, response) : undefined;
  const nextJob = await settleJob(rest, job, assetUrl ? "Needs Review" : "Running", message, {
    costEstimate: 0,
    usageMetadata: {
      ...asObject(job.usage_metadata),
      route: "grok-image",
      assetType: imageKind.type,
      assetKind: imageKind.kind,
      externalJobId,
      assetId: createdAsset?.id,
    },
    outputPayload: buildOutputPayload(job, message, {
      route: "grok-image",
      provider: "Grok",
      externalJobId,
      response,
      assetId: createdAsset?.id,
      assetUrl,
      assetType: imageKind.type,
      assetKind: imageKind.kind,
    }),
  });

  return {
    job: rowToGenerationJob(nextJob),
    asset: createdAsset ? rowToStudioAsset(createdAsset) : undefined,
    message,
    source: "supabase-edge",
  };
}

function resolveImageAssetKind(job: DbRow) {
  const text = `${asText(job.job_type)} ${payloadToText(job.input_payload)} ${asText(job.provider)}`.toLowerCase();
  if (text.includes("poster")) return { kind: "poster", label: "Poster", type: "Poster", mimeType: "image/png" };
  if (text.includes("brand")) return { kind: "brand-visual", label: "Brand visual", type: "Brand File", mimeType: "image/png" };
  if (text.includes("reference")) return { kind: "reference-image", label: "Reference image", type: "Image", mimeType: "image/png" };
  return { kind: "thumbnail", label: "Thumbnail", type: "Image", mimeType: "image/png" };
}

async function createGrokImageAsset(rest: RestConfig, job: DbRow, imageKind: DbRow, assetUrl: string, prompt: string, externalJobId: string | undefined, response: unknown) {
  const now = new Date().toISOString();
  const filename = safeImageFilename(`${asText(job.job_type, imageKind.label)}-${asText(externalJobId, crypto.randomUUID())}.png`);
  const asset = {
    id: crypto.randomUUID(),
    workspace_id: job.workspace_id,
    project_id: job.project_id,
    scene_id: job.scene_id,
    type: imageKind.type,
    file_url: assetUrl,
    mime_type: imageKind.mimeType,
    filename,
    status: "Needs Review",
    provider: "Grok",
    notes: `${imageKind.label} generated by Grok for queued production job ${job.id}.`,
    tags: ["grok", imageKind.kind, "generated", asText(job.project_id, "workspace")].filter(Boolean),
    duration_seconds: null,
    prompt_id: job.scene_id ?? job.project_id ?? job.id,
    metadata: {
      attachedTo: asText(job.output_payload?.project, "NOX Project"),
      promptUsed: prompt,
      externalJobId,
      providerModel: "grok-imagine-image-quality",
      providerResponse: response,
      sourceJobId: job.id,
      assetKind: imageKind.kind,
      receivedAt: now,
    },
    created_at: now,
    updated_at: now,
  };
  const rows = await postRows(rest, "assets", asset);
  return rows[0] ?? asset;
}

function rowToStudioAsset(row: DbRow) {
  const metadata = asObject(row.metadata);
  return {
    id: asText(row.id),
    workspaceId: asText(row.workspace_id),
    projectId: asText(row.project_id, undefined),
    sceneId: asText(row.scene_id, undefined),
    filename: asText(row.filename),
    type: asText(row.type, "Image"),
    fileUrl: asText(row.file_url, undefined),
    storagePath: asText(metadata.storagePath, undefined),
    mimeType: asText(row.mime_type, undefined),
    attachedTo: asText(metadata.attachedTo, asText(row.filename)),
    status: asText(row.status, "Needs Review"),
    provider: asText(row.provider, "Grok"),
    promptId: asText(row.prompt_id, undefined),
    promptUsed: asText(metadata.promptUsed, undefined),
    externalJobId: asText(metadata.externalJobId, undefined),
    providerModel: asText(metadata.providerModel, undefined),
    providerResponse: asObject(metadata.providerResponse, undefined),
    notes: asText(row.notes),
    tags: asTextArray(row.tags),
    createdAt: asText(row.created_at, new Date().toISOString()),
  };
}

async function processProviderCallback(rest: RestConfig, input: DbRow) {
  const jobId = asText(input.jobId);
  if (!jobId) throw new Error("jobId is required for provider-callback.");

  const job = await fetchRequiredRow(rest, "generation_jobs", `id=eq.${encodeURIComponent(jobId)}&select=*`, "Generation job");
  const sceneRows = job.scene_id ? await fetchRows(rest, "scenes", `id=eq.${encodeURIComponent(job.scene_id)}&select=*`) : [];
  const sceneRow = sceneRows[0];
  const assetInput = asObject(input.asset, {});
  const provider = asText(input.provider, asText(job.provider, "Provider"));
  const externalJobId = asText(input.externalJobId, extractExternalJobId(input.providerResponse));
  const assetSourceUrl = asText(assetInput.url, asText(assetInput.fileUrl));
  const assetStoragePath = asText(assetInput.storagePath);
  const hasAsset = Boolean(assetSourceUrl || assetStoragePath);
  const autoApprove = input.autoApprove === true || input.approve === true || asText(input.reviewStatus).toLowerCase() === "approved";
  const createdAsset = hasAsset ? await createProviderCallbackAsset(rest, job, sceneRow, assetInput, provider, externalJobId, autoApprove) : undefined;
  const callbackStatus = mapProviderCallbackStatus(input, Boolean(createdAsset), autoApprove);
  const detail = providerCallbackMessage(input, provider, callbackStatus, createdAsset);

  if (sceneRow && createdAsset) {
    await patchProviderCallbackScene(rest, sceneRow, createdAsset, provider, externalJobId, autoApprove);
  }

  const nextJob = await settleJob(rest, job, callbackStatus, detail, {
    costEstimate: numberOrNull(input.costEstimate),
    costActual: numberOrNull(input.costActual),
    costCurrency: asText(input.costCurrency, "USD"),
    usageMetadata: asObject(input.usageMetadata, asObject(input.usage, {})),
    errorMessage: callbackStatus === "Failed" ? asText(input.errorMessage, detail) : "",
    outputPayload: buildOutputPayload(job, detail, {
      route: "provider-callback",
      provider,
      externalJobId,
      costActual: numberOrNull(input.costActual),
      costCurrency: asText(input.costCurrency, "USD"),
      usageMetadata: asObject(input.usageMetadata, asObject(input.usage, {})),
      providerStatus: asText(input.status, "completed"),
      assetId: createdAsset?.id,
      assetStoragePath: createdAsset?.metadata?.storagePath,
      assetUrl: createdAsset?.file_url,
      reviewStatus: createdAsset?.status,
      sceneId: job.scene_id,
      response: asObject(input.providerResponse, undefined),
    }),
  });

  return {
    job: rowToGenerationJob(nextJob),
    asset: createdAsset
      ? {
          id: createdAsset.id,
          filename: createdAsset.filename,
          status: createdAsset.status,
          storagePath: createdAsset.metadata?.storagePath,
          fileUrl: createdAsset.file_url,
        }
      : null,
    message: detail,
    source: "provider-callback",
  };
}

async function createProviderCallbackAsset(
  rest: RestConfig,
  job: DbRow,
  sceneRow: DbRow | undefined,
  assetInput: DbRow,
  provider: string,
  externalJobId: string,
  autoApprove: boolean,
) {
  const now = new Date().toISOString();
  const filename = safeCallbackFilename(
    asText(assetInput.filename, `${asText(sceneRow?.title, "provider-video")}-${externalJobId || crypto.randomUUID()}.mp4`),
  );
  const asset = {
    id: crypto.randomUUID(),
    workspace_id: job.workspace_id,
    project_id: job.project_id,
    scene_id: job.scene_id,
    type: "Video",
    file_url: asText(assetInput.url, asText(assetInput.fileUrl)),
    mime_type: asText(assetInput.mimeType, "video/mp4"),
    filename,
    status: autoApprove ? "Approved" : "Needs Review",
    provider: `${provider} / Provider callback`,
    notes: [
      "Generated video received through provider callback.",
      externalJobId ? `External job: ${externalJobId}.` : "",
      asText(assetInput.notes),
    ]
      .filter(Boolean)
      .join(" "),
    tags: ["provider-callback", "scene-video", slugForTag(provider)],
    duration_seconds: numberOrNull(assetInput.durationSeconds) ?? 10,
    prompt_id: job.scene_id,
    metadata: {
      attachedTo: sceneRow ? `${asText(sceneRow.title)} / Scene ${String(asNumber(sceneRow.scene_number, 1)).padStart(2, "0")}` : asText(job.output_payload?.project, "NOX Project"),
      storagePath: asText(assetInput.storagePath),
      storageBucket: asText(assetInput.storageBucket, "nox-videos"),
      promptUsed: asText(assetInput.promptUsed, payloadToText(job.input_payload)),
      externalJobId,
      providerCallback: true,
      width: numberOrNull(assetInput.width),
      height: numberOrNull(assetInput.height),
      receivedAt: now,
    },
    created_at: now,
    updated_at: now,
  };
  const rows = await postRows(rest, "assets", asset);
  return rows[0] ?? asset;
}

async function patchProviderCallbackScene(rest: RestConfig, sceneRow: DbRow, asset: DbRow, provider: string, externalJobId: string, autoApprove: boolean) {
  const metadata = {
    ...asObject(sceneRow.metadata),
    uploadedAsset: asText(asset.filename),
    externalProvider: provider,
    providerCallback: {
      assetId: asset.id,
      externalJobId,
      receivedAt: new Date().toISOString(),
    },
  };
  const patch: DbRow = {
    status: autoApprove ? "Approved" : "Video Uploaded",
    metadata,
    updated_at: new Date().toISOString(),
  };
  if (autoApprove) patch.approved_asset_id = asset.id;
  await patchRows(rest, "scenes", `id=eq.${encodeURIComponent(sceneRow.id)}`, patch);
}

async function resolveProviderSettings(rest: RestConfig, job: DbRow, provider: string) {
  const rows = await fetchRows(rest, "provider_settings", `workspace_id=eq.${encodeURIComponent(job.workspace_id)}&select=*`);
  const routeText = `${provider} ${job.provider} ${job.job_type}`.toLowerCase();
  return (
    rows.find((row) => routeText.includes(asText(row.provider_id).toLowerCase())) ??
    rows.find((row) => routeText.includes(asText(row.name).toLowerCase())) ??
    undefined
  );
}

async function invokeProviderWebhook(providerSettings: DbRow, job: DbRow, sceneRow: DbRow | undefined) {
  const secret = getProviderSecret(providerSettings);
  if (!secret) {
    return {
      ok: false,
      error: `${asText(providerSettings.name, "Provider")} is missing Supabase secret ${asText(providerSettings.secret_name, "NOX_PROVIDER_SECRET")}.`,
    };
  }

  try {
    const response = await fetch(asText(providerSettings.api_endpoint), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
        "X-NOX-Provider": asText(providerSettings.provider_id, asText(providerSettings.name, "provider")),
      },
      body: JSON.stringify({
        source: "nox-studio",
        jobId: job.id,
        workspaceId: job.workspace_id,
        projectId: job.project_id,
        sceneId: job.scene_id,
        provider: asText(providerSettings.name, asText(job.provider)),
        task: asText(job.job_type),
        inputPayload: job.input_payload,
        callback: {
          url: Deno.env.get("NOX_PROVIDER_CALLBACK_URL") ?? "",
          action: "provider-callback",
          tokenHeader: "x-nox-callback-token",
          requiredFields: ["action", "jobId", "status"],
          assetFields: ["url", "storagePath", "filename", "mimeType", "durationSeconds"],
        },
        scene: sceneRow
          ? {
              id: sceneRow.id,
              number: sceneRow.scene_number,
              title: sceneRow.title,
              fullPrompt: sceneRow.full_prompt,
            }
          : undefined,
      }),
    });
    const data = await parseProviderResponse(response);
    if (!response.ok) {
      return {
        ok: false,
        response: data,
        error: `${asText(providerSettings.name, "Provider")} webhook failed with HTTP ${response.status}.`,
      };
    }

    return {
      ok: true,
      response: data,
      externalJobId: extractExternalJobId(data),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : `${asText(providerSettings.name, "Provider")} webhook failed.`,
    };
  }
}

async function updateProviderConnectionStatus(rest: RestConfig, providerSettings: DbRow, status: string) {
  await patchRows(
    rest,
    "provider_settings",
    `workspace_id=eq.${encodeURIComponent(providerSettings.workspace_id)}&provider_id=eq.${encodeURIComponent(providerSettings.provider_id)}`,
    {
      connection_status: status,
      updated_at: new Date().toISOString(),
    },
  );
}

function getProviderSecret(providerSettings: DbRow) {
  const secretName = asText(providerSettings.secret_name);
  return secretName ? Deno.env.get(secretName) ?? "" : "";
}

function isGrokProvider(providerSettings: DbRow | undefined, provider: string) {
  const routeText = `${providerSettings?.provider_id ?? ""} ${providerSettings?.name ?? ""} ${provider}`.toLowerCase();
  return routeText.includes("grok");
}

async function parseProviderResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function extractExternalJobId(value: unknown) {
  const data = asObject(value, {});
  return [data.id, data.jobId, data.externalJobId, data.requestId].find((item) => typeof item === "string" && item.trim()) ?? undefined;
}

function extractGrokAssetUrl(value: unknown) {
  const data = asObject(value, {});
  const firstData = Array.isArray(data.data) ? asObject(data.data[0], {}) : {};
  return asText(data.url, asText(data.assetUrl, asText(firstData.url, asText(firstData.b64_json))));
}

function normalizeGrokAssetUrl(value: string) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  return `data:image/png;base64,${value}`;
}

function mapProviderCallbackStatus(input: DbRow, hasAsset: boolean, autoApprove: boolean) {
  const status = asText(input.status, "completed").toLowerCase();
  if (/fail|error|cancel|reject/.test(status)) return "Failed";
  if (/queue|pending|submitted/.test(status)) return "Queued";
  if (/run|process|progress|generat/.test(status)) return "Running";
  if (/approv/.test(status) || (autoApprove && /complete|success|succeed|finish|ready|done/.test(status))) return "Approved";
  if (/complete|success|succeed|finish|ready|done/.test(status)) return hasAsset ? "Needs Review" : "Completed";
  return hasAsset ? "Needs Review" : "Completed";
}

function providerCallbackMessage(input: DbRow, provider: string, status: string, asset: DbRow | undefined) {
  if (status === "Failed") return `${provider} callback reported failure: ${asText(input.errorMessage, "provider job failed")}.`;
  if (asset) return `${provider} callback attached ${asText(asset.filename, "generated video")} for Scene Card review.`;
  return `${provider} callback updated the provider job to ${status}.`;
}

async function processRenderJob(rest: RestConfig, job: DbRow) {
  const manifest = parseManifest(job.input_payload);
  if (!manifest) {
    const detail = "Render worker awaits an exported NOX Render Engine V1 manifest payload.";
    const nextJob = await settleJob(rest, job, "Needs Review", detail, {
      outputPayload: buildOutputPayload(job, detail, { route: "supabase-edge", type: "render-handoff" }),
    });
    return { job: rowToGenerationJob(nextJob), message: detail, source: "supabase-edge" };
  }

  const readiness = asObject(manifest.readiness);
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers.filter((item) => typeof item === "string") : [];
  const ready = Boolean(readiness.ready) && blockers.length === 0;
  const detail = ready
    ? `FFmpeg render handoff is ready for ${asText(manifest.outputFilename, "final-output.mp4")}.`
    : `Render job needs approved Scene Card videos before export. ${blockers.join(" ")}`.trim();
  const nextJob = await settleJob(rest, job, "Needs Review", detail, {
    outputPayload: buildOutputPayload(job, detail, {
      route: "supabase-edge",
      type: "render-handoff",
      ready,
      blockers,
      outputFilename: manifest.outputFilename,
    }),
    errorMessage: ready ? "" : blockers.join("\n"),
  });

  return {
    job: rowToGenerationJob(nextJob),
    message: ready ? "Render worker handoff prepared." : "Render job needs approved Scene Card videos before export.",
    source: "supabase-edge",
  };
}

async function processReleaseOperationJob(rest: RestConfig, job: DbRow) {
  const plan = parseReleaseOperationPlan(job.input_payload);
  if (!plan) {
    const detail = "Release operation job is missing a NOX Release Operation payload.";
    const nextJob = await settleJob(rest, job, "Failed", detail, {
      outputPayload: buildOutputPayload(job, detail, { route: "release-operation", ready: false }),
    });
    return { job: rowToGenerationJob(nextJob), message: detail, source: "supabase-edge" };
  }

  const blockers = asTextArray(plan.blockers);
  const files = asObject(plan.files);
  const metadata = asObject(plan.metadata);
  const schedule = asObject(plan.schedule);
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const finalVideo = asObject(files.finalVideo, undefined);
  const ready = Boolean(plan.ready) && blockers.length === 0 && Boolean(finalVideo);
  const nextReleaseStatus = ready ? "Scheduled" : "NOX Films Draft";
  const platform = asText(plan.platform, "Platform");
  const uploadId = ready ? `nox-${slugForTag(platform)}-${job.id}` : "";

  if (job.project_id) {
    await patchRows(rest, "projects", `id=eq.${encodeURIComponent(job.project_id)}`, {
      release_status: nextReleaseStatus,
      updated_at: new Date().toISOString(),
    });
    await patchRows(rest, "publish_kits", `project_id=eq.${encodeURIComponent(job.project_id)}`, {
      release_status: nextReleaseStatus,
      updated_at: new Date().toISOString(),
    });
  }

  const detail = ready
    ? `${platform} release operation is ready to upload or schedule.`
    : `${platform} release operation needs review: ${blockers.join(", ") || "final MP4 or release metadata missing"}.`;
  const nextJob = await settleJob(rest, job, ready ? "Completed" : "Needs Review", detail, {
    costEstimate: 0,
    errorMessage: ready ? "" : blockers.join("\n"),
    usageMetadata: {
      ...asObject(job.usage_metadata),
      route: "release-operation",
      platform,
      blockerCount: blockers.length,
      uploadMode: "export-package",
      uploadId,
      scheduledFor: asText(schedule.recommendedWindow),
      finalUrl: "",
    },
    outputPayload: buildOutputPayload(job, detail, {
      route: "release-operation",
      platform,
      ready,
      blockers,
      releaseStatus: nextReleaseStatus,
      uploadMode: "export-package",
      uploadId,
      finalUrl: "",
      finalVideo,
      metadata,
      schedule,
      checklist: steps,
      nextAction: ready
        ? "Upload or schedule the final package on the target platform."
        : "Resolve readiness blockers, then queue the release operation again.",
    }),
  });

  return { job: rowToGenerationJob(nextJob), message: detail, source: "supabase-edge" };
}

async function settleJob(
  rest: RestConfig,
  job: DbRow,
  status: string,
  detail: string,
  options: { costEstimate?: number | null; costActual?: number | null; costCurrency?: string; usageMetadata?: DbRow; outputPayload?: DbRow; errorMessage?: string } = {},
) {
  return updateJob(rest, job, {
    status,
    output_payload: options.outputPayload ?? buildOutputPayload(job, detail, { route: "supabase-edge" }),
    error_message: status === "Failed" ? detail : options.errorMessage ?? "",
    cost_estimate: options.costEstimate,
    cost_actual: options.costActual ?? (options.costActual === null ? null : job.cost_actual),
    cost_currency: options.costCurrency ?? job.cost_currency ?? "USD",
    usage_metadata: options.usageMetadata ?? job.usage_metadata ?? {},
    completed_at: terminalStatuses.has(status) ? new Date().toISOString() : null,
    locked_at: null,
    locked_by: null,
    run_after: nextRunAfter(job, status),
    logs: appendLog(job.logs, `${status}: ${detail}`),
  });
}

async function updateJob(rest: RestConfig, job: DbRow, patch: DbRow) {
  const rows = await patchRows(rest, "generation_jobs", `id=eq.${encodeURIComponent(job.id)}`, patch);
  return rows[0] ?? { ...job, ...patch };
}

async function fetchRequiredRow(rest: RestConfig, table: string, query: string, label: string) {
  const rows = await fetchRows(rest, table, query);
  if (!rows[0]) throw new Error(`${label} was not found or is not accessible.`);
  return rows[0];
}

async function fetchRows(rest: RestConfig, table: string, query: string) {
  const response = await fetch(`${rest.url}/rest/v1/${table}?${query}`, {
    headers: restHeaders(rest),
  });
  if (!response.ok) throw new Error(await restError(response, `Read failed for ${table}.`));
  return (await response.json()) as DbRow[];
}

async function patchRows(rest: RestConfig, table: string, filter: string, body: DbRow) {
  const response = await fetch(`${rest.url}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: {
      ...restHeaders(rest),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await restError(response, `Update failed for ${table}.`));
  return (await response.json()) as DbRow[];
}

async function postRows(rest: RestConfig, table: string, body: DbRow | DbRow[]) {
  const response = await fetch(`${rest.url}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      ...restHeaders(rest),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await restError(response, `Insert failed for ${table}.`));
  return (await response.json()) as DbRow[];
}

async function rpcRows(rest: RestConfig, functionName: string, body: DbRow) {
  const response = await fetch(`${rest.url}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      ...restHeaders(rest),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await restError(response, `RPC failed for ${functionName}.`));
  return (await response.json()) as DbRow[];
}

function restHeaders(rest: RestConfig) {
  return {
    apikey: rest.anonKey,
    authorization: rest.authorization,
  };
}

async function restError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return asText(body.message, asText(body.error, fallback));
  } catch {
    return fallback;
  }
}

function getRestConfig(authorization: string): RestConfig {
  return {
    url: getRequiredEnv("SUPABASE_URL", true),
    anonKey: getRequiredEnv("SUPABASE_ANON_KEY", true),
    authorization,
  };
}

function getServiceRestConfig(): RestConfig {
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY", true);
  return {
    url: getRequiredEnv("SUPABASE_URL", true),
    anonKey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
  };
}

function validateProviderCallbackToken(request: Request, input: DbRow) {
  const expected = getRequiredEnv("NOX_PROVIDER_CALLBACK_TOKEN", true);
  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = authorization.match(/^bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const provided = request.headers.get("x-nox-callback-token") ?? bearerToken ?? asText(input.callbackToken);
  if (!provided || provided !== expected) {
    throw new Error("Provider callback token is invalid.");
  }
}

function getRequiredEnv(key: string, required: boolean) {
  const value = Deno.env.get(key);
  if (!value && required) throw new Error(`${key} is required for process-generation-job.`);
  return value ?? "";
}

function isRenderJob(job: DbRow) {
  return renderTaskPattern.test(`${asText(job.job_type)} ${asText(job.provider)}`);
}

function isScenePromptJob(job: DbRow) {
  return Boolean(job.scene_id && scenePromptTaskPattern.test(asText(job.job_type)));
}

function isContinuityJob(job: DbRow) {
  return Boolean(job.scene_id && continuityTaskPattern.test(`${asText(job.job_type)} ${asText(job.provider)}`));
}

function isVideoProviderJob(job: DbRow) {
  return videoTaskPattern.test(`${asText(job.job_type)} ${asText(job.provider)}`);
}

function isImageGenerationJob(job: DbRow) {
  return imageTaskPattern.test(`${asText(job.job_type)} ${payloadToText(job.input_payload)} ${asText(job.provider)}`);
}

function isReleaseOperationJob(job: DbRow) {
  return releaseTaskPattern.test(`${asText(job.job_type)} ${asText(job.provider)}`) || parseReleaseOperationPlan(job.input_payload)?.operation === "NOX Release Operation";
}

function resolveProviderName(job: DbRow, sceneRow: DbRow, project: DbRow) {
  const provider = asText(job.provider, "");
  if (provider && !/manual mode/i.test(provider)) return provider;
  const metadata = asObject(sceneRow.metadata);
  return asText(metadata.externalProvider, asText(metadata.promptProvider, asText(project.ai_target, "Universal Prompt")));
}

function rowToSceneCard(row: DbRow, beatRows: DbRow[]) {
  const metadata = asObject(row.metadata);
  return {
    id: asText(row.id),
    projectId: asText(row.project_id),
    number: asNumber(row.scene_number, 1),
    title: asText(row.title),
    purpose: asText(row.purpose),
    durationSeconds: asNumber(row.duration_seconds, 10),
    output: asText(row.output, "One generated video"),
    format: asText(row.format, "9:16 vertical cinematic"),
    location: asText(row.location),
    characters: asTextArray(row.characters),
    mood: asText(row.mood),
    visualStyle: asText(row.visual_style),
    summary: asText(row.summary),
    beats: beatRows.map(rowToBeat),
    dialogue: asText(row.dialogue),
    audio: asText(row.audio_notes),
    fullPrompt: asText(row.full_prompt),
    promptProvider: asText(metadata.promptProvider, undefined),
    promptCopiedAt: asText(metadata.promptCopiedAt, undefined),
    externalProvider: asText(metadata.externalProvider, undefined),
    negativePrompt: asText(row.negative_prompt),
    continuityRules: asTextArray(row.continuity_rules),
    status: asText(row.status, "Draft"),
    uploadedAsset: asText(metadata.uploadedAsset, undefined),
    approvedAssetId: asText(row.approved_asset_id, undefined),
  };
}

function rowToBeat(row: DbRow) {
  return {
    id: asText(row.id),
    range: `${asNumber(row.start_second, 0)}-${asNumber(row.end_second, 10)}s`,
    title: asText(row.title),
    description: asText(row.description),
    camera: asText(row.camera_direction),
    audio: asText(row.audio),
  };
}

function rowToContinuityCharacter(row: DbRow) {
  return {
    id: asText(row.id),
    name: asText(row.name),
    promptIdentity: asText(row.prompt_identity),
    wardrobeRules: asTextArray(row.wardrobe_rules),
    referenceImageUrl: asText(row.reference_image_url),
  };
}

function rowToContinuityWorld(row: DbRow) {
  return {
    id: asText(row.id),
    name: asText(row.name),
    description: asText(row.description),
    locations: asTextArray(row.locations),
    visualRules: asTextArray(row.visual_rules),
    factions: asTextArray(row.factions),
    timeline: asTextArray(row.timeline),
  };
}

function rowToContinuityLocation(row: DbRow) {
  return {
    id: asText(row.id),
    worldId: asText(row.world_id),
    name: asText(row.name),
    description: asText(row.description),
    visualRules: asTextArray(row.visual_rules),
    timelineNotes: asTextArray(row.timeline_notes),
  };
}

function rowToContinuityFaction(row: DbRow) {
  return {
    id: asText(row.id),
    worldId: asText(row.world_id),
    name: asText(row.name),
    description: asText(row.description),
    visualRules: asTextArray(row.visual_rules),
    negativeRules: asTextArray(row.negative_rules),
    timelineNotes: asTextArray(row.timeline_notes),
  };
}

function rowToGenerationJob(row: DbRow) {
  const outputPayload = asObject(row.output_payload);
  const providerResponse = asObject(outputPayload.response, asObject(outputPayload.providerResponse, undefined));
  return {
    id: asText(row.id),
    workspaceId: asText(row.workspace_id),
    projectId: asText(row.project_id, undefined),
    sceneId: asText(row.scene_id, undefined),
    task: asText(row.job_type, "Generation job"),
    project: asText(row.output_payload?.project, "NOX Project"),
    provider: asText(row.provider, "Manual Mode"),
    status: asText(row.status, "Queued"),
    cost: formatJobCost(row),
    costActual: row.cost_actual === null || row.cost_actual === undefined ? undefined : Number(row.cost_actual),
    costCurrency: asText(row.cost_currency, undefined),
    usageMetadata: asObject(row.usage_metadata, {}),
    providerJobId: asText(outputPayload.externalJobId, asText(outputPayload.providerJobId, undefined)),
    providerResponse,
    inputPayload: payloadToText(row.input_payload),
    outputPayload: row.output_payload ? payloadToText(row.output_payload) : undefined,
    errorMessage: asText(row.error_message, undefined),
    retryCount: asNumber(row.retry_count, 0),
    maxRetries: asNumber(row.max_retries, 2),
    logs: asTextArray(row.logs),
    priority: asNumber(row.priority, 0),
    runAfter: asText(row.run_after, undefined),
    lockedAt: asText(row.locked_at, undefined),
    lockedBy: asText(row.locked_by, undefined),
    startedAt: asText(row.started_at, undefined),
    completedAt: asText(row.completed_at, undefined),
    createdAt: asText(row.created_at),
  };
}

function runContinuityReview(scene: DbRow, characters: DbRow[], worlds: DbRow[], locations: DbRow[], factions: DbRow[]) {
  const haystack = [
    scene.title,
    scene.location,
    scene.characters?.join(" "),
    scene.summary,
    scene.beats?.map((beat: DbRow) => [beat.title, beat.description, beat.camera, beat.audio].join(" ")).join(" "),
    scene.visualStyle,
    scene.dialogue,
    scene.audio,
    scene.fullPrompt,
    scene.negativePrompt,
    scene.continuityRules?.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const issues: DbRow[] = [];
  const savedCharacters = uniqueByKey(characters, (character) => asText(character.name).toLowerCase());
  const savedWorlds = uniqueByKey(worlds, (world) => asText(world.name).toLowerCase());
  const savedLocations = uniqueByKey(locations, (location) => asText(location.name).toLowerCase());
  const savedFactions = uniqueByKey(factions, (faction) => asText(faction.name).toLowerCase());
  const matchedCharacters = savedCharacters.filter((character) => {
    const name = asText(character.name).toLowerCase();
    return scene.characters?.some((sceneCharacter: string) => sceneCharacter.toLowerCase() === name) || (name && haystack.includes(name));
  });
  const matchedWorlds = savedWorlds.filter((world) => {
    const worldName = asText(world.name).toLowerCase();
    const worldAlias = worldName.replace(/\b\d{3,4}\b/g, "").replace(/\s+/g, " ").trim();
    const worldLocations = asTextArray(world.locations);
    return haystack.includes(worldName) || (worldAlias.length >= 4 && haystack.includes(worldAlias)) || worldLocations.some((location) => haystack.includes(location.toLowerCase()));
  });
  const matchedLocations = savedLocations.filter((location) =>
    matchesContinuityRecord(haystack, asText(location.name), [asText(location.description), ...asTextArray(location.visualRules), ...asTextArray(location.timelineNotes)]),
  );
  const matchedFactions = savedFactions.filter((faction) =>
    matchesContinuityRecord(haystack, asText(faction.name), [asText(faction.description), ...asTextArray(faction.visualRules), ...asTextArray(faction.timelineNotes)]),
  );

  for (const characterName of Array.from(new Set(asTextArray(scene.characters)))) {
    const character = savedCharacters.find((item) => asText(item.name).toLowerCase() === characterName.toLowerCase());
    if (!character) {
      issues.push(makeContinuityIssue("Missing", "Character", characterName, "No saved Character Vault profile is linked to this Scene Card."));
    }
  }

  for (const character of matchedCharacters) {
    if (!asText(character.promptIdentity)) {
      issues.push(makeContinuityIssue("Missing", "Character", asText(character.name), "Character prompt identity is empty."));
    }
    if (!asTextArray(character.wardrobeRules).length) {
      issues.push(makeContinuityIssue("Warning", "Character", asText(character.name), "Wardrobe rules are not defined."));
    }
    if (!asText(character.referenceImageUrl)) {
      issues.push(makeContinuityIssue("Warning", "Character", asText(character.name), "Face/reference image is not linked yet."));
    }
    if (!asText(scene.fullPrompt).toLowerCase().includes(asText(character.name).toLowerCase())) {
      issues.push(makeContinuityIssue("Warning", "Character", asText(character.name), "Generated prompt does not explicitly name this saved character."));
    }
  }

  if (!matchedWorlds.length) {
    issues.push(makeContinuityIssue("Missing", "World", asText(scene.location, "Scene location"), "No World Bible entry or saved location matched this Scene Card."));
  }

  for (const world of matchedWorlds) {
    const worldLocations = [
      ...asTextArray(world.locations),
      ...savedLocations.filter((location) => location.worldId === world.id).map((location) => asText(location.name)),
    ];
    const worldFactions = [
      ...asTextArray(world.factions),
      ...savedFactions.filter((faction) => faction.worldId === world.id).map((faction) => asText(faction.name)),
    ];
    const timeline = asTextArray(world.timeline);
    if (!worldLocations.length) {
      issues.push(makeContinuityIssue("Missing", "Location", asText(world.name), "World Bible has no saved locations."));
    } else if (
      !matchedLocations.some((location) => location.worldId === world.id) &&
      !worldLocations.some((location) => matchesContinuityRecord(haystack, location))
    ) {
      issues.push(makeContinuityIssue("Warning", "Location", asText(world.name), "Scene does not match a saved location in this world."));
    }
    if (!asTextArray(world.visualRules).length) {
      issues.push(makeContinuityIssue("Missing", "World", asText(world.name), "World visual rules are empty."));
    }
    if (!worldFactions.length) {
      issues.push(makeContinuityIssue("Warning", "Faction", asText(world.name), "No factions are saved for this world."));
    }
    if (!timeline.length) {
      issues.push(makeContinuityIssue("Warning", "Timeline", asText(world.name), "World timeline anchors are not defined."));
    }
  }

  if (!issues.length) {
    issues.push(makeContinuityIssue("Pass", "World", "Continuity", "Scene matches saved character and world rules."));
  }

  const uniqueIssues = uniqueByKey(issues, (issue) => asText(issue.id));
  const blockingIssues = uniqueIssues.filter((issue) => issue.severity === "Missing").length;
  const warningIssues = uniqueIssues.filter((issue) => issue.severity === "Warning").length;
  return {
    sceneId: scene.id,
    status: blockingIssues ? "Needs Review" : "Pass",
    summary: blockingIssues
      ? `${blockingIssues} missing continuity link${blockingIssues === 1 ? "" : "s"} and ${warningIssues} warning${warningIssues === 1 ? "" : "s"}.`
      : warningIssues
        ? `${warningIssues} continuity warning${warningIssues === 1 ? "" : "s"}; no missing links.`
        : "All saved continuity rules match this Scene Card.",
    matchedCharacters: matchedCharacters.map((character) => asText(character.name)),
    matchedWorlds: matchedWorlds.map((world) => asText(world.name)),
    matchedLocations: matchedLocations.map((location) => asText(location.name)),
    matchedFactions: matchedFactions.map((faction) => asText(faction.name)),
    issues: uniqueIssues,
  };
}

function uniqueByKey(values: DbRow[], getKey: (value: DbRow) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = getKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const continuityStopwords = new Set([
  "and",
  "below",
  "city",
  "cyberglass",
  "during",
  "from",
  "into",
  "nox",
  "scene",
  "signal",
  "that",
  "the",
  "through",
  "where",
  "with",
  "world",
]);

function matchesContinuityRecord(haystack: string, name: string, supportingText: string[] = []) {
  const normalizedHaystack = normalizeContinuityText(haystack);
  const normalizedName = normalizeContinuityText(name);
  if (!normalizedName) return false;
  if (normalizedHaystack.includes(normalizedName)) return true;

  const nameTerms = getContinuityTerms(normalizedName);
  const matchedNameTerms = nameTerms.filter((term) => normalizedHaystack.includes(term));
  if (matchedNameTerms.some((term) => term.length >= 7)) return true;
  if (nameTerms.length >= 2 && matchedNameTerms.length >= 2) return true;

  return supportingText
    .map(normalizeContinuityText)
    .filter((phrase) => phrase.split(" ").length >= 4)
    .some((phrase) => normalizedHaystack.includes(phrase));
}

function normalizeContinuityText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function getContinuityTerms(value: string) {
  return Array.from(new Set(value.split(" ").filter((term) => term.length >= 4 && !continuityStopwords.has(term))));
}

function makeContinuityIssue(severity: string, scope: string, label: string, message: string, rule = "") {
  return {
    id: `${scope}-${label}-${message}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    severity,
    scope,
    label,
    message,
    rule,
  };
}

function buildOutputPayload(job: DbRow, text: string, extra: DbRow = {}) {
  return {
    ...asObject(job.output_payload),
    text,
    project: asText(job.output_payload?.project, "NOX Project"),
    ...extra,
  };
}

function parseManifest(value: unknown) {
  const text = payloadToText(value);
  try {
    const parsed = JSON.parse(text);
    if (parsed?.engine === "NOX Render Engine V1") return parsed;
  } catch {
    return undefined;
  }
  return undefined;
}

function parseReleaseOperationPlan(value: unknown) {
  const text = payloadToText(value);
  try {
    const parsed = JSON.parse(text);
    if (parsed?.operation === "NOX Release Operation") return parsed as DbRow;
  } catch {
    return undefined;
  }
  return undefined;
}

function payloadToText(value: unknown) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const payload = value as DbRow;
  if (typeof payload.text === "string") return payload.text;
  if (payload.manifest) return JSON.stringify(payload.manifest);
  return JSON.stringify(payload);
}

function appendLog(value: unknown, message: string) {
  return [...asTextArray(value), `${new Date().toISOString()} - ${message}`].slice(-12);
}

function nextRunAfter(job: DbRow, status: string) {
  if (status !== "Failed") return job.run_after ?? new Date().toISOString();
  const retryCount = asNumber(job.retry_count, 0);
  const maxRetries = asNumber(job.max_retries, 2);
  if (retryCount >= maxRetries) return job.run_after ?? new Date().toISOString();
  const delaySeconds = Math.min(300, 30 * 2 ** retryCount);
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

function asObject(value: unknown, fallback: any = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as DbRow) : fallback;
}

function asText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asTextArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}

function asNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatJobCost(row: DbRow) {
  if (row.cost_actual !== null && row.cost_actual !== undefined) {
    const currency = asText(row.cost_currency, "USD");
    return `${currency} ${Number(row.cost_actual).toFixed(2)} actual`;
  }
  if (row.cost_estimate !== null && row.cost_estimate !== undefined) return `$${Number(row.cost_estimate).toFixed(2)} est`;
  return "External";
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeCallbackFilename(filename: string) {
  const value = filename.trim() || "provider-video.mp4";
  const extension = value.toLowerCase().endsWith(".mp4") ? ".mp4" : value.includes(".") ? `.${value.split(".").pop()}` : ".mp4";
  const stem = value
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${stem || "provider-video"}${extension}`;
}

function safeImageFilename(filename: string) {
  const value = filename.trim() || "grok-image.png";
  const stem = value
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${stem || "grok-image"}.png`;
}

function slugForTag(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "provider";
}
