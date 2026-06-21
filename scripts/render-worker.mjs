#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

loadDotEnvFiles([".env.local", ".env"]);

const args = process.argv.slice(2);
const shouldUpload = args.includes("--upload") || process.env.NOX_RENDER_UPLOAD === "1";
const positional = args.filter((arg) => arg !== "--upload");
const [manifestPathArg, outputPathArg] = positional;

if (!manifestPathArg || !outputPathArg) {
  console.error("Usage: node scripts/render-worker.mjs <render-manifest.json> <output.mp4> [--upload]");
  process.exit(1);
}

const manifestPath = resolve(manifestPathArg);
const manifestDir = dirname(manifestPath);
const outputPath = resolve(outputPathArg);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const tempDir = await mkdtemp(join(tmpdir(), "nox-render-worker-"));

try {
  const resolvedManifest = JSON.parse(JSON.stringify(manifest));
  const supabase = needsSupabaseResolution(resolvedManifest, manifestDir) || shouldUpload ? await createSupabaseClient() : undefined;

  await resolveClipSources({ manifest: resolvedManifest, manifestDir, supabase, tempDir });
  await resolveUtilitySources({ manifest: resolvedManifest, manifestDir, supabase, tempDir });

  const resolvedManifestPath = join(tempDir, "resolved-render-manifest.json");
  await writeFile(resolvedManifestPath, JSON.stringify(resolvedManifest, null, 2), "utf8");

  await run(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "render-nox-cut.mjs"), resolvedManifestPath, outputPath]);

  if (shouldUpload) {
    const upload = await uploadRenderOutput(supabase, resolvedManifest, outputPath);
    console.log(`NOX render worker uploaded ${upload.bucket}/${upload.path}`);
  }

  console.log(`NOX render worker resolved ${resolvedManifest.clips?.length ?? 0} clip(s) and wrote ${outputPath}`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function resolveClipSources({ manifest, manifestDir, supabase, tempDir }) {
  for (const [index, clip] of (manifest.clips ?? []).entries()) {
    const localPath = resolveExistingLocalSource(clip, manifestDir);
    if (localPath) {
      clip.localPath = localPath;
      continue;
    }

    const extension = extname(clip.sourceFilename ?? clip.storagePath ?? "") || ".mp4";
    const targetPath = join(tempDir, `scene-${String(index + 1).padStart(2, "0")}${extension}`);
    clip.localPath = clip.storagePath
      ? await downloadStorageObject(supabase, "nox-videos", clip.storagePath, targetPath)
      : await downloadHttpSource(clip.sourceUrl, targetPath, clip.label);
  }
}

async function resolveUtilitySources({ manifest, manifestDir, supabase, tempDir }) {
  for (const [index, track] of (manifest.utilityTracks ?? []).entries()) {
    if (!track.assetId && !track.assetStoragePath && !track.assetSourceUrl) continue;

    const localPath = resolveExistingLocalSource(track, manifestDir);
    if (localPath) {
      track.localPath = localPath;
      continue;
    }

    const sourcePath = track.assetStoragePath ?? track.storagePath;
    const sourceUrl = track.assetSourceUrl ?? track.sourceUrl;
    if (!sourcePath && !sourceUrl) continue;

    const extension = extname(track.assetFilename ?? sourcePath ?? "") || extensionForMime(track.assetMimeType) || ".bin";
    const targetPath = join(tempDir, `track-${String(index + 1).padStart(2, "0")}${extension}`);
    track.localPath = sourcePath
      ? await downloadStorageObject(supabase, bucketForUtilityTrack(track), sourcePath, targetPath)
      : await downloadHttpSource(sourceUrl, targetPath, track.label);
  }
}

async function createSupabaseClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Render worker needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to resolve private Storage assets.");
  }

  const supabase = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const email = process.env.NOX_SUPABASE_RENDER_EMAIL || process.env.NOX_SUPABASE_TEST_EMAIL;
  const password = process.env.NOX_SUPABASE_RENDER_PASSWORD || process.env.NOX_SUPABASE_TEST_PASSWORD;
  if (email && password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`Render worker Supabase sign-in failed: ${error.message}`);
  }

  return supabase;
}

