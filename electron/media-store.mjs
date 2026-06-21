import electron from "electron";
const { app } = electron;
import { mkdir, readFile, writeFile, copyFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const DEV_MEDIA_ROOT = "C:\\Development\\Github\\NOX-Studio\\.nox-local\\media";

export function getMediaRoot() {
  if (process.env.NOX_LOCAL_MEDIA_ROOT) {
    return resolve(process.env.NOX_LOCAL_MEDIA_ROOT);
  }
  if (app.isPackaged) {
    return resolve(join(app.getPath("userData"), "media"));
  }
  return resolve(DEV_MEDIA_ROOT);
}

export function getReleasesRoot() {
  if (process.env.NOX_LOCAL_RELEASES_ROOT) {
    return resolve(process.env.NOX_LOCAL_RELEASES_ROOT);
  }
  const mediaRoot = getMediaRoot();
  return resolve(join(dirname(mediaRoot), "releases"));
}

const typeFolders = {
  Video: "videos",
  Image: "images",
  Audio: "audio",
  Poster: "images",
  "Prompt Export": "exports",
  "Final Export": "exports",
  "Brand File": "brand",
};

function folderForType(type) {
  return typeFolders[type] || "files";
}

export function sanitizeFilename(filename) {
  const rawName = String(filename || "file").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "file";
  const dotIndex = rawName.lastIndexOf(".");
  const stem = dotIndex > 0 ? rawName.slice(0, dotIndex) : rawName;
  const extension = dotIndex > 0 ? rawName.slice(dotIndex).toLowerCase() : "";
  const safeStem = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "file";
  const safeExtension = extension.replace(/[^a-z0-9.]/g, "").slice(0, 24);
  return { stem: safeStem, extension: safeExtension };
}

export function extensionFromMime(mimeType) {
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/aac": ".aac",
    "text/plain": ".txt",
    "application/json": ".json",
    "text/markdown": ".md",
    "text/srt": ".srt",
  };
  return map[mimeType] || "";
}

export function makeSafeObjectName(filename, mimeType) {
  const { stem, extension } = sanitizeFilename(filename);
  const ext = extension || extensionFromMime(mimeType) || ".bin";
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}-${stem}${ext}`;
}

function buildFolderPath({ workspaceId, projectId, characterId, type }) {
  const root = getMediaRoot();
  if (characterId) {
    return join(root, sanitizeSegment(workspaceId), "characters", sanitizeSegment(characterId));
  }
  if (type === "Brand File") {
    return join(root, sanitizeSegment(workspaceId), "brand");
  }
  if (projectId) {
    return join(root, sanitizeSegment(workspaceId), sanitizeSegment(projectId), folderForType(type));
  }
  return join(root, sanitizeSegment(workspaceId), folderForType(type));
}

function sanitizeSegment(segment) {
  return String(segment || "_")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 64);
}

export async function ensureDirectory(dirPath) {
  await mkdir(dirPath, { recursive: true });
  return dirPath;
}

export async function saveAsset({ workspaceId, projectId, sceneId, characterId, type, filename, mimeType, buffer }) {
  const safeName = makeSafeObjectName(filename, mimeType);
  const folderPath = buildFolderPath({ workspaceId, projectId, characterId, type });
  await ensureDirectory(folderPath);
  const filePath = join(folderPath, safeName);
  await writeFile(filePath, buffer);

  const assetId = randomUUID();
  const url = buildNoxMediaUrl(assetId, safeName);
  const storagePath = buildStoragePath({ workspaceId, projectId, characterId, type, filename: safeName });

  return {
    id: assetId,
    filePath,
    url,
    storagePath,
    filename: safeName,
    mimeType: mimeType || "application/octet-stream",
    workspaceId,
    projectId,
    sceneId,
    characterId,
    type,
  };
}

export async function importUserFile(sourcePath, { workspaceId, projectId, sceneId, characterId, brandFile, type, filename }) {
  const resolvedSource = resolve(sourcePath);
  if (!existsSync(resolvedSource)) {
    throw new Error(`Source file does not exist: ${sourcePath}`);
  }

  const originalName = filename || sourcePath.split(/[\\/]/).pop() || "import";
  const safeName = makeSafeObjectName(originalName, undefined);
  const folderPath = buildFolderPath({ workspaceId, projectId, characterId, type });
  await ensureDirectory(folderPath);
  const filePath = join(folderPath, safeName);
  await copyFile(resolvedSource, filePath);

  const assetId = randomUUID();
  const url = buildNoxMediaUrl(assetId, safeName);
  const storagePath = buildStoragePath({ workspaceId, projectId, characterId, type, filename: safeName });

  return {
    id: assetId,
    filePath,
    url,
    storagePath,
    filename: safeName,
    mimeType: inferMimeType(safeName),
    workspaceId,
    projectId,
    sceneId,
    characterId,
    type,
  };
}

export function buildNoxMediaUrl(assetId, filename) {
  return `nox-media://asset/${assetId}/${filename}`;
}

