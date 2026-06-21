import type {
  BrandKit,
  CharacterProfile,
  ContinuityIssue,
  ContinuityReport,
  FactionEntry,
  GenerationJob,
  LocationEntry,
  ProductionPackage,
  Project,
  PublishKit,
  SceneBeat,
  SceneCard,
  StudioAsset,
  StudioState,
  TimelineItem,
  WorldEntry,
} from "../types";
import { createStorySpine, getSceneCountForLength } from "./storySpine";
import { makeId, nowLabel } from "./studioStore";

export type PackageInput = {
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
  language?: Project["language"];
};

export type PromptContext = {
  characterRules?: string[];
  worldRules?: string[];
  language?: Project["language"];
};

type PromptProviderProfile = {
  label: string;
  copyMode: string;
  strengths: string[];
  templateRules: string[];
  motionRules: string[];
  polishRules: string[];
  negativeRules: string[];
};

export const promptProviderOptions = [
  "Universal Prompt",
  "Grok",
  "Manual Copy Mode",
] as const;

const providerProfiles: Record<(typeof promptProviderOptions)[number], PromptProviderProfile> = {
  "Universal Prompt": {
    label: "Universal Prompt",
    copyMode: "Balanced prompt for any external video model.",
    strengths: ["clear subject continuity", "simple timing", "copy-ready structure"],
    templateRules: [
      "Use plain cinematic language that can be pasted into any provider.",
      "Keep every beat inside one continuous generated video.",
      "Avoid provider-only flags or syntax.",
    ],
    motionRules: ["steady cinematic movement", "natural physical motion", "no scene reset between beats"],
    polishRules: ["tighten subject identity", "clarify the hook frame", "remove vague adjectives"],
    negativeRules: ["no extra characters", "no location reset", "no random text overlays"],
  },
  Grok: {
    label: "Grok",
    copyMode: "Bold viral imagery with a readable hook.",
    strengths: ["high-impact composition", "social hook", "stylized cinematic energy"],
    templateRules: [
      "Make the first frame immediately understandable on a phone.",
      "Use bold contrast and a single memorable visual idea.",
      "Keep the story legible without relying on tiny text.",
    ],
    motionRules: ["strong silhouette motion", "high-contrast reveal", "hook ending"],
    polishRules: ["increase visual punch", "simplify the hook", "protect character readability"],
    negativeRules: ["no cluttered frame", "no unreadable text", "no meme props unless requested"],
  },
  "Manual Copy Mode": {
    label: "Manual Copy Mode",
    copyMode: "Human-readable prompt for manual provider paste.",
    strengths: ["easy copying", "plain instructions", "external workflow support"],
    templateRules: [
      "Use clean sections that are easy to inspect before copying.",
      "Avoid hidden assumptions about a connected API.",
      "Preserve every field the editor needs for manual generation.",
    ],
    motionRules: ["simple continuous motion", "clear beat boundaries", "usable 10-second clip"],
    polishRules: ["make the prompt paste-ready", "remove duplicates", "highlight provider-neutral constraints"],
    negativeRules: ["no API-only syntax", "no missing duration", "no split-scene instructions"],
  },
};

function normalizePromptProvider(provider = "Universal Prompt") {
  const match = promptProviderOptions.find((option) => option.toLowerCase() === provider.toLowerCase());
  if (match) return match;

  const lowerProvider = provider.toLowerCase();
  if (lowerProvider.includes("grok")) return "Grok";
  if (lowerProvider.includes("manual")) return "Manual Copy Mode";
  return "Universal Prompt";
}

export function getPromptProviderProfile(provider = "Universal Prompt") {
  return providerProfiles[normalizePromptProvider(provider)];
}

const sceneTitles = [
  "THE FIRST SIGNAL",
  "MARKET WARNING",
  "THE HIDDEN WITNESS",
  "MEMORY IN THE RAIN",
  "THE DOOR OPENS",
  "CITY OF ECHOES",
  "THE FALSE SKY",
  "LAST TRANSMISSION",
  "THE RETURN PATH",
  "AFTERIMAGE",
  "BLACKOUT PRAYER",
  "NOX FILMS HOOK",
];

const beatTemplates = [
  ["0-3s", "Visual hook", "Open on a striking cinematic image that instantly explains the danger."],
  ["3-7s", "Character pressure", "Move toward the lead character as the conflict becomes personal."],
  ["7-10s", "Ending hook", "End on a clear cliffhanger or reveal that makes the viewer want the next scene."],
];

export function getSceneCount(length: string) {
  return getSceneCountForLength(length);
}

