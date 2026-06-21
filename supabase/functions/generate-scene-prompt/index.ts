import { polishScenePrompt, regenerateScenePrompt } from "../_shared/nox-core.ts";
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

const scenePromptDraftSchema = {
  type: "object",
  properties: {
    purpose: { type: "string" },
    location: { type: "string" },
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
    fullPrompt: { type: "string" },
  },
  required: ["purpose", "location", "mood", "visualStyle", "summary", "beats", "dialogue", "audio", "negativePrompt", "continuityRules", "fullPrompt"],
  additionalProperties: false,
};

const requiredPromptSections = ["[SCENE]", "[TIMING]", "[STYLE]", "[CAMERA]", "[AUDIO]", "[DIALOGUE]", "[NEGATIVE PROMPT]"];

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
        workspaceId: asText(input.workspaceId, asText(input.context?.workspaceId)),
        authorization: request.headers.get("authorization") ?? "",
      });
      return Response.json(
        {
          ok: true,
          function: "generate-scene-prompt",
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

    if (!input?.scene?.id || !input?.provider) {
      return Response.json(
        { error: "scene and provider are required." },
        { status: 400, headers: corsHeaders },
      );
    }

    const fallbackScene =
      input.action === "polish"
        ? polishScenePrompt(input.scene, input.provider, input.context)
        : regenerateScenePrompt(input.scene, input.provider, input.context);

    const grokResult = await requestStructuredOutput({
      workspaceId: asText(input.workspaceId, asText(input.context?.workspaceId)),
      authorization: request.headers.get("authorization") ?? "",
      name: "nox_scene_prompt",
      description: "A copy-ready NOX Studio provider prompt for exactly one 10-second generated Scene Card video.",
      schema: scenePromptDraftSchema,
      developerPrompt: [
        "You are the NOX Scene Prompt Engine.",
        "Return only the requested structured JSON.",
        "Preserve the invariant: one Scene Card equals one generated 10-second video.",
        "The timed beats must remain internal instructions inside the same video prompt, not separate video files.",
        "The fullPrompt must include [SCENE], [TIMING], [STYLE], [CAMERA], [AUDIO], [DIALOGUE], and [NEGATIVE PROMPT] sections.",
        "Use provider-specific language that is practical to paste into the selected external generator.",
        "Preserve Spanish dialogue and Honduran / Central American voice style when provided.",
      ].join("\n"),
      userPrompt: JSON.stringify({
        action: input.action === "polish" ? "polish" : "regenerate",
        provider: input.provider,
        scene: input.scene,
        context: input.context ?? {},
        fallbackPrompt: fallbackScene.fullPrompt,
        requiredPromptSections,
      }),
      verbosity: "medium",
    });

    const scene = grokResult.data
      ? applyGrokScenePromptDraft(fallbackScene, grokResult.data, input.provider, input.action, grokResult.model, input.context?.language)
      : fallbackScene;

    return Response.json(
      {
        scene,
        source: grokResult.source,
        model: grokResult.model,
        fallbackReason: grokResult.error,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Scene prompt generation failed." },
      { status: 500, headers: corsHeaders },
    );
  }
});

function applyGrokScenePromptDraft(scene: any, draft: any, provider: string, action: string, model: string, language: any) {
  const beats = scene.beats.map((beat: any, index: number) => {
    const source = draft?.beats?.[index] ?? {};
    return {
      ...beat,
      range: text(source.range, beat.range),
      title: text(source.title, beat.title),
      description: text(source.description, beat.description),
      camera: text(source.camera, beat.camera),
      audio: text(source.audio, beat.audio),
    };
  });
  const fullPrompt = normalizeFullPrompt(text(draft?.fullPrompt, scene.fullPrompt), scene.fullPrompt, action, language);

  return {
    ...scene,
    purpose: text(draft?.purpose, scene.purpose),
    location: text(draft?.location, scene.location),
    mood: text(draft?.mood, scene.mood),
    visualStyle: text(draft?.visualStyle, scene.visualStyle),
    summary: text(draft?.summary, scene.summary),
    beats,
    dialogue: text(draft?.dialogue, scene.dialogue),
    audio: text(draft?.audio, scene.audio),
    negativePrompt: text(draft?.negativePrompt, scene.negativePrompt),
    continuityRules: textArray(draft?.continuityRules, scene.continuityRules),
    fullPrompt,
    status: "Prompt Ready",
    promptProvider: provider,
    externalProvider: provider,
    promptCopiedAt: scene.promptCopiedAt,
  };
}

function normalizeFullPrompt(candidate: string, fallback: string, action: string, language: any) {
  const hasRequiredSections = requiredPromptSections.every((section) => candidate.includes(section));
  const hasLanguageMarkers = getLanguageMarkers(language).every((marker) => candidate.includes(marker));
  const prompt = hasRequiredSections && hasLanguageMarkers ? candidate : fallback;
  if (action !== "polish" || prompt.includes("[POLISH PASS]")) return prompt;
  return `${prompt}

[POLISH PASS]
- Grok provider pass applied while preserving the exact one-video Scene Card structure.
- Keep all timed beats inside this single generated 10-second clip.
- Preserve subject, wardrobe, location, and dialogue continuity.`;
}

function getLanguageMarkers(language: any) {
  if (!language || typeof language !== "object") return [];
  return [
    typeof language.promptLanguage === "string" ? `Prompt language: ${language.promptLanguage}` : "",
    typeof language.subtitles === "string" ? `Subtitle language: ${language.subtitles}` : "",
    typeof language.voiceStyle === "string" ? language.voiceStyle : "",
  ].filter(Boolean);
}

function text(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function textArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const normalized = value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
  return normalized.length ? normalized : fallback;
}

function asText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
