import type { Project, SceneBeat, SceneCard } from "../types";

type StorySpineInput = {
  title: string;
  idea: string;
  type: string;
  format: string;
  length: string;
  genre: string;
  tone: string;
  target: string;
};

type StorySpineContext = {
  sceneCount?: number;
  worldName: string;
  leadName: string;
  partnerName: string;
  language: Project["language"];
};

export type StorySceneDraft = Omit<
  SceneCard,
  "id" | "projectId" | "status" | "fullPrompt" | "promptProvider" | "promptCopiedAt" | "uploadedAsset" | "approvedAssetId" | "beats"
> & {
  storyRole: string;
  beats: Array<Omit<SceneBeat, "id">>;
};

const storyRoles = [
  {
    role: "Opening Hook",
    title: "THE IMPOSSIBLE IMAGE",
    purpose: "Grab attention immediately and make the central danger visible in one phone-readable frame.",
    action: "the first impossible sign appears where it should not exist",
    turn: "the lead realizes this is a message, not background noise",
  },
  {
    role: "Inciting Problem",
    title: "THE WARNING ARRIVES",
    purpose: "Turn the hook into a problem the lead must answer now.",
    action: "a warning interrupts the lead's normal path",
    turn: "the partner confirms the signal has consequences",
  },
  {
    role: "Escalation",
    title: "THE ROUTE CHANGES",
    purpose: "Raise pressure through movement, pursuit, or environmental danger.",
    action: "the safest route collapses into a chase or forced shortcut",
    turn: "the lead commits to following the threat instead of escaping it",
  },
  {
    role: "Midpoint Turn",
    title: "THE HIDDEN COST",
    purpose: "Reveal that the conflict is personal, expensive, or tied to the character's past.",
    action: "the signal exposes a private memory or hidden rule",
    turn: "the lead learns the world has been lying about the threat",
  },
  {
    role: "Crisis",
    title: "THE CHOICE POINT",
    purpose: "Force a clear decision with no clean exit.",
    action: "the antagonist pressure corners the characters",
    turn: "the lead chooses the risky truth over temporary safety",
  },
  {
    role: "Final Reveal",
    title: "THE DOOR ANSWERS",
    purpose: "Pay off the short film with a final image that feels complete and teases what comes next.",
    action: "the story object responds and opens the next mystery",
    turn: "the final frame changes the meaning of the whole film",
  },
  {
    role: "Aftershock",
    title: "THE CROWD SEES IT",
    purpose: "Show that the private discovery is spreading into the public world.",
    action: "bystanders react as the event becomes impossible to hide",
    turn: "the lead understands the story has escaped containment",
  },
  {
    role: "False Answer",
    title: "THE WRONG SOLUTION",
    purpose: "Offer a tempting explanation, then break it.",
    action: "a simple explanation seems to solve the event",
    turn: "one visual contradiction proves the answer is false",
  },
  {
    role: "Point of No Return",
    title: "THE LINE CROSSED",
    purpose: "Make the lead cross into a new operating reality.",
    action: "the character enters the space everyone else avoids",
    turn: "the way back visibly closes",
  },
  {
    role: "Truth Under Pressure",
    title: "THE SIGNAL SPEAKS",
    purpose: "Let the central mystery communicate in a way that changes the mission.",
    action: "a message becomes clear through pressure, rhythm, or motion",
    turn: "the lead gets an instruction they cannot ignore",
  },
  {
    role: "Sacrifice Beat",
    title: "THE PRICE PAID",
    purpose: "Attach emotional weight to the choice before the ending.",
    action: "one useful thing is lost to keep the mission alive",
    turn: "the loss makes the final reveal feel earned",
  },
  {
    role: "Release Hook",
    title: "THE NEXT SIGNAL",
    purpose: "End with a direct release hook for the next clip, episode, or full film.",
    action: "a new sign appears after the apparent ending",
    turn: "the audience sees the next story before the characters do",
  },
];

