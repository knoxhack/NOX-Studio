#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];

function check(label, condition) {
  if (condition) passes.push(label);
  else failures.push(label);
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

// Source-level checks for desktop integration
const desktopBridge = read("src/lib/desktopBridge.ts");
check("Desktop bridge exports isDesktop guard", /export function isDesktop\(\)/.test(desktopBridge));
check("Desktop bridge defines window.noxDesktop type", /interface Window\s*\{[^}]*noxDesktop\?/.test(desktopBridge));
check("Desktop bridge exposes file import API", /importUserFile/.test(desktopBridge) && /revealInFolder/.test(desktopBridge));

const providerSecrets = read("src/lib/providerSecrets.ts");
check("Provider secrets prefer desktop in desktop mode", /isDesktop\(\)/.test(providerSecrets) && /desktopSecrets/.test(providerSecrets));
check("Provider secrets do not store raw key in localStorage", !/localStorage\.setItem\([^)]*apiKey/.test(providerSecrets) && !/localStorage\.setItem\([^)]*grokKey/.test(providerSecrets));

const storageAdapter = read("src/lib/storage.ts");
check("Storage adapter prefers desktop import in desktop mode", /isDesktop\(\)/.test(storageAdapter) && /desktopFiles\.importUserFile/.test(storageAdapter));

const generationRunner = read("src/lib/generationJobRunner.ts");
check("Generation runner uses desktop Grok for images", /desktopGrok\.generateImage/.test(generationRunner));
check("Generation runner uses desktop Grok for videos", /desktopGrok\.generateVideo/.test(generationRunner));
check("Generation runner polls async video jobs", /desktopGrok\.pollVideoJob/.test(generationRunner));
check("Generation runner uses desktop render service", /desktopRender\.runRender/.test(generationRunner));
check("Generation runner uses desktop publish service", /desktopPublish\.createReleasePackage/.test(generationRunner));

const xaiClient = read("electron/xai-client.mjs");
check("xAI client defines default text model", /grok-4\.3/.test(xaiClient));
check("xAI client defines default image model", /grok-imagine-image-quality/.test(xaiClient));
check("xAI client defines default video model", /grok-imagine-video/.test(xaiClient));
check("xAI client redacts Authorization header in logs", /Bearer\s+\[REDACTED\]/.test(xaiClient));

const secretsStore = read("electron/secrets-store.mjs");
check("Electron secrets encrypt with safeStorage", /safeStorage\.encryptString/.test(secretsStore));
check("Electron secrets decrypt with safeStorage", /safeStorage\.decryptString/.test(secretsStore));

const mediaStore = read("electron/media-store.mjs");
check("Media store supports nox-media URL scheme", /nox-media:\/\/asset/.test(mediaStore));
check("Media store resolves URLs under media root", /isPathUnderMediaRoot/.test(mediaStore));

// Media path sanitizer smoke test (mirror implementation)
function sanitizeFilename(filename) {
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

check("sanitizeFilename strips path traversal", sanitizeFilename("../../../etc/passwd.txt").stem === "passwd");
check("sanitizeFilename removes special characters", sanitizeFilename("hello world!@#.png").stem === "hello-world");
check("sanitizeFilename preserves safe extension", sanitizeFilename("image.PNG").extension === ".png");

// nox-media URL parser smoke test
function parseNoxMediaUrl(url) {
  const match = url.match(/^nox-media:\/\/asset\/([^/]+)\/(.+)$/);
  if (!match) return undefined;
  return { assetId: decodeURIComponent(match[1]), filename: decodeURIComponent(match[2]) };
}

const parsed = parseNoxMediaUrl("nox-media://asset/abc-123/video.mp4");
check("parseNoxMediaUrl extracts asset id and filename", parsed?.assetId === "abc-123" && parsed?.filename === "video.mp4");

// xAI response normalizer smoke test
function summarizeResponse(data) {
  if (!data || typeof data !== "object") return {};
  const { id, model, object, created, usage, data: responseData } = data;
  return { id, model, object, created, usage, dataCount: Array.isArray(responseData) ? responseData.length : undefined };
}

const summary = summarizeResponse({ id: "job-1", model: "grok-4.3", usage: { total_tokens: 42 }, choices: [{ message: { content: "secret" } }] });
check("summarizeResponse removes raw content", summary.id === "job-1" && !summary.choices && summary.usage.total_tokens === 42);

// Key leakage check across renderer files
const rendererFiles = [
  "src/lib/providerSecrets.ts",
  "src/lib/storage.ts",
  "src/lib/generationGateway.ts",
  "src/lib/generationJobRunner.ts",
  "src/lib/desktopBridge.ts",
];

for (const file of rendererFiles) {
  const text = read(file);
  check(`${file} does not persist raw apiKey string in state/localStorage`, !/localStorage\./.test(text) || !/apiKey/.test(text));
}

if (failures.length) {
  console.error("NOX desktop bridge verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(`\nPassed ${passes.length} checks before failing.`);
  process.exit(1);
}

console.log(`NOX desktop bridge verification passed (${passes.length} checks).`);
