import type { LucideIcon } from "lucide-react";

export type ViewKey =
  | "command"
  | "projects"
  | "create"
  | "scene"
  | "script"
  | "vault"
  | "cut"
  | "publish"
  | "analytics"
  | "settings";

export type SceneStatus =
  | "Draft"
  | "Prompt Ready"
  | "Generating Video"
  | "Video Uploaded"
  | "Needs Redo"
  | "Approved"
  | "Added to Timeline"
  | "Rendered"
  | "Published";

export type ProjectStatus =
  | "Idea"
  | "Script Ready"
  | "Scene Prompts Ready"
  | "Generating Videos"
  | "Editing"
  | "Ready to Publish"
  | "Published";

export type NavItem = {
  key: ViewKey;
  label: string;
  icon: LucideIcon;
};

export type StudioUser = {
  id: string;
  email: string;
  name: string;
};

export type Workspace = {
  id: string;
  name: string;
  ownerId: string;
  plan: "Creator" | "Studio" | "Pro";
};

export type LanguageSettings = {
  promptLanguage: string;
  dialogueLanguage: string;
  subtitles: string;
  voiceStyle: string;
};

export type Project = {
  id: string;
  workspaceId: string;
  title: string;
  type: string;
  format: string;
  runtime: string;
  sceneCount: number;
  generatedScenes: number;
  status: ProjectStatus | "Scene Videos Needed" | "Publish Kit Ready";
  nextStep: string;
  genre: string;
  tone: string;
  world: string;
  mainCharacters: string[];
  idea: string;
  aiTarget: string;
  language: LanguageSettings;
  logline: string;
  synopsis: string;
  releaseStatus: "Studio Draft" | "NOX Films Draft" | "Scheduled" | "Published" | "Unlisted" | "Private" | "Archived";
  updatedAt: string;
  posterTone: "cyan" | "purple" | "magenta" | "green" | "gold";
};

export type SceneBeat = {
  id: string;
  range: string;
  title: string;
  description: string;
  camera: string;
  audio: string;
  dialogue?: string;
};

export type SceneCard = {
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
  status: SceneStatus;
  uploadedAsset?: string;
  approvedAssetId?: string;
};

export type StudioAsset = {
  id: string;
  workspaceId: string;
  projectId?: string;
  sceneId?: string;
  characterId?: string;
  filename: string;
  type: "Video" | "Image" | "Audio" | "Poster" | "Prompt Export" | "Final Export" | "Brand File";
  fileUrl?: string;
  storagePath?: string;
  mimeType?: string;
  attachedTo: string;
  status: "Approved" | "Needs Review" | "Draft" | "Rejected" | "Stored";
  provider: string;
  duration?: string;
  promptId?: string;
  promptUsed?: string;
  externalJobId?: string;
  providerModel?: string;
  providerResponse?: Record<string, unknown>;
  width?: number;
  height?: number;
  notes: string;
  tags: string[];
  createdAt: string;
};

export type CharacterProfile = {
  id: string;
  workspaceId: string;
  name: string;
  alias: string;
  role: string;
  personality: string;
  backstory: string;
  voice: string;
  accent: string;
  wardrobeRules: string[];
  visualIdentity: string;
  referenceImageUrl?: string;
  promptIdentity: string;
  negativeRules: string[];
  appearsIn: string[];
};

export type WorldEntry = {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  tone: string;
  locations: string[];
  visualRules: string[];
  technology: string[];
  factions: string[];
  recurringSymbols: string[];
  timeline: string[];
};

export type LocationEntry = {
  id: string;
  workspaceId: string;
  worldId?: string;
  name: string;
  description: string;
  visualRules: string[];
  timelineNotes: string[];
};

export type FactionEntry = {
  id: string;
  workspaceId: string;
  worldId?: string;
  name: string;
  description: string;
  visualRules: string[];
  negativeRules: string[];
  timelineNotes: string[];
};

export type ContinuityIssue = {
  id: string;
  severity: "Pass" | "Warning" | "Missing";
  scope: "Character" | "World" | "Location" | "Faction" | "Timeline";
  label: string;
  message: string;
  rule?: string;
};

export type ContinuityReport = {
  sceneId: string;
  status: "Pass" | "Needs Review";
  summary: string;
  matchedCharacters: string[];
  matchedWorlds: string[];
  matchedLocations: string[];
  matchedFactions: string[];
  issues: ContinuityIssue[];
};

export type GenerationJob = {
  id: string;
  workspaceId: string;
  projectId?: string;
  sceneId?: string;
  task: string;
  project: string;
  provider: string;
  status: "Queued" | "Running" | "Completed" | "Failed" | "Needs Review" | "Approved";
  cost: string;
  costActual?: number;
  costCurrency?: string;
  usageMetadata?: Record<string, unknown>;
  providerJobId?: string;
  providerResponse?: Record<string, unknown>;
  inputPayload: string;
  outputPayload?: string;
  errorMessage?: string;
  retryCount?: number;
  maxRetries?: number;
  logs?: string[];
  priority?: number;
  runAfter?: string;
  lockedAt?: string;
  lockedBy?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
};

export type Provider = {
  id: string;
  name: string;
  supportedTasks: string;
  speed: string;
  quality: string;
  enabled: boolean;
  mode: "API" | "Manual" | "Local";
  apiEndpoint?: string;
  secretName?: string;
  webhookEnabled?: boolean;
  connectionStatus?: "Not configured" | "Configured" | "Secret missing" | "Error";
  config?: Record<string, unknown>;
};

export type PublishKit = {
  id: string;
  projectId: string;
  tiktokTitle: string;
  caption: string;
  hashtags: string[];
  hookLine: string;
  pinnedComment: string;
  youtubeTitle: string;
  description: string;
  tags: string[];
  chapters: string[];
  noxFilmsRow: string;
  runtime: string;
  genre: string;
  releaseStatus: Project["releaseStatus"];
  thumbnailPrompt: string;
  posterPrompt: string;
  updatedAt: string;
};

export type TimelineItem = {
  id: string;
  projectId: string;
  sceneId?: string;
  assetId?: string;
  trackType: "video" | "audio" | "subtitle" | "overlay" | "title" | "transition";
  label: string;
  startTime: number;
  endTime: number;
  orderIndex: number;
  transitionIn: string;
  transitionOut: string;
  textOverlay?: string;
  subtitleText?: string;
  trimStartNote?: string;
  trimEndNote?: string;
  editorNotes?: string;
};

export type BrandKit = {
  studioName: string;
  creatorName: string;
  introText: string;
  outroText: string;
  watermarkAssetId?: string;
  watermarkAssetUrl?: string;
  watermarkStoragePath?: string;
  watermarkFilename?: string;
  defaultStyle: string;
  defaultExport: string;
  subtitleStyle: string;
  colors: string[];
  hashtags: string[];
};

export type StudioState = {
  schemaVersion: number;
  user: StudioUser;
  workspace: Workspace;
  projects: Project[];
  scenes: SceneCard[];
  assets: StudioAsset[];
  characters: CharacterProfile[];
  worlds: WorldEntry[];
  locations: LocationEntry[];
  factions: FactionEntry[];
  generationJobs: GenerationJob[];
  providers: Provider[];
  publishKits: PublishKit[];
  timelineItems: TimelineItem[];
  brandKit: BrandKit;
};

export type ProductionPackage = {
  project: Project;
  scenes: SceneCard[];
  characters: CharacterProfile[];
  worlds: WorldEntry[];
  locations: LocationEntry[];
  factions: FactionEntry[];
  publishKit: PublishKit;
  timelineItems: TimelineItem[];
  generationJobs: GenerationJob[];
};
