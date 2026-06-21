import type { StudioAsset } from "../types";

export type DesktopApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type NoxDesktopAsset = {
  id: string;
  filePath: string;
  url: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  workspaceId: string;
  projectId?: string;
  sceneId?: string;
  characterId?: string;
  type: StudioAsset["type"];
  providerModel?: string;
  providerJobId?: string;
  usage?: Record<string, unknown>;
  estimatedCostUsd?: number;
  providerResponseSummary?: Record<string, unknown>;
  width?: number;
  height?: number;
};

export type GrokKeyStatus = {
  providerId: "grok";
  status: "Not configured" | "Verified" | "Saved" | "Invalid" | "Error";
  configured: boolean;
  source: "workspace-secret" | "server-env" | "request" | "local-memory" | "missing" | "desktop-encrypted";
  keyLast4?: string;
  verifiedModel?: string;
  verifiedAt?: string;
  error?: string;
};

export type ImportFileOptions = {
  workspaceId: string;
  projectId?: string;
  sceneId?: string;
  characterId?: string;
  brandFile?: boolean;
  type: StudioAsset["type"];
};

export type ImportFileResult = {
  canceled: boolean;
  asset?: NoxDesktopAsset;
};

export type GenerateStructuredOptions = {
  prompt: string;
  schema?: Record<string, unknown>;
  temperature?: number;
};

export type GenerateTextOptions = {
  prompt: string;
  temperature?: number;
};

export type GenerateMediaOptions = {
  prompt: string;
  workspaceId: string;
  projectId: string;
  sceneId?: string;
  type?: StudioAsset["type"];
};

export type AsyncVideoJob = {
  async: true;
  jobId: string;
  model?: string;
  providerJobId?: string;
  usage?: Record<string, unknown>;
  estimatedCostUsd?: number;
  providerResponseSummary?: Record<string, unknown>;
};

export type RenderJobOptions = {
  manifest: Record<string, unknown>;
  outputFilename?: string;
};

export type OllamaStatus = {
  available: boolean;
  host?: string;
  models?: string[];
  error?: string;
};

export type OllamaGenerateOptions = {
  prompt: string;
  model?: string;
  host?: string;
  system?: string;
};

export type OllamaGenerateResult = {
  text: string;
  model?: string;
  done?: boolean;
  totalDuration?: number;
};

export type YouTubeAuthStatus = {
  connected: boolean;
  expiresAt?: number;
};

export type YouTubeDeviceAuth = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
  clientId: string;
  clientSecret: string;
};

export type YouTubeUploadOptions = {
  title: string;
  description: string;
  tags?: string[];
  categoryId?: string;
  privacyStatus?: "private" | "unlisted" | "public";
  videoPath?: string;
  videoUrl?: string;
};

export type YouTubeUploadResult = {
  videoId: string;
  url: string;
  status?: string;
};

export type ReleasePackageOptions = {
  project: Record<string, unknown>;
  publishKit: Record<string, unknown>;
  platform: string;
  finalExportAsset: Partial<StudioAsset>;
  posterAsset?: Partial<StudioAsset>;
  thumbnailAsset?: Partial<StudioAsset>;
  scenes?: Record<string, unknown>[];
  brandKit?: Record<string, unknown>;
};

export type NoxDesktopApi = {
  isDesktop: true;
  secrets: {
    grokStatus: () => Promise<DesktopApiResult<GrokKeyStatus>>;
    verifyGrokKey: (apiKey: string) => Promise<DesktopApiResult<GrokKeyStatus>>;
    saveGrokKey: (apiKey: string) => Promise<DesktopApiResult<GrokKeyStatus>>;
    removeGrokKey: () => Promise<DesktopApiResult<GrokKeyStatus>>;
  };
  files: {
    importUserFile: (options: ImportFileOptions) => Promise<DesktopApiResult<ImportFileResult>>;
    revealInFolder: (url: string) => Promise<DesktopApiResult<{ ok: boolean; filePath?: string; error?: string }>>;
    openMediaFolder: () => Promise<DesktopApiResult<{ path: string }>>;
    getMediaRoots: () => Promise<DesktopApiResult<{ mediaRoot: string; releasesRoot: string }>>;
  };
  grok: {
    generateStructuredText: (options: GenerateStructuredOptions) => Promise<DesktopApiResult<Record<string, unknown>>>;
    generateText: (options: GenerateTextOptions) => Promise<DesktopApiResult<Record<string, unknown>>>;
    generateImage: (options: GenerateMediaOptions) => Promise<DesktopApiResult<NoxDesktopAsset>>;
    generateVideo: (options: GenerateMediaOptions) => Promise<DesktopApiResult<NoxDesktopAsset | AsyncVideoJob>>;
    pollVideoJob: (options: { jobId: string }) => Promise<DesktopApiResult<NoxDesktopAsset | AsyncVideoJob>>;
    getDefaultModels: () => Promise<Record<string, string>>;
  };
  ollama: {
    status: (host?: string) => Promise<DesktopApiResult<OllamaStatus>>;
    generate: (options: OllamaGenerateOptions) => Promise<DesktopApiResult<OllamaGenerateResult>>;
  };
  youtube: {
    getStatus: () => Promise<DesktopApiResult<YouTubeAuthStatus>>;
    startDeviceAuth: (options: { clientId: string; clientSecret: string }) => Promise<DesktopApiResult<YouTubeDeviceAuth>>;
    pollDeviceToken: (options: { deviceCode: string; clientId: string; clientSecret: string }) => Promise<DesktopApiResult<{ status: string }>>;
    disconnect: () => Promise<DesktopApiResult<YouTubeAuthStatus>>;
    uploadVideo: (options: YouTubeUploadOptions) => Promise<DesktopApiResult<YouTubeUploadResult>>;
  };
  render: {
    runRender: (options: RenderJobOptions) => Promise<DesktopApiResult<{ asset: NoxDesktopAsset }>>;
  };
  publish: {
    createReleasePackage: (options: ReleasePackageOptions) => Promise<DesktopApiResult<Record<string, unknown>>>;
  };
  app: {
    getMediaRoot: () => Promise<DesktopApiResult<{ path: string }>>;
    openMediaFolder: () => Promise<DesktopApiResult<{ path: string }>>;
  };
};

