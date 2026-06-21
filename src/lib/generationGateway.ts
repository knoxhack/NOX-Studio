import type { GenerationJob, ProductionPackage, SceneCard, StudioAsset } from "../types";
import {
  createProductionPackage,
  polishScenePrompt,
  regenerateScenePrompt,
  type PackageInput,
  type PromptContext,
} from "./noxCore";
import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient";
import { isDesktop, desktopGrok } from "./desktopBridge";
import { getGrokKeyStatus } from "./providerSecrets";

type GatewayMode = "supabase" | "local";

export type GatewayResult<T> = {
  data: T;
  mode: GatewayMode;
  error?: string;
};

type ScenePromptInput = {
  scene: SceneCard;
  provider: string;
  workspaceId?: string;
  context?: PromptContext;
  action: "regenerate" | "polish";
};

type RemoteGenerationJobInput = {
  jobId: string;
  context?: PromptContext;
};

type RemoteGenerationJobPayload = {
  job: GenerationJob;
  scene?: SceneCard;
  asset?: StudioAsset;
  message?: string;
  source?: string;
};

async function invokeFunction<T>(name: string, body: Record<string, unknown>) {
  const supabase = await getSupabaseClient();
  if (!supabase) return { error: "Supabase is not configured." };

  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) return { error: error.message || `Function ${name} failed.` };
  return { data };
}

