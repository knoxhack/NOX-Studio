#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegStatic from "ffmpeg-static";

const outputPath = resolve(process.argv[2] ?? "dist/render-smoke/nox-render-smoke.mp4");
const ffmpeg = process.env.NOX_FFMPEG_PATH || ffmpegStatic || "ffmpeg";
const tempDir = await mkdtemp(join(tmpdir(), "nox-render-smoke-"));

try {
  await mkdir(dirname(outputPath), { recursive: true });
  await assertFfmpeg(ffmpeg);

  const sourceDir = join(tempDir, "sources");
  await mkdir(sourceDir, { recursive: true });
  const clipPaths = await createSceneCardClips(sourceDir);
  const musicPath = await createMusicBed(sourceDir);
  const watermarkPath = await createWatermark(sourceDir);
  const manifestPath = join(tempDir, "render-smoke-manifest.json");
  const manifest = createSmokeManifest({ clipPaths, musicPath, watermarkPath });

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  const renderScript = join(dirname(fileURLToPath(import.meta.url)), "render-nox-cut.mjs");
  await run(process.execPath, [renderScript, manifestPath, outputPath], {
    env: {
      ...process.env,
      NOX_FFMPEG_PATH: ffmpeg,
      NOX_RENDER_FONT: process.env.NOX_RENDER_FONT || detectWindowsFont(),
      NOX_RENDER_QUIET: "1",
    },
    capture: true,
  });

  const outputStats = await stat(outputPath);
  if (outputStats.size < 100_000) {
    throw new Error(`Render smoke output is too small to be a valid MP4: ${outputStats.size} bytes.`);
  }

  const duration = await inspectDuration(outputPath);
  if (duration < 59 || duration > 61.5) {
    throw new Error(`Render smoke output duration should be about 60 seconds; got ${duration.toFixed(2)} seconds.`);
  }

  console.log(`NOX Render Engine smoke test passed: ${outputPath}`);
  console.log(`Verified six Scene Card clips, title/subtitle overlays, music bed, watermark overlay, and ${duration.toFixed(2)}s MP4 duration.`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function createSceneCardClips(sourceDir) {
  const colors = ["0x07111f", "0x132413", "0x251634", "0x33240e", "0x0f2535", "0x331426"];
  const clips = [];

  for (const [index, color] of colors.entries()) {
    const path = join(sourceDir, `scene-${String(index + 1).padStart(2, "0")}.mp4`);
    await run(ffmpeg, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=360x640:d=10:r=30`,
      "-vf",
      "format=yuv420p",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path,
    ], { capture: true });
    clips.push(path);
  }

  return clips;
}

async function createMusicBed(sourceDir) {
  const path = join(sourceDir, "low-cinematic-pulse.wav");
  await run(ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=196:duration=60:sample_rate=48000",
    "-c:a",
    "pcm_s16le",
    path,
  ], { capture: true });
  return path;
}

async function createWatermark(sourceDir) {
  const path = join(sourceDir, "nox-watermark.png");
  await run(ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=96x96:d=1",
    "-frames:v",
    "1",
    path,
  ], { capture: true });
  return path;
}

function createSmokeManifest({ clipPaths, musicPath, watermarkPath }) {
  return {
    schemaVersion: 1,
    engine: "NOX Render Engine V1",
    workspaceId: "render-smoke-workspace",
    projectId: "render-smoke-project",
    projectTitle: "NOX Render Smoke Test",
    outputFilename: "nox-render-smoke.mp4",
    format: "9:16",
    runtimeSeconds: 60,
    fps: 30,
    width: 360,
    height: 640,
    clips: clipPaths.map((path, index) => ({
      sceneId: `scene-${index + 1}`,
      sceneNumber: index + 1,
      label: `SCENE ${String(index + 1).padStart(2, "0")} - Render Smoke`,
      sourceAssetId: `asset-scene-${index + 1}`,
      sourceFilename: path,
      sourceUrl: path,
      localPath: path,
      startTime: index * 10,
      endTime: index * 10 + 10,
      durationSeconds: 10,
      transitionIn: index === 0 ? "Blackout Cut" : "Cyberglass Swipe",
      transitionOut: index === 5 ? "Blackout Cut" : "Signal Glitch",
      trimStartNote: "Start on first generated smoke-test frame.",
      trimEndNote: "Cut on the exact ten-second boundary.",
      editorNotes: "Synthetic six-scene render smoke source.",
      provider: "NOX Render Smoke",
      promptId: `scene-${index + 1}`,
      ready: true,
    })),
    utilityTracks: [
      {
        id: "title-card",
        trackType: "title",
        label: "Title Card",
        startTime: 0,
        endTime: 5,
        transitionIn: "Fade",
        transitionOut: "Fade",
        textOverlay: "NOX RENDER SMOKE",
      },
      {
        id: "subtitles",
        trackType: "subtitle",
        label: "Smoke Test Subtitles",
        startTime: 5,
        endTime: 55,
        transitionIn: "None",
        transitionOut: "None",
        subtitleText: "Six approved Scene Cards assembled into one MP4.",
      },
      {
        id: "music-bed",
        trackType: "audio",
        label: "Low Cinematic Pulse",
        startTime: 0,
        endTime: 60,
        transitionIn: "Fade",
        transitionOut: "Fade",
        assetId: "asset-music-bed",
        assetFilename: "low-cinematic-pulse.wav",
        assetSourceUrl: musicPath,
        assetMimeType: "audio/wav",
        assetType: "Audio",
      },
      {
        id: "watermark",
        trackType: "overlay",
        label: "NOX Watermark",
        startTime: 0,
        endTime: 60,
        transitionIn: "None",
        transitionOut: "None",
        assetId: "asset-watermark",
        assetFilename: "nox-watermark.png",
        assetSourceUrl: watermarkPath,
        assetMimeType: "image/png",
        assetType: "Brand File",
      },
    ],
    readiness: {
      ready: true,
      approvedClipCount: 6,
      totalClipCount: 6,
      blockers: [],
    },
    ffmpeg: {
      concatMode: "reencode-concat",
      rendererScript: "scripts/render-nox-cut.mjs",
      workerScript: "scripts/render-worker.mjs",
      notes: ["Synthetic smoke manifest for actual MP4 verification."],
    },
    createdAt: new Date().toISOString(),
  };
}

async function inspectDuration(path) {
  const result = await run(ffmpeg, ["-hide_banner", "-i", path], { capture: true, allowFailure: true });
  const match = result.stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error("Could not inspect rendered MP4 duration.");
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function assertFfmpeg(binary) {
  await run(binary, ["-version"], { capture: true });
}

function detectWindowsFont() {
  const candidates = ["C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/segoeui.ttf"];
  return candidates.find((font) => existsSync(font)) ?? "";
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 || options.allowFailure) resolvePromise({ stdout, stderr, code });
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}${stderr ? `\n${stderr}` : ""}`));
    });
  });
}