declare global {
  interface Window {
    noxDesktop?: NoxDesktopApi;
  }
}

export function isDesktop(): boolean {
  return Boolean(typeof window !== "undefined" && window.noxDesktop?.isDesktop === true);
}

function unwrap<T>(result: DesktopApiResult<T>): T {
  if (!result.ok) {
    throw new Error(result.error || "Desktop operation failed.");
  }
  return result.data;
}

export const desktopSecrets = {
  grokStatus: async () => unwrap(await window.noxDesktop!.secrets.grokStatus()),
  verifyGrokKey: async (apiKey: string) => unwrap(await window.noxDesktop!.secrets.verifyGrokKey(apiKey)),
  saveGrokKey: async (apiKey: string) => unwrap(await window.noxDesktop!.secrets.saveGrokKey(apiKey)),
  removeGrokKey: async () => unwrap(await window.noxDesktop!.secrets.removeGrokKey()),
};

export const desktopFiles = {
  importUserFile: async (options: ImportFileOptions) => unwrap(await window.noxDesktop!.files.importUserFile(options)),
  revealInFolder: async (url: string) => unwrap(await window.noxDesktop!.files.revealInFolder(url)),
  openMediaFolder: async () => unwrap(await window.noxDesktop!.files.openMediaFolder()),
  getMediaRoots: async () => unwrap(await window.noxDesktop!.files.getMediaRoots()),
};

export const desktopGrok = {
  generateStructuredText: async (options: GenerateStructuredOptions) =>
    unwrap(await window.noxDesktop!.grok.generateStructuredText(options)),
  generateText: async (options: GenerateTextOptions) => unwrap(await window.noxDesktop!.grok.generateText(options)),
  generateImage: async (options: GenerateMediaOptions) => unwrap(await window.noxDesktop!.grok.generateImage(options)),
  generateVideo: async (options: GenerateMediaOptions) => unwrap(await window.noxDesktop!.grok.generateVideo(options)),
  pollVideoJob: async (options: { jobId: string }) => unwrap(await window.noxDesktop!.grok.pollVideoJob(options)),
  getDefaultModels: () => window.noxDesktop!.grok.getDefaultModels(),
};

export const desktopOllama = {
  status: async (host?: string) => unwrap(await window.noxDesktop!.ollama.status(host)),
  generate: async (options: OllamaGenerateOptions) => unwrap(await window.noxDesktop!.ollama.generate(options)),
};

export const desktopYouTube = {
  getStatus: async () => unwrap(await window.noxDesktop!.youtube.getStatus()),
  startDeviceAuth: async (options: { clientId: string; clientSecret: string }) =>
    unwrap(await window.noxDesktop!.youtube.startDeviceAuth(options)),
  pollDeviceToken: async (options: { deviceCode: string; clientId: string; clientSecret: string }) =>
    unwrap(await window.noxDesktop!.youtube.pollDeviceToken(options)),
  disconnect: async () => unwrap(await window.noxDesktop!.youtube.disconnect()),
  uploadVideo: async (options: YouTubeUploadOptions) => unwrap(await window.noxDesktop!.youtube.uploadVideo(options)),
};

export const desktopRender = {
  runRender: async (options: RenderJobOptions) => unwrap(await window.noxDesktop!.render.runRender(options)),
};

export const desktopPublish = {
  createReleasePackage: async (options: ReleasePackageOptions) => unwrap(await window.noxDesktop!.publish.createReleasePackage(options)),
};

export const desktopApp = {
  getMediaRoot: async () => unwrap(await window.noxDesktop!.app.getMediaRoot()),
  openMediaFolder: async () => unwrap(await window.noxDesktop!.app.openMediaFolder()),
};