export async function generateConceptPackage(input: PackageInput): Promise<GatewayResult<ProductionPackage>> {
  if (isDesktop()) {
    const fallback = createProductionPackage(input);
    const grokStatus = await getGrokKeyStatus(input.workspaceId ?? "");
    if (!grokStatus.configured) {
      return { data: fallback, mode: "local" };
    }

    try {
      const prompt = buildConceptPrompt(input, fallback);
      const result = await desktopGrok.generateStructuredText({ prompt, schema: conceptPackageSchema() });
      const merged = mergeConceptResult(fallback, result as Partial<ProductionPackage>);
      return { data: merged, mode: "local" };
    } catch (err) {
      return {
        data: fallback,
        mode: "local",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (isSupabaseConfigured) {
    const result = await invokeFunction<{ productionPackage: ProductionPackage }>("generate-concept", { ...input });
    if (result.data?.productionPackage) {
      return { data: result.data.productionPackage, mode: "supabase" };
    }

    return {
      data: createProductionPackage(input),
      mode: "local",
      error: result.error ?? "Supabase generation function returned no production package.",
    };
  }

  return { data: createProductionPackage(input), mode: "local" };
}

export async function generateScenePrompt(input: ScenePromptInput): Promise<GatewayResult<SceneCard>> {
  if (isDesktop()) {
    const fallbackScene =
      input.action === "polish"
        ? polishScenePrompt(input.scene, input.provider, input.context)
        : regenerateScenePrompt(input.scene, input.provider, input.context);
    const grokStatus = await getGrokKeyStatus(input.workspaceId ?? "");
    if (!grokStatus.configured) {
      return { data: fallbackScene, mode: "local" };
    }

    try {
      const prompt = buildScenePromptPrompt(input);
      const result = await desktopGrok.generateStructuredText({ prompt, schema: scenePromptSchema() });
      const merged = { ...fallbackScene, ...(result as Partial<SceneCard>) };
      return { data: merged, mode: "local" };
    } catch (err) {
      return {
        data: fallbackScene,
        mode: "local",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (isSupabaseConfigured) {
    const result = await invokeFunction<{ scene: SceneCard }>("generate-scene-prompt", { ...input });
    if (result.data?.scene) {
      return { data: result.data.scene, mode: "supabase" };
    }

    const fallbackScene =
      input.action === "polish"
        ? polishScenePrompt(input.scene, input.provider, input.context)
        : regenerateScenePrompt(input.scene, input.provider, input.context);

    return {
      data: fallbackScene,
      mode: "local",
      error: result.error ?? "Supabase prompt function returned no scene.",
    };
  }

  return {
    data:
      input.action === "polish"
        ? polishScenePrompt(input.scene, input.provider, input.context)
        : regenerateScenePrompt(input.scene, input.provider, input.context),
    mode: "local",
  };
}

export async function runRemoteGenerationJob(input: RemoteGenerationJobInput): Promise<GatewayResult<RemoteGenerationJobPayload | undefined>> {
  if (!isSupabaseConfigured) {
    return { data: undefined, mode: "local", error: "Supabase is not configured." };
  }

  const result = await invokeFunction<RemoteGenerationJobPayload>("process-generation-job", {
    jobId: input.jobId,
    context: input.context,
  });
  if (result.data?.job) {
    return { data: result.data, mode: "supabase" };
  }

  return {
    data: undefined,
    mode: "local",
    error: result.error ?? "Supabase job processor returned no generation job.",
  };
}


function buildConceptPrompt(input: PackageInput, fallback: ProductionPackage): string {
  const requestedSceneCount = fallback.scenes.length;
  return `Create a NOX Studio production package as JSON.

User input:
- Title: ${input.title}
- Idea: ${input.idea}
- Type: ${input.type}
- Format: ${input.format}
- Length: ${input.length}
- Genre: ${input.genre}
- Tone: ${input.tone}
- Target: ${input.target}
- Language prompts: ${JSON.stringify(input.language)}

Return a JSON object matching the provided schema. Fill every field with creative, coherent content.
Return exactly ${requestedSceneCount} scenes. Each scene must represent a different story moment with a unique title, purpose, location, beat descriptions, dialogue, audio plan, negative prompt, and final hook.
The project should have a logline, synopsis, and scene cards that fit the requested runtime. Characters, world, locations, and factions should be consistent with the genre and tone.`;
}

function conceptPackageSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      project: {
        type: "object",
        properties: {
          title: { type: "string" },
          type: { type: "string" },
          format: { type: "string" },
          runtime: { type: "string" },
          genre: { type: "string" },
          tone: { type: "string" },
          world: { type: "string" },
          mainCharacters: { type: "array", items: { type: "string" } },
          idea: { type: "string" },
          aiTarget: { type: "string" },
          logline: { type: "string" },
          synopsis: { type: "string" },
          posterTone: { type: "string", enum: ["cyan", "purple", "magenta", "green", "gold"] },
        },
        required: ["title", "logline", "synopsis"],
      },
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            number: { type: "number" },
            title: { type: "string" },
            purpose: { type: "string" },
            durationSeconds: { type: "number" },
            output: { type: "string" },
            format: { type: "string" },
            location: { type: "string" },
            characters: { type: "array", items: { type: "string" } },
            mood: { type: "string" },
            visualStyle: { type: "string" },
            summary: { type: "string" },
            beats: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  range: { type: "string" },
                  title: { type: "string" },
                  description: { type: "string" },
                  camera: { type: "string" },
                  audio: { type: "string" },
                  dialogue: { type: "string" },
                },
                required: ["range", "title", "description"],
              },
            },
            dialogue: { type: "string" },
            audio: { type: "string" },
            fullPrompt: { type: "string" },
            negativePrompt: { type: "string" },
            continuityRules: { type: "array", items: { type: "string" } },
          },
          required: ["number", "title", "fullPrompt"],
        },
      },
      characters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            alias: { type: "string" },
            role: { type: "string" },
            personality: { type: "string" },
            backstory: { type: "string" },
            voice: { type: "string" },
            accent: { type: "string" },
            wardrobeRules: { type: "array", items: { type: "string" } },
            visualIdentity: { type: "string" },
            promptIdentity: { type: "string" },
            negativeRules: { type: "array", items: { type: "string" } },
          },
          required: ["name", "role", "promptIdentity"],
        },
      },
      worlds: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            tone: { type: "string" },
            locations: { type: "array", items: { type: "string" } },
            visualRules: { type: "array", items: { type: "string" } },
            factions: { type: "array", items: { type: "string" } },
          },
          required: ["name", "description"],
        },
      },
      publishKit: {
        type: "object",
        properties: {
          tiktokTitle: { type: "string" },
          caption: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
          hookLine: { type: "string" },
          pinnedComment: { type: "string" },
          youtubeTitle: { type: "string" },
          description: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          thumbnailPrompt: { type: "string" },
          posterPrompt: { type: "string" },
        },
      },
    },
    required: ["project", "scenes"],
  };
}