async function downloadStorageObject(supabase, bucket, path, targetPath) {
  if (!supabase) throw new Error(`Supabase client is required to download ${bucket}/${path}.`);
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Storage download failed for ${bucket}/${path}: ${error?.message ?? "No data returned."}`);
  await writeFile(targetPath, Buffer.from(await data.arrayBuffer()));
  return targetPath;
}

async function downloadHttpSource(url, targetPath, label) {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error(`${label ?? "Render asset"} has no local path, Storage path, or downloadable URL.`);
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed for ${label ?? url}: HTTP ${response.status}`);
  await writeFile(targetPath, Buffer.from(await response.arrayBuffer()));
  return targetPath;
}

async function uploadRenderOutput(supabase, manifest, outputPath) {
  if (!supabase) throw new Error("Supabase client is required to upload the rendered MP4.");
  const workspaceId = manifest.workspaceId || inferWorkspaceId(manifest);
  if (!workspaceId) throw new Error("Render manifest needs workspaceId or workspace-prefixed Storage paths before upload.");

  const safeName = safeFilename(basename(outputPath) || manifest.outputFilename || "nox-render.mp4");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = [workspaceId, manifest.projectId, "renders", `${timestamp}-${safeName}`].filter(Boolean).join("/");
  const file = await readFile(outputPath);
  const { error } = await supabase.storage.from("nox-exports").upload(path, file, {
    contentType: "video/mp4",
    upsert: false,
  });
  if (error) throw new Error(`Rendered MP4 upload failed: ${error.message}`);
  return { bucket: "nox-exports", path };
}

function needsSupabaseResolution(manifest, manifestDir) {
  return [...(manifest.clips ?? []), ...(manifest.utilityTracks ?? [])].some((item) => {
    if (resolveExistingLocalSource(item, manifestDir)) return false;
    return Boolean(item.storagePath || item.assetStoragePath);
  });
}

function resolveExistingLocalSource(item, baseDir) {
  const candidates = [
    item.localPath,
    item.sourcePath,
    item.sourceUrl,
    item.sourceFilename,
    item.storagePath,
    item.assetSourceUrl,
    item.assetFilename,
    item.assetStoragePath,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (/^https?:\/\//i.test(candidate) || candidate.startsWith("blob:")) continue;
    const value = toLocalPathCandidate(candidate);
    const resolved = isAbsolute(value) ? value : resolve(baseDir, value);
    if (existsSync(resolved)) return resolved;
  }
  return "";
}

function toLocalPathCandidate(candidate) {
  if (candidate.startsWith("file://")) return fileURLToPath(candidate);
  if (candidate.startsWith("local://")) return candidate.replace(/^local:\/\//, "");
  return candidate;
}

function bucketForUtilityTrack(track) {
  if (track.assetType === "Audio" || track.trackType === "audio") return "nox-audio";
  if (track.assetType === "Brand File") return "nox-brand";
  if (track.assetType === "Image" || track.assetType === "Poster" || track.trackType === "overlay") return "nox-images";
  if (track.assetType === "Video") return "nox-videos";
  return "nox-exports";
}

function extensionForMime(mimeType = "") {
  const lower = mimeType.toLowerCase();
  if (lower.includes("png")) return ".png";
  if (lower.includes("jpeg") || lower.includes("jpg")) return ".jpg";
  if (lower.includes("webp")) return ".webp";
  if (lower.includes("mpeg")) return ".mp3";
  if (lower.includes("wav")) return ".wav";
  if (lower.includes("mp4")) return ".mp4";
  return "";
}

function inferWorkspaceId(manifest) {
  const storagePath = [...(manifest.clips ?? []), ...(manifest.utilityTracks ?? [])]
    .map((item) => item.storagePath ?? item.assetStoragePath)
    .find(Boolean);
  return storagePath?.split("/").filter(Boolean)[0] ?? "";
}

function safeFilename(filename) {
  const extension = extname(filename).toLowerCase() || ".mp4";
  const stem = basename(filename, extension).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "nox-render";
  return `${stem}${extension}`;
}

function loadDotEnvFiles(files) {
  for (const file of files) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = stripEnvQuotes(match[2].trim());
    }
  }
}

function stripEnvQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}
