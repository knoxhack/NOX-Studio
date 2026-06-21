import electron from "electron";
const { dialog, shell } = electron;
import {
  getGrokStatus,
  verifyGrokKey,
  saveGrokKey,
  removeGrokKey,
  loadGrokKey,
} from "./secrets-store.mjs";
import {
  importUserFile,
  saveAsset,
  resolveNoxMediaUrl,
  buildNoxMediaUrl,
  getMediaRoot,
  getReleasesRoot,
  parseNoxMediaUrl,
  isPathUnderMediaRoot,
} from "./media-store.mjs";
import {
  generateStructuredText,
  generateText,
  generateImage,
  generateVideo,
  pollVideoJob,
  estimateCost,
  getDefaultModels,
} from "./xai-client.mjs";
import { runLocalRender } from "./render-service.mjs";
import { createLocalReleasePackage } from "./publish-service.mjs";
import { ollamaStatus, ollamaGenerate } from "./ollama-client.mjs";
import {
  getYouTubeAuthStatus,
  startYouTubeDeviceAuth,
  pollYouTubeDeviceToken,
  disconnectYouTube,
  uploadYouTubeVideo,
} from "./youtube-service.mjs";

export const defaultModels = getDefaultModels();

export async function grokStatus() {
  return getGrokStatus();
}

export async function grokVerify(apiKey) {
  return verifyGrokKey(apiKey);
}

export async function grokSave(apiKey) {
  return saveGrokKey(apiKey);
}

export async function grokRemove() {
  return removeGrokKey();
}

export async function grokGenerateStructured({ prompt, schema, temperature = 0.7 }) {
  const apiKey = await loadGrokKey();
  if (!apiKey) throw new Error("Grok API key is not configured.");
  const result = await generateStructuredText(apiKey, {
    prompt,
    schema,
    model: defaultModels.text,
    temperature,
  });
  return {
    ...result,
    estimatedCostUsd: estimateCost(defaultModels.text, result.usage),
  };
}

export async function grokGenerateText({ prompt, temperature = 0.7 }) {
  const apiKey = await loadGrokKey();
  if (!apiKey) throw new Error("Grok API key is not configured.");
  const result = await generateText(apiKey, { prompt, model: defaultModels.text, temperature });
  return {
    ...result,
    estimatedCostUsd: estimateCost(defaultModels.text, result.usage),
  };
}

export async function grokGenerateImage({ prompt, workspaceId, projectId, sceneId, type = "Image" }) {
  const apiKey = await loadGrokKey();
  if (!apiKey) throw new Error("Grok API key is not configured.");
  const result = await generateImage(apiKey, { prompt, model: defaultModels.image });
  const assetType = resolveImageAssetType(type, prompt);
  const asset = await saveAsset({
    workspaceId,
    projectId,
    sceneId,
    type: assetType,
    filename: `${assetType.toLowerCase()}-${Date.now()}.png`,
    mimeType: result.mimeType,
    buffer: result.buffer,
  });
  return {
    ...asset,
    providerModel: result.model,
    providerJobId: result.providerJobId,
    usage: result.usage,
    estimatedCostUsd: estimateCost(result.model, result.usage),
    providerResponseSummary: result.providerResponseSummary,
    width: result.width,
    height: result.height,
  };
}

export async function grokGenerateVideo({ prompt, workspaceId, projectId, sceneId }) {
  const apiKey = await loadGrokKey();
  if (!apiKey) throw new Error("Grok API key is not configured.");
  const result = await generateVideo(apiKey, { prompt, model: defaultModels.video });

  if (result.async) {
    return {
      async: true,
      jobId: result.jobId,
      model: result.model,
      providerJobId: result.providerJobId,
      usage: result.usage,
      estimatedCostUsd: estimateCost(result.model, result.usage),
      providerResponseSummary: result.providerResponseSummary,
    };
  }

  const asset = await saveAsset({
    workspaceId,
    projectId,
    sceneId,
    type: "Video",
    filename: `scene-video-${Date.now()}.mp4`,
    mimeType: result.mimeType,
    buffer: result.buffer,
  });

  return {
    ...asset,
    providerModel: result.model,
    providerJobId: result.providerJobId,
    usage: result.usage,
    estimatedCostUsd: estimateCost(result.model, result.usage),
    providerResponseSummary: result.providerResponseSummary,
  };
}