function mergeConceptResult(fallback: ProductionPackage, generated: Partial<ProductionPackage>): ProductionPackage {
  const generatedProject = generated.project ?? {};
  const project: ProductionPackage["project"] = {
    ...fallback.project,
    ...generatedProject,
    id: fallback.project.id,
    workspaceId: fallback.project.workspaceId,
    status: fallback.project.status,
    releaseStatus: fallback.project.releaseStatus,
    updatedAt: fallback.project.updatedAt,
  };

  const scenes = repairWeakGeneratedScenes(generated, fallback);

  return {
    project,
    scenes,
    characters: (generated.characters ?? fallback.characters).map((character, index) => ({
      ...(fallback.characters[index] || {}),
      ...character,
      id: fallback.characters[index]?.id || character.id,
      workspaceId: fallback.characters[index]?.workspaceId || character.workspaceId,
    })),
    worlds: (generated.worlds ?? fallback.worlds).map((world, index) => ({
      ...(fallback.worlds[index] || {}),
      ...world,
      id: fallback.worlds[index]?.id || world.id,
      workspaceId: fallback.worlds[index]?.workspaceId || world.workspaceId,
    })),
    locations: fallback.locations,
    factions: fallback.factions,
    publishKit: { ...fallback.publishKit, ...(generated.publishKit || {}) },
    timelineItems: fallback.timelineItems,
    generationJobs: fallback.generationJobs,
  };
}

export function validateProductionPackage(productionPackage: ProductionPackage, requestedSceneCount: number) {
  const reasons: string[] = [];
  const scenes = productionPackage.scenes ?? [];
  if (scenes.length !== requestedSceneCount) reasons.push(`Expected ${requestedSceneCount} scenes, received ${scenes.length}.`);

  const seenTitles = new Set<string>();
  const seenSummaries = new Set<string>();
  const seenBeatDescriptions = new Set<string>();
  const locationCounts = new Map<string, number>();

  scenes.forEach((scene, index) => {
    const label = `Scene ${String(index + 1).padStart(2, "0")}`;
    if (!scene.fullPrompt?.trim()) reasons.push(`${label} is missing a full prompt.`);
    if (!scene.dialogue?.trim()) reasons.push(`${label} is missing dialogue.`);
    if (!scene.audio?.trim()) reasons.push(`${label} is missing audio.`);
    if (!scene.beats?.length) reasons.push(`${label} is missing timed beats.`);
    if (scene.beats?.length && !scene.beats.some((beat) => /hook|reveal|turn|answer|signal|final|next/i.test(`${beat.title} ${beat.description}`))) {
      reasons.push(`${label} is missing a final hook.`);
    }

    addDuplicateReason(scene.title, seenTitles, `${label} duplicates a title.`, reasons);
    addDuplicateReason(scene.summary, seenSummaries, `${label} duplicates a summary.`, reasons);
    scene.beats?.forEach((beat) => addDuplicateReason(beat.description, seenBeatDescriptions, `${label} duplicates a beat description.`, reasons));

    const locationKey = normalizeSceneText(scene.location);
    if (locationKey) locationCounts.set(locationKey, (locationCounts.get(locationKey) ?? 0) + 1);
  });

  const repeatedLocationCount = [...locationCounts.values()].filter((count) => count > 1).reduce((total, count) => total + count, 0);
  if (scenes.length > 2 && repeatedLocationCount >= Math.ceil(scenes.length * 0.7)) {
    reasons.push("Most scenes repeat the same location.");
  }

  return { valid: reasons.length === 0, reasons };
}

function repairWeakGeneratedScenes(generated: Partial<ProductionPackage>, fallback: ProductionPackage): SceneCard[] {
  const generatedScenes = Array.isArray(generated.scenes) ? generated.scenes : [];
  const seen = createSceneSignatureTracker();

  return fallback.scenes.map((fallbackScene, index) => {
    const candidate = generatedScenes[index] as Partial<SceneCard> | undefined;
    if (!candidate) {
      rememberSceneSignature(fallbackScene, seen);
      return fallbackScene;
    }

    const merged: SceneCard = {
      ...fallbackScene,
      ...candidate,
      id: fallbackScene.id,
      projectId: fallbackScene.projectId,
      number: fallbackScene.number,
      status: fallbackScene.status,
      fullPrompt: candidate.fullPrompt || fallbackScene.fullPrompt,
      beats: candidate.beats?.length ? candidate.beats.map((beat, beatIndex) => ({ ...fallbackScene.beats[beatIndex], ...beat })) : fallbackScene.beats,
    };

    if (isWeakGeneratedScene(merged, seen)) {
      rememberSceneSignature(fallbackScene, seen);
      return fallbackScene;
    }

    rememberSceneSignature(merged, seen);
    return merged;
  });
}