const locationPatterns = [
  "an exposed street-level opening in {world}",
  "a cramped transit route under {world}",
  "a crowded public threshold with witnesses",
  "a private room full of evidence and reflections",
  "a high-risk crossing point lit by emergency color",
  "the final sealed location where the mystery answers",
  "a public plaza or feed wall where the event spreads",
  "a false safe room that visually contradicts itself",
  "a boundary door, bridge, elevator, or tunnel entrance",
  "a communications node where the message becomes legible",
  "a damaged shelter or vehicle where something must be left behind",
  "a final wide exterior that reveals the next threat",
];

const visualMoves = [
  "start wide, then crash into one readable silhouette",
  "track beside the character while the warning invades the frame",
  "use forward motion and lateral danger without cutting locations",
  "push into a reflective close-up where memory and present overlap",
  "hold the frame steady while pressure closes in from both sides",
  "tilt from human reaction to the impossible reveal",
  "pan from the lead to public witnesses reacting in sequence",
  "frame the false answer cleanly, then let one detail ruin it",
  "follow one continuous threshold crossing with no reset",
  "let light pulses translate into visible communication",
  "drop sound and simplify the frame around the emotional cost",
  "end on a clean hook image with strong negative space",
];

const audioMotifs = [
  "a hard low hit followed by wet ambience and a thin signal pulse",
  "close breath, distant crowd noise, and one warning tone",
  "fast footfalls, rising bass, and environmental alarms",
  "muffled room tone, memory glitches, and a quiet vocal texture",
  "tight heartbeat percussion and pressure-building silence",
  "the signal blooms into a clean final chord, then cuts",
  "public murmurs swell into synchronized silence",
  "the safe-room tone detunes as the lie breaks",
  "metal movement, one door tone, and bass pulled backward",
  "coded pulses resolve into a clear voice-like rhythm",
  "sound drops out except one object hit and one breath",
  "final bass rise, glassy shimmer, and abrupt hook silence",
];

const dialogueLines = [
  "Mira eso. No es normal.",
  "No lo sigas si no quieres que te encuentre.",
  "Ya cambio de ruta. Corre.",
  "Esto estaba aqui desde antes de nosotros.",
  "Si abrimos eso, no hay vuelta.",
  "Ahora si nos respondio.",
  "Todos lo estan viendo.",
  "Esa respuesta es mentira.",
  "Cuando cruces, no mires atras.",
  "La senal esta diciendo mi nombre.",
  "Dejamos esto o no salimos.",
  "Entonces apenas empezo.",
];

export function getSceneCountForLength(length: string) {
  const sceneMatch = length.match(/(\d+)\s*scene/i);
  if (sceneMatch) return Math.max(1, Number(sceneMatch[1]));

  const seconds = Number(length.match(/\d+/)?.[0] ?? 60);
  if (seconds <= 30) return 3;
  if (seconds <= 60) return 6;
  if (seconds <= 90) return 9;
  if (seconds <= 120) return 12;
  return Math.max(3, Math.round(seconds / 10));
}

