type BrandKit = {
  studioName?: string;
  creatorName?: string;
  defaultStyle?: string;
  defaultExport?: string;
  watermarkAssetId?: string;
  watermarkAssetUrl?: string;
  watermarkStoragePath?: string;
  watermarkFilename?: string;
  colors?: string[];
  hashtags?: string[];
};

type PackageInput = {
  title: string;
  idea: string;
  type: string;
  format: string;
  length: string;
  genre: string;
  tone: string;
  target: string;
  workspaceId: string;
  brandKit?: BrandKit;
  language?: {
    promptLanguage: string;
    dialogueLanguage: string;
    subtitles: string;
    voiceStyle: string;
  };
};

type PromptContext = {
  characterRules?: string[];
  worldRules?: string[];
  language?: {
    promptLanguage: string;
    dialogueLanguage: string;
    subtitles: string;
    voiceStyle: string;
  };
};

type SceneBeat = {
  id: string;
  range: string;
  title: string;
  description: string;
  camera: string;
  audio: string;
};

type SceneCard = {
  id: string;
  projectId: string;
  number: number;
  title: string;
  purpose: string;
  durationSeconds: number;
  output: string;
  format: string;
  location: string;
  characters: string[];
  mood: string;
  visualStyle: string;
  summary: string;
  beats: SceneBeat[];
  dialogue: string;
  audio: string;
  fullPrompt: string;
  promptProvider?: string;
  promptCopiedAt?: string;
  externalProvider?: string;
  negativePrompt: string;
  continuityRules: string[];
  status: string;
  uploadedAsset?: string;
  approvedAssetId?: string;
};

const promptProviderOptions = [
  "Universal Prompt",
  "Grok",
  "Manual Copy Mode",
] as const;

const providerProfiles = {
  "Universal Prompt": {
    label: "Universal Prompt",
    copyMode: "Balanced prompt for any external video model.",
    strengths: ["clear subject continuity", "simple timing", "copy-ready structure"],
    templateRules: ["Use plain cinematic language.", "Keep every beat inside one continuous video."],
    motionRules: ["steady cinematic movement", "natural physical motion", "no scene reset between beats"],
    polishRules: ["tighten subject identity", "clarify the hook frame", "remove vague adjectives"],
    negativeRules: ["no extra characters", "no location reset", "no random text overlays"],
  },
  Grok: {
    label: "Grok",
    copyMode: "Bold viral imagery with a readable hook.",
    strengths: ["high-impact composition", "social hook", "stylized cinematic energy"],
    templateRules: ["Make the first frame readable on a phone.", "Use one memorable visual idea."],
    motionRules: ["strong silhouette motion", "high-contrast reveal", "hook ending"],
    polishRules: ["increase visual punch", "simplify the hook", "protect character readability"],
    negativeRules: ["no cluttered frame", "no unreadable text", "no meme props unless requested"],
  },
  "Manual Copy Mode": {
    label: "Manual Copy Mode",
    copyMode: "Human-readable prompt for manual provider paste.",
    strengths: ["easy copying", "plain instructions", "external workflow support"],
    templateRules: ["Use clean sections.", "Avoid hidden assumptions about a connected API."],
    motionRules: ["simple continuous motion", "clear beat boundaries", "usable 10-second clip"],
    polishRules: ["make the prompt paste-ready", "remove duplicates", "highlight provider-neutral constraints"],
    negativeRules: ["no API-only syntax", "no missing duration", "no split-scene instructions"],
  },
};

function makeId(_prefix: string) {
  return crypto.randomUUID();
}

function nowLabel() {
  return "Just now";
}

function normalizePromptProvider(provider = "Universal Prompt") {
  const match = promptProviderOptions.find((option) => option.toLowerCase() === provider.toLowerCase());
  if (match) return match;
  const lowerProvider = provider.toLowerCase();
  if (lowerProvider.includes("grok")) return "Grok";
  if (lowerProvider.includes("manual")) return "Manual Copy Mode";
  return "Universal Prompt";
}