function isWeakGeneratedScene(scene: SceneCard, seen: ReturnType<typeof createSceneSignatureTracker>) {
  if (!scene.title?.trim() || !scene.summary?.trim() || !scene.purpose?.trim() || !scene.fullPrompt?.trim()) return true;
  if (!scene.dialogue?.trim() || !scene.audio?.trim() || !scene.negativePrompt?.trim()) return true;
  if (!scene.beats?.length || scene.beats.some((beat) => !beat.description?.trim())) return true;

  const title = normalizeSceneText(scene.title);
  const summary = normalizeSceneText(scene.summary);
  const purpose = normalizeSceneText(scene.purpose);
  const beatSignature = normalizeSceneText(scene.beats.map((beat) => beat.description).join(" "));
  const location = normalizeSceneText(scene.location);

  if (seen.titles.has(title) || seen.summaries.has(summary) || seen.purposes.has(purpose) || seen.beats.has(beatSignature)) return true;
  if (location && seen.locations.get(location) && (seen.locations.get(location) ?? 0) >= 2) return true;
  if (/scene\s+\d+\s+advances/i.test(`${scene.summary} ${scene.beats.map((beat) => beat.description).join(" ")}`)) return true;
  return false;
}

function createSceneSignatureTracker() {
  return {
    titles: new Set<string>(),
    summaries: new Set<string>(),
    purposes: new Set<string>(),
    beats: new Set<string>(),
    locations: new Map<string, number>(),
  };
}

function rememberSceneSignature(scene: SceneCard, seen: ReturnType<typeof createSceneSignatureTracker>) {
  const title = normalizeSceneText(scene.title);
  const summary = normalizeSceneText(scene.summary);
  const purpose = normalizeSceneText(scene.purpose);
  const beatSignature = normalizeSceneText(scene.beats.map((beat) => beat.description).join(" "));
  const location = normalizeSceneText(scene.location);
  if (title) seen.titles.add(title);
  if (summary) seen.summaries.add(summary);
  if (purpose) seen.purposes.add(purpose);
  if (beatSignature) seen.beats.add(beatSignature);
  if (location) seen.locations.set(location, (seen.locations.get(location) ?? 0) + 1);
}

function addDuplicateReason(value: string | undefined, seen: Set<string>, reason: string, reasons: string[]) {
  const key = normalizeSceneText(value);
  if (!key) return;
  if (seen.has(key)) reasons.push(reason);
  seen.add(key);
}

function normalizeSceneText(value: string | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(scene|shot|card|the|a|an|and|or)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildScenePromptPrompt(input: ScenePromptInput): string {
  const scene = input.scene;
  return `Polish or regenerate the full prompt for this NOX Studio scene card.

Action: ${input.action}
Provider target: ${input.provider}
Scene number: ${scene.number}
Scene title: ${scene.title}
Purpose: ${scene.purpose}
Location: ${scene.location}
Characters: ${scene.characters.join(", ")}
Mood: ${scene.mood}
Visual style: ${scene.visualStyle}
Summary: ${scene.summary}
Beats: ${JSON.stringify(scene.beats)}
Dialogue: ${scene.dialogue}
Audio: ${scene.audio}
Current full prompt: ${scene.fullPrompt}
Negative prompt: ${scene.negativePrompt}
Continuity rules: ${scene.continuityRules.join("\n")}

Return a JSON object with the updated scene fields. At minimum include a strong, detailed fullPrompt and the summary. You may also update beats, mood, visualStyle, dialogue, audio, and negativePrompt. If a timed beat needs speech, put that line on the beat.dialogue field for that exact beat instead of only in scene dialogue.`;
}

function scenePromptSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      fullPrompt: { type: "string" },
      summary: { type: "string" },
      mood: { type: "string" },
      visualStyle: { type: "string" },
      dialogue: { type: "string" },
      audio: { type: "string" },
      negativePrompt: { type: "string" },
      beats: {
        type: "array",
        items: {
          type: "object",
          properties: {
            range: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            camera: { type: "string" },
            audio: { type: "string" },
            dialogue: { type: "string" },
          },
          required: ["range", "title", "description"],
        },
      },
    },
    required: ["fullPrompt"],
  };
}