export function createStorySpine(input: StorySpineInput, context: StorySpineContext): StorySceneDraft[] {
  const sceneCount = context.sceneCount ?? getSceneCountForLength(input.length);
  const ideaSubject = extractStorySubject(input.idea);
  const sceneDuration = Math.max(6, Math.round(extractRuntimeSeconds(input.length) / sceneCount));

  return Array.from({ length: sceneCount }, (_, index) => {
    const number = index + 1;
    const role = storyRoles[index % storyRoles.length];
    const location = formatLocation(locationPatterns[index % locationPatterns.length], context.worldName, ideaSubject);
    const characters = number === 1 || number % 3 === 0 ? [context.leadName] : [context.leadName, context.partnerName];
    const summary = `${role.role}: ${role.action} around ${ideaSubject}, forcing ${context.leadName} toward ${role.turn}.`;
    const visualStyle = [
      `Hyperrealistic ${input.genre.toLowerCase()} short film frame`,
      input.tone,
      context.worldName,
      visualMoves[index % visualMoves.length],
      "clear subject continuity",
      "phone-readable composition",
    ].join(", ");
    const audio = audioMotifs[index % audioMotifs.length];
    const dialogue = `${characters[characters.length - 1]} says in ${context.language.dialogueLanguage}: "${dialogueLines[index % dialogueLines.length]}"`;
    const beatSeed = buildBeatSeed(role, input, context, number, location, ideaSubject);

    return {
      storyRole: role.role,
      number,
      title: role.title,
      purpose: role.purpose,
      durationSeconds: sceneDuration,
      output: "One generated video",
      format: input.format,
      location,
      characters,
      mood: `${input.tone}; ${role.role.toLowerCase()} energy`,
      visualStyle,
      summary,
      beats: beatSeed,
      dialogue,
      audio,
      externalProvider: input.target,
      negativePrompt: [
        "No duplicate scene action",
        "no random extra characters",
        "no location reset inside the clip",
        "no cartoon style",
        "no distorted face",
        "no unreadable text",
        "no sudden costume change",
      ].join(", "),
      continuityRules: [
        `Scene role: ${role.role}. Do not reuse the same action as another Scene Card.`,
        `Keep ${characters.join(" and ")} visually consistent.`,
        `Keep this scene in ${location}.`,
        "Every beat must fit inside one continuous generated clip.",
      ],
    };
  });
}

function buildBeatSeed(
  role: (typeof storyRoles)[number],
  input: StorySpineInput,
  context: StorySpineContext,
  number: number,
  location: string,
  ideaSubject: string,
): Array<Omit<SceneBeat, "id">> {
  const beatTitle = role.role.replace(/\s+/g, " ");
  return [
    {
      range: "0-3s",
      title: `${beatTitle} image`,
      description: `Open Scene ${number} on ${location}; ${role.action} is visible through ${ideaSubject}.`,
      camera: visualMoves[(number - 1) % visualMoves.length],
      audio: audioMotifs[(number - 1) % audioMotifs.length],
    },
    {
      range: "3-7s",
      title: `${beatTitle} pressure`,
      description: `${context.leadName} reacts to ${role.turn}; the action is specific to this scene and does not repeat another beat.`,
      camera: number % 2 === 0 ? "medium handheld follow with one decisive push-in" : "controlled dolly move into a readable close-up",
      audio: `Rising ${input.genre.toLowerCase()} tension with ${context.language.voiceStyle} dialogue space.`,
      dialogue: `${number % 3 === 0 ? context.leadName : context.partnerName} says in ${context.language.dialogueLanguage}: "${dialogueLines[(number - 1) % dialogueLines.length]}"`,
    },
    {
      range: "7-10s",
      title: `${beatTitle} hook`,
      description: `End on a clean hook frame where ${ideaSubject} changes state and points to the next scene.`,
      camera: "hold the final frame long enough to read the reveal on a phone",
      audio: "single final impact, then a short tail for the cut",
    },
  ];
}

function extractRuntimeSeconds(length: string) {
  return Number(length.match(/\d+/)?.[0] ?? 60);
}

function extractStorySubject(idea: string) {
  const subjectSource = idea.match(/\babout\s+(.+)/i)?.[1] ?? idea;
  const stopWords = new Set([
    "about",
    "shortfilm",
    "short",
    "film",
    "street",
    "level",
    "sci",
    "fi",
    "with",
    "that",
    "this",
    "from",
    "inside",
    "into",
    "over",
    "under",
    "where",
    "while",
    "when",
  ]);
  const cleanIdea = subjectSource
    .replace(/[^\w\s-]/g, " ")
    .split(/[\s-]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 2 && !stopWords.has(word));
  return cleanIdea.slice(0, 6).join(" ") || "the central signal";
}

function formatLocation(pattern: string, worldName: string, ideaSubject: string) {
  return pattern.replace("{world}", worldName).replace("{subject}", ideaSubject);
}