export function formatScenePrompt(scene: SceneCard, provider = "Universal Prompt", context: PromptContext = {}) {
  const profile = providerProfiles[normalizePromptProvider(provider)];
  const beats = scene.beats
    .map((beat) => `${beat.range} (${beat.title})\nAction: ${beat.description}\nCamera: ${beat.camera}\nAudio: ${beat.audio}`)
    .join("\n");
  const characterRules = context.characterRules?.length ? context.characterRules.join("\n") : scene.continuityRules.join("\n");
  const worldRules = context.worldRules?.length ? context.worldRules.join("\n") : "Preserve the saved world tone, symbols, technology, and location rules.";
  const language = context.language ?? {
    promptLanguage: "English",
    dialogueLanguage: "Spanish",
    subtitles: "Spanish",
    voiceStyle: "Honduran / Central American when selected",
  };

  return `[SCENE]
Generate one complete ${scene.durationSeconds}-second cinematic AI video scene.
Prompt language: ${language.promptLanguage}
Scene purpose: ${scene.purpose}
Location: ${scene.location}
Story summary: ${scene.summary}
Subjects: ${scene.characters.join(", ")}
Mood: ${scene.mood}
Output rule: ${scene.output}; do not split this Scene Card into separate video files.

[PROVIDER TEMPLATE]
Provider: ${profile.label}
Copy mode: ${profile.copyMode}
Strengths: ${profile.strengths.join(", ")}
Template rules:
${profile.templateRules.map((rule) => `- ${rule}`).join("\n")}

[TIMING]
${beats}

[STYLE]
${scene.visualStyle}
Provider style emphasis: ${profile.motionRules.join("; ")}

[CAMERA]
One continuous ${scene.durationSeconds}-second video with ${scene.beats.length} clear internal visual beats.
Camera continuity: smooth movement, no hard cut to a different location, no visual reset.
Provider camera guidance: ${profile.motionRules.join("; ")}.

[SUBJECT]
Characters: ${scene.characters.join(", ")}. Mood: ${scene.mood}

[CONTINUITY]
Character rules:
${characterRules}

World rules:
${worldRules}

[AUDIO]
Primary audio: ${scene.audio}
Beat audio should support the action without drowning out dialogue.

[DIALOGUE]
Dialogue language: ${language.dialogueLanguage}
Subtitle language: ${language.subtitles}
Voice style: ${language.voiceStyle}
Honduran / Central American voice option: preserve this regional Spanish style when selected in project language settings.
${scene.dialogue}

[COPY CHECK]
This prompt is ready to paste into ${profile.label}. Keep the whole Scene Card as one generated ${scene.durationSeconds}-second clip.

[NEGATIVE PROMPT]
${scene.negativePrompt}
Provider negatives: ${profile.negativeRules.join(", ")}`;
}

export function regenerateScenePrompt(scene: SceneCard, provider = "Universal Prompt", context: PromptContext = {}) {
  const profile = providerProfiles[normalizePromptProvider(provider)];
  return {
    ...scene,
    status: "Prompt Ready",
    promptProvider: profile.label,
    fullPrompt: formatScenePrompt(scene, provider, context),
  };
}

export function polishScenePrompt(scene: SceneCard, provider = "Universal Prompt", context: PromptContext = {}) {
  const profile = providerProfiles[normalizePromptProvider(provider)];
  return {
    ...scene,
    status: "Prompt Ready",
    promptProvider: profile.label,
    fullPrompt: `${formatScenePrompt(scene, provider, context)}

[POLISH PASS]
${profile.polishRules.map((rule) => `- ${rule}`).join("\n")}
- Preserve Spanish dialogue when present.
- Keep Honduran / Central American voice style when selected.
- Make the first frame, final hook frame, and continuity rules obvious before copying.`,
  };
}