export function runContinuityCheck(
  scene: SceneCard,
  characters: CharacterProfile[],
  worlds: WorldEntry[],
  locations: LocationEntry[] = [],
  factions: FactionEntry[] = [],
): ContinuityReport {
  const haystack = [
    scene.title,
    scene.location,
    scene.characters.join(" "),
    scene.summary,
    scene.beats.map((beat) => [beat.title, beat.description, beat.camera, beat.audio, beat.dialogue].join(" ")).join(" "),
    scene.visualStyle,
    scene.dialogue,
    scene.audio,
    scene.fullPrompt,
    scene.negativePrompt,
    scene.continuityRules.join(" "),
  ]
    .join(" ")
    .toLowerCase();
  const issues: ContinuityIssue[] = [];
  const savedCharacters = uniqueByKey(characters, (character) => character.name.toLowerCase());
  const savedWorlds = uniqueByKey(worlds, (world) => world.name.toLowerCase());
  const savedLocations = uniqueByKey(locations, (location) => location.name.toLowerCase());
  const savedFactions = uniqueByKey(factions, (faction) => faction.name.toLowerCase());
  const matchedCharacters = savedCharacters.filter((character) => {
    const name = character.name.toLowerCase();
    return scene.characters.some((sceneCharacter) => sceneCharacter.toLowerCase() === name) || haystack.includes(name);
  });
  const matchedWorlds = savedWorlds.filter((world) => {
    const worldName = world.name.toLowerCase();
    const worldAlias = worldName.replace(/\b\d{3,4}\b/g, "").replace(/\s+/g, " ").trim();
    const locations = world.locations ?? [];
    const locationMatch = locations.some((location) => haystack.includes(location.toLowerCase()));
    return haystack.includes(worldName) || (worldAlias.length >= 4 && haystack.includes(worldAlias)) || locationMatch;
  });
  const matchedLocations = savedLocations.filter((location) =>
    matchesContinuityRecord(haystack, location.name, [location.description, ...location.visualRules, ...location.timelineNotes]),
  );
  const matchedFactions = savedFactions.filter((faction) =>
    matchesContinuityRecord(haystack, faction.name, [faction.description, ...faction.visualRules, ...faction.timelineNotes]),
  );

  for (const characterName of Array.from(new Set(scene.characters))) {
    const character = savedCharacters.find((item) => item.name.toLowerCase() === characterName.toLowerCase());
    if (!character) {
      issues.push(makeContinuityIssue("Missing", "Character", characterName, "No saved Character Vault profile is linked to this Scene Card."));
    }
  }

  for (const character of matchedCharacters) {
    if (!character.promptIdentity?.trim()) {
      issues.push(makeContinuityIssue("Missing", "Character", character.name, "Character prompt identity is empty."));
    }
    if (!(character.wardrobeRules ?? []).length) {
      issues.push(makeContinuityIssue("Warning", "Character", character.name, "Wardrobe rules are not defined."));
    }
    if (!character.referenceImageUrl?.trim()) {
      issues.push(makeContinuityIssue("Warning", "Character", character.name, "Face/reference image is not linked yet."));
    }
    if (!scene.fullPrompt.toLowerCase().includes(character.name.toLowerCase())) {
      issues.push(makeContinuityIssue("Warning", "Character", character.name, "Generated prompt does not explicitly name this saved character."));
    }
  }

  if (!matchedWorlds.length) {
    issues.push(makeContinuityIssue("Missing", "World", scene.location || "Scene location", "No World Bible entry or saved location matched this Scene Card."));
  }

  for (const world of matchedWorlds) {
    const worldLocations = [
      ...(world.locations ?? []),
      ...savedLocations.filter((location) => location.worldId === world.id).map((location) => location.name),
    ];
    const worldFactions = [
      ...(world.factions ?? []),
      ...savedFactions.filter((faction) => faction.worldId === world.id).map((faction) => faction.name),
    ];
    const timeline = world.timeline ?? [];
    if (!worldLocations.length) {
      issues.push(makeContinuityIssue("Missing", "Location", world.name, "World Bible has no saved locations."));
    } else if (
      !matchedLocations.some((location) => location.worldId === world.id) &&
      !worldLocations.some((location) => matchesContinuityRecord(haystack, location))
    ) {
      issues.push(makeContinuityIssue("Warning", "Location", world.name, "Scene does not match a saved location in this world."));
    }
    if (!(world.visualRules ?? []).length) {
      issues.push(makeContinuityIssue("Missing", "World", world.name, "World visual rules are empty."));
    }
    if (!worldFactions.length) {
      issues.push(makeContinuityIssue("Warning", "Faction", world.name, "No factions are saved for this world."));
    }
    if (!timeline.length) {
      issues.push(makeContinuityIssue("Warning", "Timeline", world.name, "World timeline anchors are not defined."));
    }
  }

  if (!issues.length) {
    issues.push(makeContinuityIssue("Pass", "World", "Continuity", "Scene matches saved character and world rules."));
  }

  const uniqueIssues = uniqueByKey(issues, (issue) => issue.id);
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
    matchedCharacters: matchedCharacters.map((character) => character.name),
    matchedWorlds: matchedWorlds.map((world) => world.name),
    matchedLocations: matchedLocations.map((location) => location.name),
    matchedFactions: matchedFactions.map((faction) => faction.name),
    issues: uniqueIssues,
  };
}

