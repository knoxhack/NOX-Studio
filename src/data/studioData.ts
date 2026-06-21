import {
  BarChart3,
  Clapperboard,
  Command,
  FolderKanban,
  Library,
  PenTool,
  Rocket,
  Scissors,
  Settings,
  Sparkles,
} from "lucide-react";
import type {
  CharacterProfile,
  FactionEntry,
  GenerationJob,
  LocationEntry,
  NavItem,
  Project,
  Provider,
  PublishKit,
  SceneCard,
  SceneStatus,
  StudioAsset,
  StudioState,
  TimelineItem,
  WorldEntry,
} from "../types";

export const navItems: NavItem[] = [
  { key: "command", label: "Command Center", icon: Command },
  { key: "projects", label: "Projects", icon: FolderKanban },
  { key: "create", label: "Create", icon: Sparkles },
  { key: "scene", label: "Scene Composer", icon: Clapperboard },
  { key: "script", label: "Script Room", icon: PenTool },
  { key: "vault", label: "Vault", icon: Library },
  { key: "cut", label: "NOX Cut", icon: Scissors },
  { key: "publish", label: "Publish", icon: Rocket },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: Settings },
];

export const mobileNavKeys = ["command", "create", "scene", "vault", "cut"] as const;

export const statusTone: Record<SceneStatus | string, string> = {
  Draft: "neutral",
  "Prompt Ready": "cyan",
  "Generating Video": "purple",
  "Video Uploaded": "blue",
  "Needs Redo": "warning",
  Approved: "success",
  "Added to Timeline": "timeline",
  Rendered: "magenta",
  Published: "success",
  Idea: "neutral",
  "Script Ready": "blue",
  "Scene Prompts Ready": "cyan",
  "Generating Videos": "purple",
  Editing: "magenta",
  "Ready to Publish": "success",
  "Scene Videos Needed": "warning",
  "Publish Kit Ready": "success",
  Stored: "blue",
  Queued: "neutral",
  Running: "purple",
  Completed: "success",
  Failed: "danger",
  Rejected: "danger",
  "Needs Review": "warning",
};

export const quickActions = [
  "New Shortfilm",
  "New Episode",
  "New Season",
  "New Music Video",
  "New Trailer",
  "New Character",
  "New World",
  "Upload Clips",
  "Open Editor",
  "Generate Publish Kit",
];

export const initialProjects: Project[] = [];
export const initialScenes: SceneCard[] = [];
export const assets: StudioAsset[] = [];
export const characters: CharacterProfile[] = [];
export const worlds: WorldEntry[] = [];
export const locations: LocationEntry[] = [];
export const factions: FactionEntry[] = [];
export const generationJobs: GenerationJob[] = [];
export const publishKits: PublishKit[] = [];
export const initialTimelineItems: TimelineItem[] = [];

export const providers: Provider[] = [
  {
    id: "manual",
    name: "Manual Mode",
    supportedTasks: "Copy prompts, upload generated clips",
    speed: "User-paced",
    quality: "Provider-dependent",
    enabled: true,
    mode: "Manual",
    connectionStatus: "Configured",
  },
  {
    id: "grok",
    name: "Grok",
    supportedTasks: "Story, prompts, continuity, metadata, images, and videos",
    speed: "Fast",
    quality: "High",
    enabled: false,
    mode: "API",
    apiEndpoint: "https://api.x.ai/v1",
    secretName: "",
    webhookEnabled: false,
    connectionStatus: "Not configured",
    config: {
      textModel: "grok-4.3",
      imageModel: "grok-imagine-image-quality",
      videoModel: "grok-imagine-video",
    },
  },
  {
    id: "ollama",
    name: "Local Ollama",
    supportedTasks: "Private notes, offline rewrites",
    speed: "Local",
    quality: "Variable",
    enabled: false,
    mode: "Local",
    connectionStatus: "Not configured",
  },
];

export const initialStudioState: StudioState = {
  schemaVersion: 4,
  user: {
    id: "user-knox",
    email: "knox@noxfilms.studio",
    name: "Knox",
  },
  workspace: {
    id: "workspace-nox",
    name: "NOX Films",
    ownerId: "user-knox",
    plan: "Studio",
  },
  projects: initialProjects,
  scenes: initialScenes,
  assets,
  characters,
  worlds,
  locations,
  factions,
  generationJobs,
  providers,
  publishKits,
  timelineItems: initialTimelineItems,
  brandKit: {
    studioName: "NOX Films",
    creatorName: "NOX Studio",
    introText: "A NOX Films Original",
    outroText: "Watch more on NOX Films",
    defaultStyle: "Futuristic cyberglass cinematic",
    defaultExport: "9:16 TikTok + 16:9 YouTube",
    subtitleStyle: "Bold white cinematic subtitles with shadow",
    colors: ["Neon blue", "Purple", "Black", "Cyan"],
    hashtags: ["#NOXFilms", "#Cyberglass", "#AIFilm"],
  },
};
