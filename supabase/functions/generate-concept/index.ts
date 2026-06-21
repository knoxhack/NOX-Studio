import { createProductionPackage, regenerateScenePrompt } from "../_shared/nox-core.ts";
import { resolveGrokRuntime, requestStructuredOutput } from "../_shared/grok.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const stringArraySchema = {
  type: "array",
  items: { type: "string" },
};

const beatSchema = {
  type: "object",
  properties: {
    range: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    camera: { type: "string" },
    audio: { type: "string" },
  },
  required: ["range", "title", "description", "camera", "audio"],
  additionalProperties: false,
};

const characterSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    alias: { type: "string" },
    role: { type: "string" },
    personality: { type: "string" },
    backstory: { type: "string" },
    voice: { type: "string" },
    accent: { type: "string" },
    wardrobeRules: stringArraySchema,
    visualIdentity: { type: "string" },
    promptIdentity: { type: "string" },
    negativeRules: stringArraySchema,
  },
  required: [
    "name",
    "alias",
    "role",
    "personality",
    "backstory",
    "voice",
    "accent",
    "wardrobeRules",
    "visualIdentity",
    "promptIdentity",
    "negativeRules",
  ],
  additionalProperties: false,
};

const continuityRecordSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    visualRules: stringArraySchema,
    timelineNotes: stringArraySchema,
  },
  required: ["name", "description", "visualRules", "timelineNotes"],
  additionalProperties: false,
};

const conceptDraftSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    logline: { type: "string" },
    synopsis: { type: "string" },
    worldName: { type: "string" },
    mainCharacters: stringArraySchema,
    characters: {
      type: "array",
      items: characterSchema,
    },
    world: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        tone: { type: "string" },
        locations: stringArraySchema,
        visualRules: stringArraySchema,
        technology: stringArraySchema,
        factions: stringArraySchema,
        recurringSymbols: stringArraySchema,
        timeline: stringArraySchema,
      },
      required: ["name", "description", "tone", "locations", "visualRules", "technology", "factions", "recurringSymbols", "timeline"],
      additionalProperties: false,
    },
    locations: {
      type: "array",
      items: continuityRecordSchema,
    },
    factions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          visualRules: stringArraySchema,
          negativeRules: stringArraySchema,
          timelineNotes: stringArraySchema,
        },
        required: ["name", "description", "visualRules", "negativeRules", "timelineNotes"],
        additionalProperties: false,
      },
    },
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          purpose: { type: "string" },
          location: { type: "string" },
          characters: stringArraySchema,
          mood: { type: "string" },
          visualStyle: { type: "string" },
          summary: { type: "string" },
          beats: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: beatSchema,
          },
          dialogue: { type: "string" },
          audio: { type: "string" },
          negativePrompt: { type: "string" },
          continuityRules: stringArraySchema,
        },
        required: [
          "title",
          "purpose",
          "location",
          "characters",
          "mood",
          "visualStyle",
          "summary",
          "beats",
          "dialogue",
          "audio",
          "negativePrompt",
          "continuityRules",
        ],
        additionalProperties: false,
      },
    },
    publish: {
      type: "object",
      properties: {
        tiktokTitle: { type: "string" },
        caption: { type: "string" },
        hashtags: stringArraySchema,
        hookLine: { type: "string" },
        pinnedComment: { type: "string" },
        youtubeTitle: { type: "string" },
        description: { type: "string" },
        tags: stringArraySchema,
        thumbnailPrompt: { type: "string" },
        posterPrompt: { type: "string" },
      },
      required: ["tiktokTitle", "caption", "hashtags", "hookLine", "pinnedComment", "youtubeTitle", "description", "tags", "thumbnailPrompt", "posterPrompt"],
      additionalProperties: false,
    },
  },
  required: ["title", "logline", "synopsis", "worldName", "mainCharacters", "characters", "world", "locations", "factions", "scenes", "publish"],
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
      const grok = await resolveGrokRuntime({
        workspaceId: asText(input.workspaceId),
        authorization: request.headers.get("authorization") ?? "",
      });
      return Response.json(
        {
          ok: true,
          function: "generate-concept",
          source: "supabase-edge",
          grokConfigured: grok.configured,
          grokSource: grok.source,
          grokTextModel: grok.textModel,
          grokImageModel: grok.imageModel,
          grokVideoModel: grok.videoModel,
          grokStrict: grok.strict,
        },
        { headers: corsHeaders },
      );
    }

    const missing = ["workspaceId", "title", "idea", "type", "format", "length", "genre", "tone", "target"].filter((field) => !input?.[field]);
    if (missing.length) {
      return Response.json(
        { error: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required.` },
        { status: 400, headers: corsHeaders },
      );
    }

    const fallbackPackage = createProductionPackage(input);
    const grokResult = await requestStructuredOutput({
      workspaceId: input.workspaceId,
      authorization: request.headers.get("authorization") ?? "",
      name: "nox_concept_package",
      description: "A creative NOX Studio production package draft that maps into the stable Scene Card schema.",
      schema: conceptDraftSchema,
      developerPrompt: [
        "You are NOX Core, the story and production brain for a futuristic AI film studio.",
        "Return only the requested structured JSON.",
        "Preserve the core invariant: one Scene Card equals one generated 10-second video.",
        "Each Scene Card may contain 1-3 timed beats, but those beats are internal instructions inside the same prompt/video.",
        "Make the package cinematic, coherent, production-ready, and usable for TikTok, YouTube Shorts, Reels, and NOX Films.",
        "Favor Spanish dialogue support and Honduran / Central American voice style when the project asks for Spanish.",
      ].join("\n"),
      userPrompt: JSON.stringify({
        requestedProject: input,
        expectedSceneCount: fallbackPackage.scenes.length,
        expectedDurationPerSceneSeconds: 10,
        stableFallbackShape: {
          sceneTitles: fallbackPackage.scenes.map((scene) => scene.title),
          characterSlots: fallbackPackage.characters.length,
          locationSlots: fallbackPackage.locations.length,
          factionSlots: fallbackPackage.factions.length,
        },
      }),
      verbosity: "medium",
    });

    const productionPackage = grokResult.data
      ? applyGrokConceptDraft(fallbackPackage, grokResult.data, input, grokResult.model)
      : fallbackPackage;

    return Response.json(
      {
        productionPackage,
        source: grokResult.source,
        model: grokResult.model,
        fallbackReason: grokResult.error,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Concept generation failed." },
      { status: 500, headers: corsHeaders },
    );
  }
});

function applyGrokConceptDraft(productionPackage: any, draft: any, input: any, model: string) {
  const projectTitle = withDraftSuffix(draft?.title, productionPackage.project.title);
  const worldName = text(draft?.worldName, text(draft?.world?.name, productionPackage.project.world));
  const characters = productionPackage.characters.map((character: any, index: number) => {
    const source = draft?.characters?.[index] ?? {};
    const name = text(source.name, character.name);
    return {
      ...character,
      name,
      alias: text(source.alias, character.alias),
      role: text(source.role, character.role),
      personality: text(source.personality, character.personality),
      backstory: text(source.backstory, character.backstory),
      voice: text(source.voice, character.voice),
      accent: text(source.accent, character.accent),
      wardrobeRules: textArray(source.wardrobeRules, character.wardrobeRules),
      visualIdentity: text(source.visualIdentity, character.visualIdentity),
      promptIdentity: text(source.promptIdentity, `${name} stays visually consistent across every Scene Card.`),
      negativeRules: textArray(source.negativeRules, character.negativeRules),
      appearsIn: [projectTitle],
    };
  });
  const characterRules = characters.map((character: any) => character.promptIdentity);
  const mainCharacters = textArray(draft?.mainCharacters, characters.map((character: any) => character.name)).slice(0, 4);
  const worldSource = draft?.world ?? {};
  const worlds = productionPackage.worlds.map((world: any) => ({
    ...world,
    name: worldName,
    description: text(worldSource.description, world.description),
    tone: text(worldSource.tone, input.tone),
    locations: textArray(worldSource.locations, world.locations),
    visualRules: textArray(worldSource.visualRules, world.visualRules),
    technology: textArray(worldSource.technology, world.technology),
    factions: textArray(worldSource.factions, world.factions),
    recurringSymbols: textArray(worldSource.recurringSymbols, world.recurringSymbols),
    timeline: textArray(worldSource.timeline, world.timeline),
  }));
  const worldRules = [
    ...(worlds[0]?.visualRules ?? []),
    ...(worlds[0]?.technology ?? []),
    ...(worlds[0]?.recurringSymbols ?? []),
  ];
  const locations = productionPackage.locations.map((location: any, index: number) => {
    const source = draft?.locations?.[index] ?? {};
    return {
      ...location,
      worldId: worlds[0]?.id ?? location.worldId,
      name: text(source.name, location.name),
      description: text(source.description, location.description),
      visualRules: textArray(source.visualRules, location.visualRules),
      timelineNotes: textArray(source.timelineNotes, location.timelineNotes),
    };
  });
  const factions = productionPackage.factions.map((faction: any, index: number) => {
    const source = draft?.factions?.[index] ?? {};
    return {
      ...faction,
      worldId: worlds[0]?.id ?? faction.worldId,
      name: text(source.name, faction.name),
      description: text(source.description, faction.description),
      visualRules: textArray(source.visualRules, faction.visualRules),
      negativeRules: textArray(source.negativeRules, faction.negativeRules),
      timelineNotes: textArray(source.timelineNotes, faction.timelineNotes),
    };
  });
  const scenes = productionPackage.scenes.map((scene: any, index: number) => {
    const source = draft?.scenes?.[index] ?? {};
    const beats = scene.beats.map((beat: any, beatIndex: number) => {
      const beatSource = source.beats?.[beatIndex] ?? {};
      return {
        ...beat,
        range: text(beatSource.range, beat.range),
        title: text(beatSource.title, beat.title),
        description: text(beatSource.description, beat.description),
        camera: text(beatSource.camera, beat.camera),
        audio: text(beatSource.audio, beat.audio),
      };
    });
    const nextScene = {
      ...scene,
      title: text(source.title, scene.title),
      purpose: text(source.purpose, scene.purpose),
      output: "One generated video",
      location: text(source.location, scene.location),
      characters: textArray(source.characters, scene.characters),
      mood: text(source.mood, scene.mood),
      visualStyle: text(source.visualStyle, scene.visualStyle),
      summary: text(source.summary, scene.summary),
      beats,
      dialogue: text(source.dialogue, scene.dialogue),
      audio: text(source.audio, scene.audio),
      negativePrompt: text(source.negativePrompt, scene.negativePrompt),
      continuityRules: textArray(source.continuityRules, scene.continuityRules),
      externalProvider: input.target,
    };
    return regenerateScenePrompt(nextScene, input.target, {
      language: productionPackage.project.language,
      characterRules,
      worldRules,
    });
  });
  const project = {
    ...productionPackage.project,
    title: projectTitle,
    generatedScenes: scenes.length,
    nextStep: "Review Grok-generated Scene Cards and copy provider prompts.",
    world: worldName,
    mainCharacters,
    logline: text(draft?.logline, productionPackage.project.logline),
    synopsis: text(draft?.synopsis, productionPackage.project.synopsis),
    updatedAt: "Just now",
  };
  const publish = draft?.publish ?? {};
  const publishKit = {
    ...productionPackage.publishKit,
    tiktokTitle: text(publish.tiktokTitle, productionPackage.publishKit.tiktokTitle),
    caption: text(publish.caption, productionPackage.publishKit.caption),
    hashtags: textArray(publish.hashtags, productionPackage.publishKit.hashtags),
    hookLine: text(publish.hookLine, scenes[0]?.summary ?? productionPackage.publishKit.hookLine),
    pinnedComment: text(publish.pinnedComment, productionPackage.publishKit.pinnedComment),
    youtubeTitle: text(publish.youtubeTitle, productionPackage.publishKit.youtubeTitle),
    description: text(publish.description, productionPackage.publishKit.description),
    tags: textArray(publish.tags, productionPackage.publishKit.tags),
    thumbnailPrompt: text(publish.thumbnailPrompt, productionPackage.publishKit.thumbnailPrompt),
    posterPrompt: text(publish.posterPrompt, productionPackage.publishKit.posterPrompt),
    chapters: scenes.map((scene: any, index: number) => `0:${String(index * 10).padStart(2, "0")} Scene ${scene.number}: ${scene.title}`),
    updatedAt: "Just now",
  };
  const timelineItems = productionPackage.timelineItems.map((item: any, index: number) => {
    const scene = scenes[index];
    return scene
      ? {
          ...item,
          sceneId: scene.id,
          label: `SCENE ${String(scene.number).padStart(2, "0")} - ${scene.title}`,
          editorNotes: `Grok structured concept draft mapped into NOX Cut V1. Model: ${model}.`,
        }
      : item;
  });
  const generationJobs = productionPackage.generationJobs.map((job: any) => ({
    ...job,
    project: project.title,
    provider: `Grok / ${model}`,
    cost: "Grok usage",
    outputPayload: `${scenes.length} Grok-assisted Scene Cards generated.`,
  }));

  return { project, scenes, characters, worlds, locations, factions, publishKit, timelineItems, generationJobs };
}

function asText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function withDraftSuffix(value: unknown, fallback: string) {
  const baseFallback = fallback.replace(/\s+-\s+Draft$/i, "");
  const base = text(value, baseFallback).replace(/\s+-\s+Draft$/i, "");
  return `${base} - Draft`;
}

function text(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function textArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const normalized = value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
  return normalized.length ? normalized : fallback;
}