function uniqueByKey<Value>(values: Value[], getKey: (value: Value) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = getKey(value);
    if (seen.has(key)) return false;
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

function makeContinuityIssue(
  severity: ContinuityIssue["severity"],
  scope: ContinuityIssue["scope"],
  label: string,
  message: string,
  rule?: string,
): ContinuityIssue {
  return {
    id: `${scope}-${label}-${message}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    severity,
    scope,
    label,
    message,
    rule,
  };
}

export function formatScenePrompt(scene: SceneCard, provider = "Universal Prompt", context: PromptContext = {}) {
  const profile = getPromptProviderProfile(provider);
  const hasBeatDialogue = scene.beats.some((beat) => beat.dialogue?.trim());
  const fallbackDialogueBeatIndex = hasBeatDialogue ? -1 : getFallbackDialogueBeatIndex(scene.beats);
  const beats = scene.beats
    .map((beat, index) => {
      const beatDialogue = beat.dialogue?.trim() || (index === fallbackDialogueBeatIndex ? scene.dialogue.trim() : "");
      const dialogue = beatDialogue ? `\nDialogue: ${beatDialogue}` : "";
      return `${beat.range} (${beat.title})\nAction: ${beat.description}\nCamera: ${beat.camera}\nAudio: ${beat.audio}${dialogue}`;
    })
    .join("\n");
  const characterRules = context.characterRules?.length ? context.characterRules.join("\n") : scene.continuityRules.join("\n");
  const worldRules = context.worldRules?.length ? context.worldRules.join("\n") : "Preserve the saved world tone, symbols, technology, and location rules.";
  const dialogueLanguage = context.language?.dialogueLanguage ?? "Spanish";
  const promptLanguage = context.language?.promptLanguage ?? "English";
  const subtitleLanguage = context.language?.subtitles ?? "Spanish";
  const voiceStyle = context.language?.voiceStyle ?? "Honduran / Central American when selected";

  return `[SCENE]
Generate one complete ${scene.durationSeconds}-second cinematic AI video scene.
Prompt language: ${promptLanguage}
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
Dialogue language: ${dialogueLanguage}
Subtitle language: ${subtitleLanguage}
Voice style: ${voiceStyle}
Honduran / Central American voice option: preserve this regional Spanish style when selected in project language settings.
Dialogue lines belong inside the exact [TIMING] beat that speaks them. Do not add unscheduled dialogue outside those timed shots.

[COPY CHECK]
This prompt is ready to paste into ${profile.label}. Keep the whole Scene Card as one generated ${scene.durationSeconds}-second clip.

[NEGATIVE PROMPT]
${scene.negativePrompt}
Provider negatives: ${profile.negativeRules.join(", ")}`;
}

function getFallbackDialogueBeatIndex(beats: SceneBeat[]) {
  if (!beats.length) return -1;
  const dialogueBeatIndex = beats.findIndex((beat) => /dialogue|voice|speak|says|line/i.test(`${beat.title} ${beat.description} ${beat.audio}`));
  if (dialogueBeatIndex >= 0) return dialogueBeatIndex;
  return Math.min(1, beats.length - 1);
}

export function regenerateScenePrompt(scene: SceneCard, provider = "Universal Prompt", context: PromptContext = {}): SceneCard {
  const profile = getPromptProviderProfile(provider);
  return {
    ...scene,
    status: "Prompt Ready",
    promptProvider: profile.label,
    fullPrompt: formatScenePrompt(scene, provider, context),
  };
}

export function polishScenePrompt(scene: SceneCard, provider = "Universal Prompt", context: PromptContext = {}): SceneCard {
  const profile = getPromptProviderProfile(provider);
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

export function createProductionPackage(input: PackageInput): ProductionPackage {
  const projectId = makeId("project");
  const sceneCount = getSceneCount(input.length);
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

  const project: Project = {
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

  const characters: CharacterProfile[] = [
    {
      id: makeId("character"),
      workspaceId: input.workspaceId,
      name: leadName,
      alias: "Lead signal finder",
      role: "Main character",
      personality: "Focused, emotionally controlled, brave under pressure.",
      backstory: `Drawn into the story by this idea: ${input.idea}`,
      voice: "Serious Spanish voice with cinematic restraint.",
      accent: "Honduran / Central American Spanish when selected",
      wardrobeRules: ["Dark practical jacket", "Consistent face", "No random sunglasses"],
      visualIdentity: `Realistic ${input.genre.toLowerCase()} lead with cinematic lighting and NOX cyberglass reflections.`,
      referenceImageUrl: "",
      promptIdentity: `${leadName} is the main character of ${title}, grounded, realistic, and consistent across all Scene Cards.`,
      negativeRules: ["Do not change face", "Do not change wardrobe between connected scenes", "Do not make cartoonish"],
      appearsIn: [`${title} - Draft`],
    },
    {
      id: makeId("character"),
      workspaceId: input.workspaceId,
      name: partnerName,
      alias: "Continuity witness",
      role: "Supporting character",
      personality: "Quick, protective, direct.",
      backstory: "Knows the world rules and warns the lead when the signal becomes dangerous.",
      voice: "Low, urgent Spanish dialogue.",
      accent: "Central American Spanish",
      wardrobeRules: ["Reflective rain layer", "Consistent hair", "No random costume shifts"],
      visualIdentity: `Realistic supporting character with ${input.tone.toLowerCase()} expression and neon edge light.`,
      referenceImageUrl: "",
      promptIdentity: `${partnerName} keeps the story grounded and helps maintain continuity across generated scenes.`,
      negativeRules: ["Do not remove from scenes where listed", "Do not change outfit color", "Do not add extra companions"],
      appearsIn: [`${title} - Draft`],
    },
  ];

  const worlds: WorldEntry[] = [
    {
      id: makeId("world"),
      workspaceId: input.workspaceId,
      name: worldName,
      description: `${worldName} is the cinematic universe for ${title}: ${input.idea}`,
      tone: input.tone,
      locations: ["Opening danger location", "Market or street-level route", "Final reveal location"],
      visualRules: [
        "Wet reflective surfaces",
        "Neon cyan and purple highlights",
        "Realistic human emotion",
        "No random location reset inside a 10-second Scene Card",
      ],
      technology: ["Holographic displays", "Signal devices", "AI surveillance", "Memory chips"],
      factions: ["NOX Films citizens", "Signal watchers"],
      recurringSymbols: ["Cyan signal glow", "Broken glass reflections"],
      timeline: ["The signal appears", "The lead follows the warning", "The final reveal opens the next episode"],
    },
  ];

  const locations: LocationEntry[] = [
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
    {
      id: makeId("location"),
      workspaceId: input.workspaceId,
      worldId: worlds[0].id,
      name: "Final reveal location",
      description: "The endpoint where the story reveals the next release hook.",
      visualRules: ["Make the final silhouette readable", "Preserve recurring symbols"],
      timelineNotes: ["Used for the final reveal Scene Card."],
    },
  ];

  const factions: FactionEntry[] = [
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

  const storySpine = createStorySpine(input, { sceneCount, worldName, leadName, partnerName, language });
  const generatedScenes: SceneCard[] = storySpine.map((draft) => {
    const { storyRole: _storyRole, beats: beatDrafts, ...sceneDraft } = draft;
    const scene: SceneCard = {
      ...sceneDraft,
      id: makeId("scene"),
      projectId,
      beats: beatDrafts.map((beat) => ({ ...beat, id: makeId("beat") })),
      fullPrompt: "",
      status: "Prompt Ready",
    };

    return regenerateScenePrompt(scene, input.target, { language });
  });

  const scenes: SceneCard[] = Array.from({ length: sceneCount }, (_, index) => {
    const number = index + 1;
    const titleForScene = sceneTitles[index] ?? `SCENE ${String(number).padStart(2, "0")}`;
    const beats: SceneBeat[] = beatTemplates.map(([range, beatTitle, description], beatIndex) => ({
      id: makeId("beat"),
      range,
      title: beatTitle,
      description: `${description} Use a distinct story beat for Scene ${number}: ${input.idea}`,
      camera:
        beatIndex === 0
          ? "Wide establishing view with cinematic motion."
          : beatIndex === 1
            ? "Smooth push-in toward the main character."
            : "Tight close-up or silhouette hook.",
      audio:
        beatIndex === 0
          ? "Atmospheric intro, rain, distant city texture."
          : beatIndex === 1
            ? "Low bass pulse and tension rise."
            : "Glitch swell, breath, final impact.",
    }));

    const scene: SceneCard = {
      id: makeId("scene"),
      projectId,
      number,
      title: titleForScene,
      purpose:
        number === 1
          ? "Open with a powerful visual hook."
          : number === sceneCount
            ? "End with a clear hook for the next release."
            : "Advance the story while preserving character and world continuity.",
      durationSeconds: 10,
      output: "One generated video",
      format: input.format,
      location: locations[(number - 1) % locations.length]?.name ?? worldName,
      characters: number % 2 === 0 ? [leadName, partnerName] : [leadName],
      mood: input.tone,
      visualStyle: `Hyperrealistic futuristic cyberglass cinema, ${input.genre.toLowerCase()}, neon rain, dramatic contrast.`,
      summary: `Scene ${number} of ${title} turns the idea into a 10-second cinematic beat.`,
      beats,
      dialogue:
        number === sceneCount
          ? `${leadName} says in Spanish: "Esto apenas empieza."`
          : `${leadName} says in Spanish: "La señal nos encontró."`,
      audio: "Rain, low cinematic bass, electrical glitches, distant city ambience.",
      fullPrompt: "",
      externalProvider: input.target,
      negativePrompt:
        "No random extra characters, no location change, no cartoon style, no distorted face, no random unreadable text, no sudden costume change.",
      continuityRules: [
        "Keep characters visually consistent.",
        "Keep all beats inside one generated 10-second video.",
        "Do not split this Scene Card into separate video files.",
      ],
      status: "Prompt Ready",
    };

    return regenerateScenePrompt(scene, input.target, { language });
  });

  const publishKit = generatePublishKit(project, generatedScenes, input.brandKit);
  const timelineItems = generatedScenes.map<TimelineItem>((scene, index) => ({
    id: makeId("timeline"),
    projectId,
    sceneId: scene.id,
    trackType: "video",
    label: `SCENE ${String(scene.number).padStart(2, "0")} - ${scene.title}`,
    startTime: index * 10,
    endTime: index * 10 + 10,
    orderIndex: index,
    transitionIn: index === 0 ? "Blackout Cut" : "Cyberglass Swipe",
    transitionOut: index === generatedScenes.length - 1 ? "Neon Pulse Zoom" : "Signal Glitch",
    trimStartNote: "Start on first usable frame after provider slate or generation drift.",
    trimEndNote: "End on the cleanest hook frame before motion collapse or unwanted reset.",
    editorNotes: "Awaiting approved source clip before final assembly.",
  }));

  const generationJobs: GenerationJob[] = [
    {
      id: makeId("job"),
      workspaceId: input.workspaceId,
      projectId,
      task: "NOX Core production package",
      project: project.title,
      provider: "NOX Core Local",
      status: "Completed",
      cost: "$0 local",
      inputPayload: input.idea,
      outputPayload: `${sceneCount} Scene Cards generated.`,
      retryCount: 0,
      maxRetries: 2,
      logs: [`${new Date().toISOString()} - Completed: ${sceneCount} Scene Cards generated.`],
      completedAt: new Date().toISOString(),
      createdAt: nowLabel(),
    },
  ];

  return { project, scenes: generatedScenes, characters, worlds, locations, factions, publishKit, timelineItems, generationJobs };
}

export function generatePublishKit(project: Project, scenes: SceneCard[], brandKit?: BrandKit): PublishKit {
  const bestScene = scenes[0];
  const baseHashtags = brandKit?.hashtags?.length ? brandKit.hashtags : ["#NOXFilms", "#Cyberglass", "#AIFilm"];
  const hashtags = Array.from(new Set([...baseHashtags, `#${project.genre.replace(/\s+/g, "")}`]));
  const studioName = brandKit?.studioName ?? "NOX Films";
  const creatorName = brandKit?.creatorName ?? "NOX Studio";
  const defaultStyle = brandKit?.defaultStyle ?? "Futuristic cyberglass cinematic";
  const defaultExport = brandKit?.defaultExport ?? project.format;

  return {
    id: makeId("publish"),
    projectId: project.id,
    tiktokTitle: `${project.title.replace(" - Draft", "")}: ${bestScene?.title ?? "The Signal"}`,
    caption: `${project.logline} Built in ${creatorName} for ${studioName} with ${project.sceneCount} Scene Cards.`,
    hashtags,
    hookLine: bestScene?.summary ?? project.logline,
    pinnedComment: "Which scene should become the trailer cut?",
    youtubeTitle: `${project.title.replace(" - Draft", "")} - ${studioName} Short`,
    description: `${project.synopsis}\n\nRuntime: ${project.runtime}\nFormat: ${defaultExport}\nStudio style: ${defaultStyle}`,
    tags: [studioName, creatorName, "AI shortfilm", project.genre, project.tone],
    chapters: scenes.map((scene, index) => `${formatTime(index * 10)} Scene ${scene.number}: ${scene.title}`),
    noxFilmsRow: project.genre.toLowerCase().includes("music") ? "Music Videos" : "Cyberglass Stories",
    runtime: project.runtime,
    genre: project.genre,
    releaseStatus: project.releaseStatus,
    thumbnailPrompt: `${bestScene?.title ?? project.title} thumbnail, ${defaultStyle}, bold readable title, ${brandKit?.colors.join(", ") || "neon cyan and purple"}, realistic faces.`,
    posterPrompt: `Vertical cinematic poster for ${project.title}, ${project.world}, ${project.genre}, ${project.tone}, premium ${studioName} key art, ${defaultStyle}.`,
    updatedAt: nowLabel(),
  };
}

export function exportProjectMarkdown(state: StudioState, projectId: string) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return "";
  const scenes = state.scenes.filter((scene) => scene.projectId === projectId).sort((a, b) => a.number - b.number);
  const assets = state.assets.filter((asset) => asset.projectId === projectId);
  const worlds = (state.worlds ?? []).filter((world) => world.name === project.world);
  const worldIds = new Set(worlds.map((world) => world.id));
  const locations = (state.locations ?? []).filter((location) => location.worldId && worldIds.has(location.worldId));
  const factions = (state.factions ?? []).filter((faction) => faction.worldId && worldIds.has(faction.worldId));
  const kit = state.publishKits.find((item) => item.projectId === projectId);

  return `# ${project.title}

${project.logline}

## Project
- Type: ${project.type}
- Format: ${project.format}
- Runtime: ${project.runtime}
- Genre: ${project.genre}
- Tone: ${project.tone}
- AI target: ${project.aiTarget}

## Scene Cards
${scenes
  .map(
    (scene) => `### Scene ${String(scene.number).padStart(2, "0")} - ${scene.title}
- Duration: ${scene.durationSeconds} seconds
- Output: ${scene.output}
- Status: ${scene.status}
- Purpose: ${scene.purpose}
- Beats:
${scene.beats.map((beat) => `  - ${beat.range}: ${beat.description}`).join("\n")}

\`\`\`text
${scene.fullPrompt}
\`\`\`
`,
  )
  .join("\n")}