export function createProductionPackage(input: PackageInput) {
  const projectId = makeId("project");
  const sceneCount = Number(input.length.match(/(\d+)\s+scene/i)?.[1] ?? "6");
  const runtime = input.length.split("=")[0].trim();
  const title = input.title.trim() || "Untitled NOX Film";
  const worldName = input.genre.toLowerCase().includes("space") ? "Orbital NOX Ring" : "NOX City 2099";
  const leadName = "Nova";
  const partnerName = "Rayo";
  const language = input.language ?? {
    promptLanguage: "English",
    dialogueLanguage: "Spanish",
    subtitles: "Spanish",
    voiceStyle: "Honduran / Central American when selected",
  };
  const project = {
    id: projectId,
    workspaceId: input.workspaceId,
    title: `${title} - Draft`,
    type: input.type,
    format: input.format,
    runtime,
    sceneCount,
    generatedScenes: 0,
    status: "Scene Prompts Ready",
    nextStep: "Review generated Scene Cards",
    genre: input.genre,
    tone: input.tone,
    world: worldName,
    mainCharacters: [leadName, partnerName],
    idea: input.idea,
    aiTarget: input.target,
    language,
    logline: `A ${input.tone.toLowerCase()} ${input.genre.toLowerCase()} short where ${leadName} follows a signal that turns one idea into a cinematic crisis.`,
    synopsis: input.idea,
    releaseStatus: "Studio Draft",
    updatedAt: nowLabel(),
    posterTone: "green",
  };
  const characters = [leadName, partnerName].map((name, index) => ({
    id: makeId("character"),
    workspaceId: input.workspaceId,
    name,
    alias: index === 0 ? "Lead signal finder" : "Continuity witness",
    role: index === 0 ? "Main character" : "Supporting character",
    personality: index === 0 ? "Focused, emotionally controlled, brave under pressure." : "Quick, protective, direct.",
    backstory: `Drawn into the story by this idea: ${input.idea}`,
    voice: index === 0 ? "Serious Spanish voice with cinematic restraint." : "Low, urgent Spanish dialogue.",
    accent: "Honduran / Central American Spanish when selected",
    wardrobeRules: index === 0 ? ["Dark practical jacket", "Consistent face"] : ["Reflective rain layer", "Consistent hair"],
    visualIdentity: `Realistic ${input.genre.toLowerCase()} character with cinematic lighting and NOX cyberglass reflections.`,
    referenceImageUrl: "",
    promptIdentity: `${name} stays grounded, realistic, and consistent across all Scene Cards.`,
    negativeRules: ["Do not change face", "Do not change wardrobe between connected scenes", "Do not make cartoonish"],
    appearsIn: [`${title} - Draft`],
  }));
  const worlds = [{
    id: makeId("world"),
    workspaceId: input.workspaceId,
    name: worldName,
    description: `${worldName} is the cinematic universe for ${title}: ${input.idea}`,
    tone: input.tone,
    locations: ["Opening danger location", "Market or street-level route", "Final reveal location"],
    visualRules: ["Wet reflective surfaces", "Neon cyan highlights", "Realistic human emotion", "No random location reset inside a 10-second Scene Card"],
    technology: ["Holographic displays", "Signal devices", "AI surveillance", "Memory chips"],
    factions: ["NOX Films citizens", "Signal watchers"],
    recurringSymbols: ["Cyan signal glow", "Broken glass reflections"],
    timeline: ["The signal appears", "The lead follows the warning", "The final reveal opens the next episode"],
  }];
  const locations = [
    {
      id: makeId("location"),
      workspaceId: input.workspaceId,
      worldId: worlds[0].id,
      name: "Opening danger location",
      description: `First visible environment where ${leadName} discovers the story signal.`,
      visualRules: ["Establish the world tone immediately", "Keep lighting continuous with the first Scene Card"],
      timelineNotes: ["Used for the opening Scene Card hook."],
    },
    {
      id: makeId("location"),
      workspaceId: input.workspaceId,
      worldId: worlds[0].id,
      name: "Market or street-level route",
      description: "A grounded route through the world where pressure and chase beats can happen.",
      visualRules: ["Keep local texture specific", "Preserve the same weather and color palette"],
      timelineNotes: ["Used for middle-scene escalation."],
    },
  ];
  const factions = [
    {
      id: makeId("faction"),
      workspaceId: input.workspaceId,
      worldId: worlds[0].id,
      name: "NOX Films citizens",
      description: "Background public presence that makes the world feel lived-in without distracting from the leads.",
      visualRules: ["Street-level realism", "No random crowd focus"],
      negativeRules: ["Do not turn the crowd into the protagonist", "Do not add comic costumes"],
      timelineNotes: ["Visible pressure in the first half of the short."],
    },
    {
      id: makeId("faction"),
      workspaceId: input.workspaceId,
      worldId: worlds[0].id,
      name: "Signal watchers",
      description: "People or systems tracking the signal and escalating the danger.",
      visualRules: ["Obscured faces", "Cyan signal motifs"],
      negativeRules: ["Do not make them medieval or supernatural", "Do not reveal more than the scene needs"],
      timelineNotes: ["Foreshadow the final reveal."],
    },
  ];
  const beatTemplates = [
    ["0-3s", "Visual hook", "Open on a striking cinematic image that instantly explains the danger."],
    ["3-7s", "Character pressure", "Move toward the lead character as the conflict becomes personal."],
    ["7-10s", "Ending hook", "End on a clear cliffhanger or reveal that makes the viewer want the next scene."],
  ];
  const scenes = Array.from({ length: sceneCount }, (_, index) => {
    const number = index + 1;
    const scene: SceneCard = {
      id: makeId("scene"),
      projectId,
      number,
      title: `SCENE ${String(number).padStart(2, "0")}`,
      purpose: number === 1 ? "Open with a powerful visual hook." : "Advance the story while preserving continuity.",
      durationSeconds: 10,
      output: "One generated video",
      format: input.format,
      location: locations[(number - 1) % locations.length]?.name ?? worldName,
      characters: number % 2 === 0 ? [leadName, partnerName] : [leadName],
      mood: input.tone,
      visualStyle: `Hyperrealistic futuristic cyberglass cinema, ${input.genre.toLowerCase()}, neon rain, dramatic contrast.`,
      summary: `Scene ${number} of ${title} turns the idea into a 10-second cinematic beat.`,
      beats: beatTemplates.map(([range, beatTitle, description], beatIndex) => ({
        id: makeId("beat"),
        range,
        title: beatTitle,
        description: `${description} Scene ${number} advances: ${input.idea}`,
        camera: beatIndex === 0 ? "Wide establishing view." : beatIndex === 1 ? "Smooth push-in." : "Tight close-up hook.",
        audio: beatIndex === 0 ? "Atmospheric intro." : beatIndex === 1 ? "Low bass pulse." : "Glitch swell.",
      })),
      dialogue: number === sceneCount ? `${leadName} says in Spanish: "Esto apenas empieza."` : `${leadName} says in Spanish: "La senal nos encontro."`,
      audio: "Rain, low cinematic bass, electrical glitches, distant city ambience.",
      fullPrompt: "",
      externalProvider: input.target,
      negativePrompt: "No random extra characters, no location change, no cartoon style, no distorted face, no sudden costume change.",
      continuityRules: ["Keep characters visually consistent.", "Keep all beats inside one generated 10-second video.", "Do not split this Scene Card into separate video files."],
      status: "Prompt Ready",
    };
    return regenerateScenePrompt(scene, input.target, { language });
  });
  const studioName = input.brandKit?.studioName ?? "NOX Films";
  const publishKit = {
    id: makeId("publish"),
    projectId,
    tiktokTitle: `${title}: ${scenes[0]?.title ?? "The Signal"}`,
    caption: `${project.logline} Built for ${studioName} with ${sceneCount} Scene Cards.`,
    hashtags: [...new Set([...(input.brandKit?.hashtags ?? ["#NOXFilms", "#Cyberglass", "#AIFilm"]), `#${input.genre.replace(/\s+/g, "")}`])],
    hookLine: scenes[0]?.summary ?? project.logline,
    pinnedComment: "Which scene should become the trailer cut?",
    youtubeTitle: `${title} - ${studioName} Short`,
    description: `${project.synopsis}\n\nRuntime: ${project.runtime}\nFormat: ${input.brandKit?.defaultExport ?? project.format}`,
    tags: [studioName, "AI shortfilm", input.genre, input.tone],
    chapters: scenes.map((scene, index) => `0:${String(index * 10).padStart(2, "0")} Scene ${scene.number}: ${scene.title}`),
    noxFilmsRow: input.genre.toLowerCase().includes("music") ? "Music Videos" : "Cyberglass Stories",
    runtime: project.runtime,
    genre: project.genre,
    releaseStatus: project.releaseStatus,
    thumbnailPrompt: `${scenes[0]?.title ?? project.title} thumbnail, bold readable title, realistic faces.`,
    posterPrompt: `Vertical cinematic poster for ${project.title}, ${project.world}, ${project.genre}, ${project.tone}.`,
    updatedAt: nowLabel(),
  };
  const timelineItems = scenes.map((scene, index) => ({
    id: makeId("timeline"),
    projectId,
    sceneId: scene.id,
    trackType: "video",
    label: `SCENE ${String(scene.number).padStart(2, "0")} - ${scene.title}`,
    startTime: index * 10,
    endTime: index * 10 + 10,
    orderIndex: index,
    transitionIn: index === 0 ? "Blackout Cut" : "Cyberglass Swipe",
    transitionOut: index === scenes.length - 1 ? "Neon Pulse Zoom" : "Signal Glitch",
    trimStartNote: "Start on first usable frame after provider slate or generation drift.",
    trimEndNote: "End on the cleanest hook frame before motion collapse or unwanted reset.",
    editorNotes: "Generated by Supabase Edge NOX Core V1.",
  }));
  const generationJobs = [{
    id: makeId("job"),
    workspaceId: input.workspaceId,
    projectId,
    task: "NOX Core production package",
    project: project.title,
    provider: "NOX Core Edge Function",
    status: "Completed",
    cost: "$0 local",
    inputPayload: input.idea,
    outputPayload: `${sceneCount} Scene Cards generated.`,
    retryCount: 0,
    maxRetries: 2,
    logs: [`${new Date().toISOString()} - Completed: ${sceneCount} Scene Cards generated.`],
    completedAt: new Date().toISOString(),
    createdAt: nowLabel(),
  }];

  return { project, scenes, characters, worlds, locations, factions, publishKit, timelineItems, generationJobs };
}