export async function grokPollVideoJob({ jobId }) {
  const apiKey = await loadGrokKey();
  if (!apiKey) throw new Error("Grok API key is not configured.");
  const result = await pollVideoJob(apiKey, jobId, { maxAttempts: 60, intervalMs: 5000 });

  if (result.status !== "completed") {
    return {
      async: true,
      status: result.status,
      jobId,
      model: result.model,
      providerJobId: result.providerJobId,
      usage: result.usage,
      providerResponseSummary: result.providerResponseSummary,
    };
  }

  // workspaceId/projectId/sceneId are not passed here; caller can relocate asset if needed.
  // We return buffer for the caller to save via saveAsset with full metadata.
  return {
    async: false,
    completed: true,
    buffer: result.buffer,
    mimeType: result.mimeType,
    model: result.model,
    providerJobId: result.providerJobId,
    usage: result.usage,
    estimatedCostUsd: estimateCost(result.model, result.usage),
    providerResponseSummary: result.providerResponseSummary,
  };
}

export async function pickAndImportFile({ workspaceId, projectId, sceneId, characterId, brandFile, type }) {
  const properties = ["openFile"];
  const filters = [];
  if (type === "Video") filters.push({ name: "Videos", extensions: ["mp4", "mov", "webm", "mkv"] });
  if (type === "Image" || type === "Poster") filters.push({ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] });
  if (type === "Audio") filters.push({ name: "Audio", extensions: ["mp3", "wav", "ogg", "aac", "m4a"] });
  if (type === "Brand File") filters.push({ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] });

  const result = await dialog.showOpenDialog({
    properties,
    filters: filters.length ? filters : [{ name: "All Files", extensions: ["*"] }],
  });

  if (result.canceled || !result.filePaths?.length) {
    return { canceled: true };
  }

  const sourcePath = result.filePaths[0];
  const imported = await importUserFile(sourcePath, {
    workspaceId,
    projectId,
    sceneId,
    characterId,
    brandFile,
    type,
    filename: sourcePath.split(/[\\/]/).pop(),
  });

  return { canceled: false, asset: imported };
}

export async function revealAssetInFolder(url) {
  if (!url) return { ok: false, error: "No asset URL provided." };
  const filePath = await resolveNoxMediaUrl(url);
  if (!filePath) return { ok: false, error: "Asset file not found." };
  shell.showItemInFolder(filePath);
  return { ok: true, filePath };
}

export async function openMediaFolder() {
  const root = getMediaRoot();
  await shell.openPath(root);
  return { path: root };
}

export async function runRenderJob({ manifest, outputFilename }) {
  return runLocalRender(undefined, manifest?.projectId, { manifest, outputFilename });
}

export async function createReleasePackage(args) {
  return createLocalReleasePackage(args);
}

export async function getMediaRoots() {
  return { mediaRoot: getMediaRoot(), releasesRoot: getReleasesRoot() };
}

export async function ollamaCheckStatus(host) {
  return ollamaStatus(host);
}

export async function ollamaGenerateText({ prompt, model, host, system }) {
  return ollamaGenerate({ prompt, model, host, system });
}

export async function youtubeGetStatus() {
  return getYouTubeAuthStatus();
}

export async function youtubeStartDeviceAuth({ clientId, clientSecret }) {
  return startYouTubeDeviceAuth({ clientId, clientSecret });
}

export async function youtubePollDeviceToken({ deviceCode, clientId, clientSecret }) {
  return pollYouTubeDeviceToken({ deviceCode, clientId, clientSecret });
}

export async function youtubeDisconnect() {
  return disconnectYouTube();
}

export async function youtubeUploadVideo({ title, description, tags, categoryId, privacyStatus, videoPath }) {
  return uploadYouTubeVideo({ title, description, tags, categoryId, privacyStatus, videoPath });
}

function resolveImageAssetType(type, prompt) {
  const text = `${type || ""} ${prompt || ""}`.toLowerCase();
  if (text.includes("poster")) return "Poster";
  if (text.includes("brand")) return "Brand File";
  return "Image";
}