## Continuity Vault
${worlds.length
  ? worlds
      .map(
        (world) => `### ${world.name}
- Tone: ${world.tone}
- Locations: ${locations.length ? locations.map((location) => location.name).join(", ") : (world.locations ?? []).join(", ") || "Not captured"}
- Factions: ${factions.length ? factions.map((faction) => faction.name).join(", ") : (world.factions ?? []).join(", ") || "Not captured"}
- Timeline: ${(world.timeline ?? []).join(" | ") || "Not captured"}`,
      )
      .join("\n")
  : "No world continuity records linked to this project."}

## Asset Vault
${assets.length
  ? assets
      .map(
        (asset) => `- ${asset.filename} (${asset.type}, ${asset.status})
  - Attached to: ${asset.attachedTo}
  - Provider lineage: ${asset.provider}
  - Prompt ID: ${asset.promptId ?? "Not linked"}
  - Prompt used: ${asset.promptUsed ? asset.promptUsed.replace(/\s+/g, " ").trim() : "Not captured"}`,
      )
      .join("\n")
  : "No assets linked to this project."}

## Publish Kit
${kit ? `- TikTok: ${kit.tiktokTitle}\n- Caption: ${kit.caption}\n- Hashtags: ${kit.hashtags.join(" ")}` : "No publish kit generated."}
`;
}

export function exportProjectText(state: StudioState, projectId: string) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return "";
  const scenes = state.scenes.filter((scene) => scene.projectId === projectId).sort((a, b) => a.number - b.number);
  const assets = state.assets.filter((asset) => asset.projectId === projectId);
  const worlds = (state.worlds ?? []).filter((world) => world.name === project.world);
  const worldIds = new Set(worlds.map((world) => world.id));
  const locations = (state.locations ?? []).filter((location) => location.worldId && worldIds.has(location.worldId));
  const factions = (state.factions ?? []).filter((faction) => faction.worldId && worldIds.has(faction.worldId));
  const kit = state.publishKits.find((item) => item.projectId === projectId);

  const sceneBlocks = scenes
    .map((scene) => {
      const beats = scene.beats.map((beat) => `    ${beat.range}: ${beat.description}`).join("\n");
      return [
        `SCENE ${String(scene.number).padStart(2, "0")}: ${scene.title}`,
        `  Status: ${scene.status}`,
        `  Duration: ${scene.durationSeconds} seconds`,
        `  Output: ${scene.output}`,
        `  Purpose: ${scene.purpose}`,
        "  Beats:",
        beats || "    No beats captured.",
        "  Prompt used:",
        scene.fullPrompt || "No prompt captured.",
      ].join("\n");
    })
    .join("\n\n");

  const continuityBlock = worlds.length
    ? worlds
        .map((world) => {
          const linkedLocations = locations.length ? locations.map((location) => location.name) : world.locations ?? [];
          const linkedFactions = factions.length ? factions.map((faction) => faction.name) : world.factions ?? [];
          return [
            world.name,
            `  Tone: ${world.tone}`,
            `  Locations: ${linkedLocations.join(", ") || "Not captured"}`,
            `  Factions: ${linkedFactions.join(", ") || "Not captured"}`,
            `  Timeline: ${(world.timeline ?? []).join(" | ") || "Not captured"}`,
          ].join("\n");
        })
        .join("\n\n")
    : "No world continuity records linked to this project.";

  const assetBlock = assets.length
    ? assets
        .map((asset) =>
          [
            `${asset.filename} (${asset.type}, ${asset.status})`,
            `  Attached to: ${asset.attachedTo}`,
            `  Provider lineage: ${asset.provider}`,
            `  Prompt ID: ${asset.promptId ?? "Not linked"}`,
            `  Prompt used: ${asset.promptUsed ? asset.promptUsed.replace(/\s+/g, " ").trim() : "Not captured"}`,
          ].join("\n"),
        )
        .join("\n\n")
    : "No assets linked to this project.";

  const publishBlock = kit
    ? [
        "TikTok",
        `  Title: ${kit.tiktokTitle}`,
        `  Hook: ${kit.hookLine}`,
        `  Caption: ${kit.caption}`,
        `  Hashtags: ${kit.hashtags.join(" ")}`,
        `  Pinned comment: ${kit.pinnedComment}`,
        "",
        "YouTube",
        `  Title: ${kit.youtubeTitle}`,
        "  Description:",
        indentPlainText(kit.description, 4),
        `  Tags: ${kit.tags.join(", ")}`,
        "  Chapters:",
        kit.chapters.map((chapter) => `    ${chapter}`).join("\n") || "    No chapters captured.",
        "",
        "NOX Films",
        `  Row: ${kit.noxFilmsRow}`,
        `  Runtime: ${kit.runtime}`,
        `  Genre: ${kit.genre}`,
        `  Release status: ${kit.releaseStatus}`,
        "",
        "Poster and Thumbnail Prompts",
        `  Thumbnail: ${kit.thumbnailPrompt}`,
        `  Poster: ${kit.posterPrompt}`,
      ].join("\n")
    : "No publish kit generated.";

  return [
    "NOX STUDIO PRODUCTION PACKAGE",
    `Project: ${project.title}`,
    `Logline: ${project.logline}`,
    `Runtime: ${project.runtime}`,
    `Format: ${project.format}`,
    `Genre: ${project.genre}`,
    `Tone: ${project.tone}`,
    `AI target: ${project.aiTarget}`,
    `Release status: ${project.releaseStatus}`,
    "",
    "SYNOPSIS",
    project.synopsis,
    "",
    "SCENE CARDS",
    sceneBlocks || "No Scene Cards captured.",
    "",
    "CONTINUITY VAULT",
    continuityBlock,
    "",
    "ASSET VAULT",
    assetBlock,
    "",
    "PUBLISH KIT",
    publishBlock,
    "",
  ].join("\n");
}

export function exportProjectJson(state: StudioState, projectId: string) {
  const project = state.projects.find((item) => item.id === projectId);
  return JSON.stringify(
    {
      project,
      scenes: state.scenes.filter((scene) => scene.projectId === projectId),
      assets: state.assets.filter((asset) => asset.projectId === projectId),
      worlds: (state.worlds ?? []).filter((world) => world.name === project?.world),
      locations: (state.locations ?? []).filter((location) => {
        const worldIds = new Set((state.worlds ?? []).filter((world) => world.name === project?.world).map((world) => world.id));
        return location.worldId && worldIds.has(location.worldId);
      }),
      factions: (state.factions ?? []).filter((faction) => {
        const worldIds = new Set((state.worlds ?? []).filter((world) => world.name === project?.world).map((world) => world.id));
        return faction.worldId && worldIds.has(faction.worldId);
      }),
      publishKit: state.publishKits.find((kit) => kit.projectId === projectId),
      timelineItems: state.timelineItems.filter((item) => item.projectId === projectId),
    },
    null,
    2,
  );
}

export type ReleasePlatform = "TikTok" | "YouTube" | "NOX Films";

export function createReleaseBundle(state: StudioState, projectId: string, platform: ReleasePlatform) {
  const project = state.projects.find((item) => item.id === projectId);
  const kit = state.publishKits.find((item) => item.projectId === projectId);
  const scenes = state.scenes.filter((scene) => scene.projectId === projectId).sort((a, b) => a.number - b.number);
  const assets = state.assets.filter((asset) => asset.projectId === projectId);
  const timelineItems = state.timelineItems.filter((item) => item.projectId === projectId).sort(compareTimelineItems);
  const finalExports = assets.filter((asset) => asset.type === "Final Export");
  const approvedSceneVideos = assets.filter((asset) => asset.type === "Video" && asset.status === "Approved");
  const preset = getReleasePlatformPreset(platform, project?.runtime ?? kit?.runtime ?? "60 seconds");
  const metadata = getReleaseMetadata(platform, project, kit);
  const thumbnail = getReleaseThumbnail(platform, kit, project);
  const finalVideo = finalExports.find((asset) => asset.tags.includes("rendered-mp4")) ?? finalExports.find((asset) => asset.filename.endsWith(".mp4"));

  return {
    schemaVersion: 1,
    platform,
    preset,
    project: {
      id: project?.id ?? projectId,
      title: project?.title ?? kit?.youtubeTitle ?? projectId,
      runtime: project?.runtime ?? kit?.runtime ?? "",
      format: project?.format ?? preset.aspectRatio,
      genre: project?.genre ?? kit?.genre ?? "",
      releaseStatus: kit?.releaseStatus ?? project?.releaseStatus ?? "Studio Draft",
    },
    schedule: {
      status: kit?.releaseStatus ?? project?.releaseStatus ?? "Studio Draft",
      recommendedWindow: getReleaseWindow(platform),
      timezone: "workspace local time",
    },
    metadata,
    thumbnail,
    files: {
      finalVideo: finalVideo ? releaseAssetFile(finalVideo) : undefined,
      approvedSceneVideos: approvedSceneVideos.map(releaseAssetFile),
      exports: finalExports.map(releaseAssetFile),
      timeline: timelineItems.map((item) => ({
        id: item.id,
        trackType: item.trackType,
        label: item.label,
        startTime: item.startTime,
        endTime: item.endTime,
        assetId: item.assetId,
      })),
    },
    checklist: [
      {
        label: "Final MP4 attached",
        done: Boolean(finalVideo),
      },
      {
        label: "All Scene Card videos approved",
        done: scenes.length > 0 && approvedSceneVideos.length >= scenes.length,
      },
      {
        label: "Thumbnail prompt ready",
        done: Boolean(kit?.thumbnailPrompt || kit?.posterPrompt),
      },
      {
        label: `${platform} metadata ready`,
        done: Boolean(metadata.title && metadata.description),
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export function createReleaseOperationPlan(state: StudioState, projectId: string, platform: ReleasePlatform) {
  const bundle = createReleaseBundle(state, projectId, platform);
  const blockers = bundle.checklist.filter((item) => !item.done).map((item) => item.label);
  const ready = blockers.length === 0;

  return {
    schemaVersion: 1,
    operation: "NOX Release Operation",
    platform,
    projectId: bundle.project.id,
    projectTitle: bundle.project.title,
    releaseStatus: bundle.project.releaseStatus,
    ready,
    blockers,
    schedule: bundle.schedule,
    preset: bundle.preset,
    metadata: bundle.metadata,
    thumbnail: bundle.thumbnail,
    files: bundle.files,
    checklist: bundle.checklist,
    steps: [
      {
        label: "Confirm final MP4 and approved Scene Card video manifest",
        done: Boolean(bundle.files.finalVideo) && bundle.files.approvedSceneVideos.length > 0,
      },
      {
        label: `Review ${platform} metadata, thumbnail prompt, and posting window`,
        done: Boolean(bundle.metadata.title && bundle.metadata.description && bundle.thumbnail.prompt),
      },
      {
        label: `Upload or schedule on ${platform}`,
        done: bundle.schedule.status === "Scheduled" || bundle.schedule.status === "Published",
      },
      {
        label: "Archive posted URL and final package in Asset Vault",
        done: bundle.project.releaseStatus === "Published",
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export function exportReleaseBundleJson(state: StudioState, projectId: string, platform: ReleasePlatform) {
  return JSON.stringify(createReleaseBundle(state, projectId, platform), null, 2);
}

export function exportReleaseBundleText(state: StudioState, projectId: string, platform: ReleasePlatform) {
  const bundle = createReleaseBundle(state, projectId, platform);
  return [
    `NOX RELEASE BUNDLE - ${bundle.platform.toUpperCase()}`,
    `Project: ${bundle.project.title}`,
    `Runtime: ${bundle.project.runtime}`,
    `Release status: ${bundle.project.releaseStatus}`,
    `Preset: ${bundle.preset.aspectRatio}, ${bundle.preset.maxDuration}, ${bundle.preset.deliveryFile}`,
    `Schedule: ${bundle.schedule.status}; ${bundle.schedule.recommendedWindow}`,
    "",
    "METADATA",
    `Title: ${bundle.metadata.title}`,
    `Description: ${bundle.metadata.description}`,
    `Hashtags: ${bundle.metadata.hashtags.join(" ")}`,
    `Tags: ${bundle.metadata.tags.join(", ")}`,
    bundle.metadata.pinnedComment ? `Pinned comment: ${bundle.metadata.pinnedComment}` : "",
    "",
    "THUMBNAIL",
    `Prompt: ${bundle.thumbnail.prompt}`,
    `Safe zones: ${bundle.thumbnail.safeZones}`,
    "",
    "FILES",
    `Final video: ${bundle.files.finalVideo?.filename ?? "Missing final MP4"}`,
    `Approved Scene Card videos: ${bundle.files.approvedSceneVideos.length}`,
    `Exports: ${bundle.files.exports.map((asset) => asset.filename).join(", ") || "No release exports archived yet"}`,
    "",
    "CHECKLIST",
    ...bundle.checklist.map((item) => `- [${item.done ? "x" : " "}] ${item.label}`),
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function getReleasePlatformPreset(platform: ReleasePlatform, runtime: string) {
  if (platform === "TikTok") {
    return {
      aspectRatio: "9:16",
      maxDuration: runtime || "60 seconds",
      deliveryFile: "vertical .mp4, h.264, AAC audio",
      captionStyle: "short hook, caption, hashtags, pinned comment",
    };
  }
  if (platform === "YouTube") {
    return {
      aspectRatio: "16:9 or Shorts 9:16",
      maxDuration: runtime || "60 seconds",
      deliveryFile: ".mp4, h.264, AAC audio, high-bitrate master accepted",
      captionStyle: "SEO title, long description, tags, chapters",
    };
  }
  return {
    aspectRatio: "NOX Films adaptive",
    maxDuration: runtime || "60 seconds",
    deliveryFile: "platform master .mp4 plus poster/thumbnail prompts",
    captionStyle: "NOX Films row, genre, runtime, status, creator metadata",
  };
}

function getReleaseMetadata(platform: ReleasePlatform, project: Project | undefined, kit: PublishKit | undefined) {
  if (platform === "TikTok") {
    return {
      title: kit?.tiktokTitle ?? project?.title ?? "Untitled NOX Film",
      description: kit?.caption ?? project?.logline ?? "",
      hashtags: kit?.hashtags ?? [],
      tags: kit?.tags ?? [],
      pinnedComment: kit?.pinnedComment ?? "",
      chapters: [] as string[],
      noxFilmsRow: "",
    };
  }
  if (platform === "YouTube") {
    return {
      title: kit?.youtubeTitle ?? project?.title ?? "Untitled NOX Film",
      description: kit?.description ?? project?.synopsis ?? "",
      hashtags: kit?.hashtags ?? [],
      tags: kit?.tags ?? [],
      pinnedComment: kit?.pinnedComment ?? "",
      chapters: kit?.chapters ?? [],
      noxFilmsRow: "",
    };
  }
  return {
    title: kit?.youtubeTitle ?? project?.title ?? "Untitled NOX Film",
    description: kit?.description ?? project?.synopsis ?? project?.logline ?? "",
    hashtags: kit?.hashtags ?? [],
    tags: kit?.tags ?? [],
    pinnedComment: kit?.pinnedComment ?? "",
    chapters: kit?.chapters ?? [],
    noxFilmsRow: kit?.noxFilmsRow ?? project?.genre ?? "",
  };
}

function getReleaseThumbnail(platform: ReleasePlatform, kit: PublishKit | undefined, project: Project | undefined) {
  return {
    prompt: platform === "NOX Films" ? kit?.posterPrompt ?? kit?.thumbnailPrompt ?? project?.title ?? "" : kit?.thumbnailPrompt ?? kit?.posterPrompt ?? project?.title ?? "",
    safeZones: platform === "TikTok" ? "Keep text away from right-side action rail and lower caption band." : "Keep title and faces clear of platform controls.",
  };
}

function getReleaseWindow(platform: ReleasePlatform) {
  if (platform === "TikTok") return "Post during short-form audience peak; keep status Scheduled until final MP4 and caption are approved.";
  if (platform === "YouTube") return "Schedule after thumbnail, description, tags, and chapters pass review.";
  return "Move to NOX Films Draft, then Scheduled after final master and poster prompt are approved.";
}

function releaseAssetFile(asset: StudioAsset) {
  return {
    id: asset.id,
    filename: asset.filename,
    type: asset.type,
    status: asset.status,
    mimeType: asset.mimeType,
    storagePath: asset.storagePath,
    fileUrl: asset.fileUrl,
    provider: asset.provider,
  };
}

function indentPlainText(value: string, spaces: number) {
  const padding = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${padding}${line}`)
    .join("\n");
}