function buildStoragePath({ workspaceId, projectId, characterId, type, filename }) {
  if (characterId) {
    return [workspaceId, "characters", characterId, filename].join("/");
  }
  if (type === "Brand File") {
    return [workspaceId, "brand", filename].join("/");
  }
  if (projectId) {
    return [workspaceId, projectId, folderForType(type), filename].join("/");
  }
  return [workspaceId, folderForType(type), filename].join("/");
}

function inferMimeType(filename) {
  const ext = extname(filename).toLowerCase();
  const map = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".aac": "audio/aac",
    ".txt": "text/plain",
    ".json": "application/json",
    ".md": "text/markdown",
    ".srt": "text/srt",
  };
  return map[ext] || "application/octet-stream";
}

export async function resolveNoxMediaUrl(url) {
  if (!url || typeof url !== "string") return undefined;
  if (!url.startsWith("nox-media://")) return undefined;

  const parsed = parseNoxMediaUrl(url);
  if (!parsed) return undefined;

  const root = getMediaRoot();
  const candidates = await findFileByName(root, parsed.filename);
  if (candidates.length === 0) return undefined;

  // Prefer exact assetId match if encoded into filename; otherwise use first found.
  const match = candidates.find((candidate) => candidate.includes(parsed.assetId)) || candidates[0];
  return match;
}

export async function readNoxMediaFile(url) {
  const filePath = await resolveNoxMediaUrl(url);
  if (!filePath) return undefined;
  return readFile(filePath);
}

export function parseNoxMediaUrl(url) {
  try {
    const match = url.match(/^nox-media:\/\/asset\/([^/]+)\/(.+)$/);
    if (!match) return undefined;
    return { assetId: decodeURIComponent(match[1]), filename: decodeURIComponent(match[2]) };
  } catch {
    return undefined;
  }
}

async function findFileByName(dir, filename) {
  const results = [];
  await walk(dir, (filePath) => {
    if (filePath.toLowerCase().endsWith(filename.toLowerCase())) {
      results.push(filePath);
    }
  });
  return results;
}

async function walk(dir, callback) {
  if (!existsSync(dir)) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, callback);
    } else {
      callback(fullPath);
    }
  }
}

export function isPathUnderMediaRoot(filePath) {
  const root = normalize(getMediaRoot());
  const target = normalize(resolve(filePath));
  return target.startsWith(root + sep) || target === root;
}

export function fileUrlToPath(fileUrl) {
  if (!fileUrl || typeof fileUrl !== "string") return undefined;
  if (fileUrl.startsWith("file://")) {
    return pathToFileURL(fileUrl).pathname;
  }
  return undefined;
}

export async function getAssetStats(url) {
  const filePath = await resolveNoxMediaUrl(url);
  if (!filePath) return undefined;
  const info = await stat(filePath);
  return { size: info.size, createdAt: info.birthtime.toISOString(), modifiedAt: info.mtime.toISOString() };
}
