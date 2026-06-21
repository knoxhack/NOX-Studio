import electron from "electron";
const { app } = electron;
import { mkdir, mkdtemp, readFile, writeFile, rm, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { saveAsset, resolveNoxMediaUrl, getMediaRoot } from "./media-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getRendererScriptPath() {
  if (app.isPackaged) {
    return resolve(join(process.resourcesPath, "scripts", "render-nox-cut.mjs"));
  }
  return resolve(join(app.getAppPath(), "scripts", "render-nox-cut.mjs"));
}

export async function runLocalRender(stateSnapshot, projectId, options = {}) {
  const { manifest, outputFilename } = options;
  if (!manifest) {
    throw new Error("Render manifest is required.");
  }
  if (!manifest.readiness?.ready) {
    throw new Error(`Render not ready: ${manifest.readiness?.blockers?.join("; ") || "unknown blockers"}`);
  }

  const resolvedManifest = await resolveManifestAssets(manifest);
  const tempDir = await mkdtemp(join(tmpdir(), "nox-render-"));
  const manifestPath = join(tempDir, "resolved-render-manifest.json");
  const outputPath = join(tempDir, outputFilename || manifest.outputFilename || "nox-final.mp4");

  try {
    await writeFile(manifestPath, JSON.stringify(resolvedManifest, null, 2));
    await runRenderer(manifestPath, outputPath);

    if (!existsSync(outputPath)) {
      throw new Error("Renderer did not produce an output file.");
    }

    const buffer = await readFile(outputPath);
    const asset = await saveAsset({
      workspaceId: manifest.workspaceId,
      projectId: manifest.projectId,
      type: "Final Export",
      filename: outputFilename || manifest.outputFilename || "nox-final.mp4",
      mimeType: "video/mp4",
      buffer,
    });

    return {
      asset,
      outputPath: asset.filePath,
      providerResponseSummary: {
        renderer: "NOX Render Engine V1",
        ffmpegPath: ffmpegStatic || process.env.NOX_FFMPEG_PATH || "ffmpeg",
        clipCount: manifest.clips?.length || 0,
        utilityTrackCount: manifest.utilityTracks?.length || 0,
      },
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function resolveManifestAssets(manifest) {
  const clips = [];
  for (const clip of manifest.clips || []) {
    const sourceUrl = clip.sourceUrl;
    const resolved = sourceUrl ? await resolveNoxMediaUrl(sourceUrl) : undefined;
    clips.push({
      ...clip,
      sourceUrl: resolved || sourceUrl,
      sourceFilename: resolved ? resolved.split(/[\\/]/).pop() : clip.sourceFilename,
      localPath: resolved,
    });
  }

  const utilityTracks = [];
  for (const track of manifest.utilityTracks || []) {
    const sourceUrl = track.assetSourceUrl;
    const resolved = sourceUrl ? await resolveNoxMediaUrl(sourceUrl) : undefined;
    utilityTracks.push({
      ...track,
      assetSourceUrl: resolved || sourceUrl,
      assetFilename: resolved ? resolved.split(/[\\/]/).pop() : track.assetFilename,
      localPath: resolved,
    });
  }

  return {
    ...manifest,
    clips,
    utilityTracks,
  };
}

function runRenderer(manifestPath, outputPath) {
  return new Promise((resolve, reject) => {
    const scriptPath = getRendererScriptPath();
    if (!existsSync(scriptPath)) {
      reject(new Error(`Renderer script not found at ${scriptPath}`));
      return;
    }

    const env = {
      ...process.env,
      NOX_FFMPEG_PATH: process.env.NOX_FFMPEG_PATH || ffmpegStatic || "ffmpeg",
    };

    const child = spawn(process.execPath, [scriptPath, manifestPath, outputPath], {
      env,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`Render failed with code ${code}.\n${stderr || stdout}`);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}