export function exportEditPlan(state: StudioState, projectId: string) {
  const project = state.projects.find((item) => item.id === projectId);
  const scenes = state.scenes
    .filter((scene) => scene.projectId === projectId)
    .sort((a, b) => a.number - b.number);
  const timeline = state.timelineItems
    .filter((item) => item.projectId === projectId)
    .sort(compareTimelineItems);
  const videoItems = timeline.filter((item) => item.trackType === "video");
  const utilityItems = timeline.filter((item) => item.trackType !== "video");
  const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
  const approvedStatuses = new Set(["Approved", "Added to Timeline", "Rendered", "Published"]);
  const readyScenes = scenes.filter((scene) => {
    const approvedSceneAsset = scene.approvedAssetId ? assetsById.get(scene.approvedAssetId) : undefined;
    const hasApprovedAsset = state.assets.some(
      (asset) => asset.sceneId === scene.id && asset.type === "Video" && asset.status === "Approved",
    );
    return approvedStatuses.has(scene.status) && Boolean(scene.uploadedAsset || approvedSceneAsset || hasApprovedAsset);
  });
  const missingScenes = scenes.filter((scene) => !readyScenes.some((readyScene) => readyScene.id === scene.id));

  return `NOX CUT EDIT PLAN
Project: ${project?.title ?? projectId}
Runtime: ${project?.runtime ?? "Unknown"}
Format: ${project?.format ?? "Unknown"}
Assembly readiness: ${readyScenes.length}/${scenes.length} approved scene videos ready

## Scene Video Track
${scenes
  .map((scene, index) => {
    const item = videoItems.find((timelineItem) => timelineItem.sceneId === scene.id);
    const asset =
      (item?.assetId ? assetsById.get(item.assetId) : undefined) ??
      (scene.approvedAssetId ? assetsById.get(scene.approvedAssetId) : undefined);
    const fallbackAsset =
      state.assets.find((candidate) => candidate.id === scene.approvedAssetId) ??
      state.assets.find((candidate) => candidate.sceneId === scene.id && candidate.type === "Video" && candidate.status === "Approved") ??
      state.assets.find((candidate) => candidate.sceneId === scene.id && candidate.type === "Video");
    const source = asset?.filename ?? fallbackAsset?.filename ?? scene.uploadedAsset ?? "Missing approved video";
    const start = item?.startTime ?? index * scene.durationSeconds;
    const end = item?.endTime ?? start + scene.durationSeconds;
    const trimStart = item?.trimStartNote?.trim() || "Use first clean frame.";
    const trimEnd = item?.trimEndNote?.trim() || "Cut before visual reset or provider artifact.";
    const notes = item?.editorNotes?.trim() || "No additional editor notes.";
    const provider = asset?.provider ?? fallbackAsset?.provider ?? scene.externalProvider ?? scene.promptProvider ?? "Unknown provider";
    const promptId = asset?.promptId ?? fallbackAsset?.promptId ?? scene.id;
    const ready = approvedStatuses.has(scene.status) && source !== "Missing approved video" ? "READY" : "NEEDS VIDEO REVIEW";

    return `${formatTime(start)}-${formatTime(end)} | SCENE ${String(scene.number).padStart(2, "0")} | ${ready}
Title: ${scene.title}
Source: ${source}
Provider lineage: ${provider}
Prompt ID: ${promptId}
Status: ${scene.status}
Transition in: ${item?.transitionIn ?? (index === 0 ? "Blackout Cut" : "Cyberglass Swipe")}
Transition out: ${item?.transitionOut ?? "Signal Glitch"}
Trim start: ${trimStart}
Trim end: ${trimEnd}
Editor notes: ${notes}`;
  })
  .join("\n\n")}

## Utility Tracks
${utilityItems.length
  ? utilityItems
      .map(
        (item) =>
          `${formatTime(item.startTime)}-${formatTime(item.endTime)} | ${item.trackType.toUpperCase()} | ${item.label} | in: ${item.transitionIn} | out: ${item.transitionOut}${item.subtitleText ? ` | subtitles: ${item.subtitleText}` : ""}${item.textOverlay ? ` | overlay: ${item.textOverlay}` : ""}`,
      )
      .join("\n")
  : "No utility tracks added yet."}

## Assembly Warnings
${missingScenes.length
  ? missingScenes.map((scene) => `- Scene ${String(scene.number).padStart(2, "0")} ${scene.title}: ${scene.status}; needs approved 10-second video before final assembly.`).join("\n")
  : "- All Scene Cards have approved videos for V1 assembly."}

Render target: Remotion/FFmpeg V1 later
`;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const displayRest = Number.isInteger(rest) ? String(rest).padStart(2, "0") : rest.toFixed(1).padStart(4, "0");
  return `${minutes}:${displayRest}`;
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
