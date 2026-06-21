#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

const [, , manifestPath, outputPathArg] = process.argv;

if (!manifestPath || !outputPathArg) {
  console.error("Usage: node scripts/render-nox-cut.mjs <render-manifest.json> <output.mp4>");
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const manifestDir = dirname(resolve(manifestPath));
const outputPath = resolve(outputPathArg);
const ffmpeg = process.env.NOX_FFMPEG_PATH || ffmpegStatic || "ffmpeg";

if (!manifest.readiness?.ready) {
  const blockers = manifest.readiness?.blockers?.length ? manifest.readiness.blockers.join("\n- ") : "Render manifest is not ready.";
  console.error(`NOX render manifest is not ready:\n- ${blockers}`);
  process.exit(1);
}

const clips = manifest.clips ?? [];
if (!clips.length) {
  console.error("NOX render manifest has no clips.");
  process.exit(1);
}

const tempDir = await mkdtemp(join(tmpdir(), "nox-render-"));

try {
  await assertFfmpeg(ffmpeg);
  const renderedClips = await renderSceneClips({ clips, ffmpeg, manifest, manifestDir, tempDir });
  const baseAssemblyPath = await concatenateClips({ ffmpeg, manifest, renderedClips, tempDir });
  const finishingPlan = createFinishingPlan(manifest, manifestDir);

  await applyFinishingPass({ baseAssemblyPath, ffmpeg, finishingPlan, manifest, outputPath });

  console.log(`NOX Render Engine V1 wrote ${outputPath}`);
  console.log(`Scene clips: ${clips.length}; utility tracks applied: ${finishingPlan.appliedTrackLabels.length || "none"}`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function renderSceneClips({ clips, ffmpeg, manifest, manifestDir, tempDir }) {
  const renderedClips = [];

  for (const [index, clip] of clips.entries()) {
    const source = resolveLocalSource(clip, manifestDir);
    if (!source) {
      throw new Error(`Clip ${clip.label} does not resolve to a local video file. Export/download Storage assets first.`);
    }

    const renderedClip = join(tempDir, `clip-${String(index + 1).padStart(2, "0")}.mp4`);
    const duration = Math.max(Number(clip.durationSeconds) || 10, 0.1);
    const filters = [
      `scale=${manifest.width}:${manifest.height}:force_original_aspect_ratio=decrease`,
      `pad=${manifest.width}:${manifest.height}:(ow-iw)/2:(oh-ih)/2`,
      "setsar=1",
      `fps=${manifest.fps || 30}`,
      "format=yuv420p",
      ...transitionFadeFilters(clip, duration),
    ];

    await run(ffmpeg, [
      "-y",
      "-i",
      source,
      "-t",
      formatSeconds(duration),
      "-vf",
      filters.join(","),
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      renderedClip,
    ]);
    renderedClips.push(renderedClip);
  }

  return renderedClips;
}

async function concatenateClips({ ffmpeg, manifest, renderedClips, tempDir }) {
  const concatPath = join(tempDir, "concat.txt");
  const baseAssemblyPath = join(tempDir, "base-assembly.mp4");
  await writeFile(concatPath, renderedClips.map((clip) => `file '${toConcatPath(clip)}'`).join("\n"), "utf8");

  await run(ffmpeg, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-shortest",
    "-t",
    formatSeconds(getRuntimeSeconds(manifest)),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    baseAssemblyPath,
  ]);

  return baseAssemblyPath;
}

function createFinishingPlan(manifest, manifestDir) {
  const utilityTracks = (manifest.utilityTracks ?? []).filter((track) => track.endTime > track.startTime);
  const visualTextTracks = [];
  const imageOverlayTracks = [];
  const audioTracks = [];
  const appliedTrackLabels = [];

  for (const track of utilityTracks) {
    const source = resolveLocalSource(track, manifestDir);

    if (track.trackType === "audio") {
      if (source && isAudioSource(source, track)) {
        audioTracks.push({ ...track, source });
        appliedTrackLabels.push(track.label);
      }
      continue;
    }

    if (track.trackType === "overlay" && source && isImageSource(source, track)) {
      imageOverlayTracks.push({ ...track, source });
      appliedTrackLabels.push(track.label);
      continue;
    }

    const text = getUtilityTrackText(track);
    if (text) {
      visualTextTracks.push({ ...track, text });
      appliedTrackLabels.push(track.label);
    }
  }

  return { appliedTrackLabels, audioTracks, imageOverlayTracks, visualTextTracks };
}

async function applyFinishingPass({ baseAssemblyPath, ffmpeg, finishingPlan, manifest, outputPath }) {
  const inputArgs = ["-y", "-i", baseAssemblyPath];
  const filterParts = [];
  const runtime = getRuntimeSeconds(manifest);
  let nextInputIndex = 1;
  let currentVideo = "[0:v]";
  let videoStep = 0;

  for (const track of finishingPlan.imageOverlayTracks) {
    inputArgs.push("-loop", "1", "-i", track.source);
    track.inputIndex = nextInputIndex;
    nextInputIndex += 1;
  }

  for (const track of finishingPlan.audioTracks) {
    inputArgs.push("-stream_loop", "-1", "-i", track.source);
    track.inputIndex = nextInputIndex;
    nextInputIndex += 1;
  }

  for (const track of finishingPlan.visualTextTracks) {
    const output = `[v${videoStep++}]`;
    filterParts.push(`${currentVideo}${drawTextFilter(track, manifest)}${output}`);
    currentVideo = output;
  }

  for (const [index, track] of finishingPlan.imageOverlayTracks.entries()) {
    const watermark = `[wm${index}]`;
    const output = `[v${videoStep++}]`;
    const maxWidth = Math.max(Math.round(manifest.width * 0.18), 120);
    filterParts.push(`[${track.inputIndex}:v]scale=${maxWidth}:-1${watermark}`);
    filterParts.push(`${currentVideo}${watermark}overlay=x=W-w-48:y=H-h-48:enable='${betweenExpression(track, runtime)}'${output}`);
    currentVideo = output;
  }

  if (filterParts.length || finishingPlan.audioTracks.length) {
    filterParts.push(`${currentVideo}format=yuv420p[vout]`);
  }

  const audioLabels = [];
  for (const [index, track] of finishingPlan.audioTracks.entries()) {
    const label = `[a${index}]`;
    const duration = Math.max(clampTime(track.endTime, runtime) - clampTime(track.startTime, 0), 0.1);
    const fadeDuration = Math.min(1, duration / 3);
    const fadeOutStart = Math.max(duration - fadeDuration, 0);
    const delayMs = Math.round(clampTime(track.startTime, 0) * 1000);
    filterParts.push(
      `[${track.inputIndex}:a]atrim=0:${formatSeconds(duration)},asetpts=PTS-STARTPTS,volume=0.28,afade=t=in:st=0:d=${formatSeconds(fadeDuration)},afade=t=out:st=${formatSeconds(fadeOutStart)}:d=${formatSeconds(fadeDuration)},adelay=${delayMs}|${delayMs},apad,atrim=0:${formatSeconds(runtime)}${label}`,
    );
    audioLabels.push(label);
  }

  const outputArgs = ["-metadata", `title=${manifest.projectTitle ?? "NOX Studio Render"}`, "-metadata", "comment=NOX Render Engine V1"];

  if (!filterParts.length) {
    await run(ffmpeg, ["-y", "-i", baseAssemblyPath, ...outputArgs, "-c", "copy", "-movflags", "+faststart", outputPath]);
    return;
  }

  if (audioLabels.length) {
    filterParts.push(`[0:a]${audioLabels.join("")}amix=inputs=${audioLabels.length + 1}:duration=first:dropout_transition=2[aout]`);
  }

  await run(ffmpeg, [
    ...inputArgs,
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[vout]",
    "-map",
    audioLabels.length ? "[aout]" : "0:a",
    "-t",
    formatSeconds(runtime),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    ...outputArgs,
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

function transitionFadeFilters(clip, duration) {
  const fadeIn = getTransitionFadeSeconds(clip.transitionIn, "in");
  const fadeOut = getTransitionFadeSeconds(clip.transitionOut, "out");
  const filters = [];

  if (fadeIn > 0) {
    filters.push(`fade=t=in:st=0:d=${formatSeconds(Math.min(fadeIn, duration / 2))}`);
  }

  if (fadeOut > 0) {
    const safeFadeOut = Math.min(fadeOut, duration / 2);
    filters.push(`fade=t=out:st=${formatSeconds(Math.max(duration - safeFadeOut, 0))}:d=${formatSeconds(safeFadeOut)}`);
  }

  return filters;
}

function getTransitionFadeSeconds(label, direction) {
  const value = String(label ?? "").toLowerCase();
  if (!value || value.includes("none") || value.includes("cut")) return 0;
  if (value.includes("fade")) return 0.35;
  if (value.includes("blackout")) return direction === "in" ? 0.4 : 0.2;
  if (value.includes("glitch") || value.includes("swipe") || value.includes("signal") || value.includes("cyberglass")) return 0.18;
  return 0.12;
}

function drawTextFilter(track, manifest) {
  const kind = track.trackType;
  const fontOption = process.env.NOX_RENDER_FONT ? `fontfile='${escapeDrawtext(process.env.NOX_RENDER_FONT)}':` : "";
  const text = escapeDrawtext(track.text);
  const fontSize = getFontSize(kind, manifest);
  const position = getTextPosition(kind);
  const box = kind === "overlay" ? "0" : "1";
  const boxColor = kind === "title" ? "black@0.6" : "black@0.42";
  const borderWidth = kind === "title" ? 28 : 14;

  return `drawtext=${fontOption}text='${text}':fontcolor=white:fontsize=${fontSize}:line_spacing=8:x=${position.x}:y=${position.y}:box=${box}:boxcolor=${boxColor}:boxborderw=${borderWidth}:enable='${betweenExpression(track, getRuntimeSeconds(manifest))}'`;
}

function getFontSize(kind, manifest) {
  if (kind === "title") return Math.max(Math.round(manifest.height * 0.045), 52);
  if (kind === "subtitle") return Math.max(Math.round(manifest.height * 0.028), 34);
  return Math.max(Math.round(manifest.height * 0.019), 24);
}

function getTextPosition(kind) {
  if (kind === "title") return { x: "(w-text_w)/2", y: "h*0.12" };
  if (kind === "subtitle") return { x: "(w-text_w)/2", y: "h-text_h-150" };
  return { x: "w-text_w-48", y: "h-text_h-48" };
}

function getUtilityTrackText(track) {
  if (track.trackType === "title") return track.textOverlay || track.label;
  if (track.trackType === "subtitle") return track.subtitleText || track.label;
  if (track.trackType === "overlay") return track.textOverlay || track.label;
  return "";
}

function betweenExpression(track, runtime) {
  const start = formatSeconds(clampTime(track.startTime, 0));
  const end = formatSeconds(clampTime(track.endTime, runtime));
  return `between(t,${start},${end})`;
}

function getRuntimeSeconds(manifest) {
  return Math.max(Number(manifest.runtimeSeconds) || sumClipDurations(manifest.clips ?? []), 0.1);
}

function sumClipDurations(clips) {
  return clips.reduce((total, clip) => total + (Number(clip.durationSeconds) || 0), 0);
}

function isImageSource(source, track) {
  const mimeType = String(track.assetMimeType ?? "").toLowerCase();
  if (mimeType.startsWith("image/")) return true;
  return [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extname(source).toLowerCase());
}

function isAudioSource(source, track) {
  const mimeType = String(track.assetMimeType ?? "").toLowerCase();
  if (mimeType.startsWith("audio/")) return true;
  return [".aac", ".aiff", ".flac", ".m4a", ".mp3", ".ogg", ".wav"].includes(extname(source).toLowerCase());
}

function clampTime(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function formatSeconds(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, "");
}

function toConcatPath(value) {
  return value.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

function escapeDrawtext(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\r?\n/g, " ");
}

async function assertFfmpeg(binary) {
  try {
    await run(binary, ["-version"], { quiet: true });
  } catch {
    throw new Error(`FFmpeg is not available. Install ffmpeg or set NOX_FFMPEG_PATH before running ${fileURLToPath(import.meta.url)}.`);
  }
}

function resolveLocalSource(item, baseDir) {
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
    if (candidate.startsWith("http://") || candidate.startsWith("https://") || candidate.startsWith("blob:")) continue;
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

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const quiet = options.quiet || process.env.NOX_RENDER_QUIET === "1";
    const child = spawn(command, args, { stdio: quiet ? "ignore" : "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}
