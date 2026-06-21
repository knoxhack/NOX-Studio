#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

loadDotEnvFiles([".env.local", ".env"]);

const root = process.cwd();
const args = process.argv.slice(2);
const config = readConfig();

main().catch(async (error) => {
  await notifyWorkerAlert("fatal", error instanceof Error ? error.message : String(error));
  console.error(`NOX generation worker failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

async function main() {
  const missing = [];
  if (!config.url) missing.push("VITE_SUPABASE_URL");
  if (!config.anonKey) missing.push("VITE_SUPABASE_ANON_KEY");
  if (!config.email) missing.push("NOX_SUPABASE_WORKER_EMAIL");
  if (!config.password) missing.push("NOX_SUPABASE_WORKER_PASSWORD");
  if (missing.length) {
    throw new Error(`Missing ${missing.join(", ")}. Set worker credentials in .env.local before starting the queue worker.`);
  }

  const supabase = createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: false,
    },
  });
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: config.email,
    password: config.password,
  });
  if (signInError) throw new Error(`Worker sign-in failed: ${signInError.message}`);

  console.log(`NOX generation worker ${config.workerId} started.`);
  console.log(`Mode: ${config.once ? "single pass" : "continuous"}; render=${config.renderEnabled ? "on" : "off"}; upload=${config.uploadRender ? "on" : "off"}`);

  let cycles = 0;
  let idleCycles = 0;
  let processedJobs = 0;
  let reportedCostUsd = 0;

  while (true) {
    cycles += 1;
    const workspaceIds = config.workspaceIds.length ? config.workspaceIds : await discoverWorkspaceIds(supabase);
    if (!workspaceIds.length) {
      console.log("No accessible workspaces found for this worker account.");
    }

    let didWork = false;
    for (const workspaceId of workspaceIds) {
      const result = await processNextWorkspaceJob(supabase, workspaceId);
      if (!result.job) {
        console.log(`Workspace ${workspaceId}: idle.`);
        continue;
      }

      didWork = true;
      processedJobs += 1;
      reportedCostUsd += reportedJobCost(result.job);
      console.log(
        `Workspace ${workspaceId}: ${result.job.status} ${result.job.task} (${result.job.id}) via ${result.job.provider}.`,
      );

      await maybeCompleteRenderJob(supabase, result.job);
      if (config.maxDailyCostUsd > 0 && reportedCostUsd >= config.maxDailyCostUsd) {
        console.log(`Worker cost ceiling reached: ${reportedCostUsd.toFixed(4)} USD >= ${config.maxDailyCostUsd.toFixed(4)} USD.`);
        await notifyWorkerAlert("cost-ceiling", `Worker ${config.workerId} reached cost ceiling ${reportedCostUsd.toFixed(4)} USD.`);
        return;
      }
    }

    idleCycles = didWork ? 0 : idleCycles + 1;
    if (config.once) break;
    if (config.maxCycles && cycles >= config.maxCycles) break;
    if (config.maxIdleCycles && idleCycles >= config.maxIdleCycles) break;
    await sleep(config.intervalMs);
  }

  console.log(`NOX generation worker stopped after ${cycles} cycle(s), ${processedJobs} job(s) processed.`);
}

async function discoverWorkspaceIds(supabase) {
  const { data, error } = await supabase.from("workspaces").select("id").order("created_at", { ascending: true });
  if (error) throw new Error(`Workspace discovery failed: ${error.message}`);
  return (data ?? []).map((row) => row.id).filter(Boolean);
}

async function processNextWorkspaceJob(supabase, workspaceId) {
  const { data, error } = await supabase.functions.invoke("process-generation-job", {
    body: {
      action: "process-next",
      workspaceId,
      workerId: config.workerId,
      context: {
        worker: config.workerId,
        source: "scripts/generation-worker.mjs",
      },
    },
  });

  if (error) throw new Error(`process-next failed for workspace ${workspaceId}: ${error.message}`);
  if (data?.error) throw new Error(`process-next failed for workspace ${workspaceId}: ${data.error}`);
  return data ?? { job: null };
}

async function maybeCompleteRenderJob(supabase, job) {
  if (!config.renderEnabled || !isRenderJob(job)) return;

  const manifest = parseRenderManifest(job.inputPayload);
  if (!manifest) {
    console.log(`Render job ${job.id}: no NOX Render Engine V1 manifest payload found.`);
    return;
  }

  const blockers = Array.isArray(manifest.readiness?.blockers) ? manifest.readiness.blockers : [];
  if (!manifest.readiness?.ready || blockers.length) {
    console.log(`Render job ${job.id}: waiting on readiness blockers.`);
    return;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "nox-generation-worker-render-"));
  const manifestPath = join(tempDir, "render-manifest.json");
  const outputFilename = safeFilename(manifest.outputFilename || `${job.id}.mp4`);
  const outputPath = resolve(config.renderOutputDir, outputFilename);

  try {
    await mkdir(config.renderOutputDir, { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    const childArgs = ["scripts/render-worker.mjs", manifestPath, outputPath];
    if (config.uploadRender) childArgs.push("--upload");
    const result = await runNode(childArgs, {
      NOX_SUPABASE_RENDER_EMAIL: process.env.NOX_SUPABASE_RENDER_EMAIL || config.email,
      NOX_SUPABASE_RENDER_PASSWORD: process.env.NOX_SUPABASE_RENDER_PASSWORD || config.password,
      NOX_RENDER_UPLOAD: config.uploadRender ? "1" : process.env.NOX_RENDER_UPLOAD || "0",
    });
    const upload = parseRenderUpload(result.output);
    if (upload && upload.bucket !== "nox-exports") {
      throw new Error(`Render worker uploaded to ${upload.bucket}; expected nox-exports for final MP4 archives.`);
    }
    if (upload) await archiveRenderedAsset(supabase, job, manifest, outputFilename, upload);
    await completeRenderedJob(supabase, job, manifest, outputPath, upload);
    console.log(`Render job ${job.id}: MP4 completed at ${outputPath}${upload ? ` and uploaded to ${upload.bucket}/${upload.path}` : ""}.`);
  } catch (error) {
    await failRenderedJob(supabase, job, error instanceof Error ? error.message : "Render worker failed.");
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function completeRenderedJob(supabase, job, manifest, outputPath, upload) {
  const detail = upload
    ? `Rendered MP4 uploaded to ${upload.bucket}/${upload.path}.`
    : `Rendered MP4 written to ${outputPath}.`;
  const patch = {
    status: "Completed",
    output_payload: {
      text: detail,
      project: job.project,
      route: "generation-worker-render",
      outputPath,
      storageBucket: upload?.bucket,
      storagePath: upload?.path,
      outputFilename: manifest.outputFilename,
    },
    error_message: "",
    cost_actual: 0,
    cost_currency: "USD",
    usage_metadata: {
      route: "generation-worker-render",
      renderer: "ffmpeg",
      upload: Boolean(upload),
      outputPath,
      outputFilename: manifest.outputFilename,
      runtimeSeconds: manifest.runtimeSeconds,
      clipCount: manifest.clips?.length ?? 0,
    },
    completed_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    logs: appendJobLog(job, `Completed: ${detail}`),
  };
  const { error } = await supabase.from("generation_jobs").update(patch).eq("id", job.id);
  if (error) throw new Error(`Rendered job completion update failed: ${error.message}`);
}

async function failRenderedJob(supabase, job, detail) {
  const runAfter = new Date(Date.now() + 60_000).toISOString();
  const { error } = await supabase
    .from("generation_jobs")
    .update({
      status: "Failed",
      output_payload: {
        text: detail,
        project: job.project,
        route: "generation-worker-render",
      },
      error_message: detail,
      usage_metadata: {
        route: "generation-worker-render",
        renderer: "ffmpeg",
        error: detail,
      },
      run_after: runAfter,
      completed_at: null,
      locked_at: null,
      locked_by: null,
      logs: appendJobLog(job, `Failed: ${detail}`),
    })
    .eq("id", job.id);
  if (error) throw new Error(`Rendered job failure update failed: ${error.message}`);
}

async function archiveRenderedAsset(supabase, job, manifest, filename, upload) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("assets").insert({
    id: randomUUID(),
    workspace_id: job.workspaceId,
    project_id: job.projectId || manifest.projectId || null,
    type: "Final Export",
    file_url: "",
    filename,
    mime_type: "video/mp4",
    duration_seconds: manifest.runtimeSeconds ?? 60,
    status: "Stored",
    provider: "NOX Render Worker / FFmpeg",
    notes: `Rendered by ${config.workerId}. Stored at ${upload.bucket}/${upload.path}.`,
    tags: ["export", "render-engine", "nox-cut", "mp4"],
    metadata: {
      attachedTo: `${job.project || "NOX Project"} / Render Engine V1`,
      storagePath: upload.path,
      storageBucket: upload.bucket,
      renderJobId: job.id,
      outputFilename: manifest.outputFilename,
    },
    created_at: now,
    updated_at: now,
  });
  if (error) throw new Error(`Rendered MP4 Asset Vault archive failed: ${error.message}`);
}

function readConfig() {
  const workspaceIds = listValue("NOX_GENERATION_WORKER_WORKSPACE_IDS");
  return {
    url: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
    anonKey: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "",
    email: process.env.NOX_SUPABASE_WORKER_EMAIL || process.env.NOX_GENERATION_WORKER_EMAIL || process.env.NOX_SUPABASE_TEST_EMAIL || "",
    password:
      process.env.NOX_SUPABASE_WORKER_PASSWORD || process.env.NOX_GENERATION_WORKER_PASSWORD || process.env.NOX_SUPABASE_TEST_PASSWORD || "",
    workerId: process.env.NOX_GENERATION_WORKER_ID || `nox-worker-${hostname()}-${process.pid}`,
    workspaceIds,
    once: args.includes("--once") || process.env.NOX_GENERATION_WORKER_ONCE === "1",
    renderEnabled: args.includes("--render") || process.env.NOX_GENERATION_WORKER_RENDER === "1",
    uploadRender: args.includes("--upload") || process.env.NOX_RENDER_UPLOAD === "1",
    intervalMs: Math.max(1000, numberValue("NOX_GENERATION_WORKER_INTERVAL_MS", 15000)),
    maxCycles: numberValue("NOX_GENERATION_WORKER_MAX_CYCLES", 0),
    maxIdleCycles: numberValue("NOX_GENERATION_WORKER_MAX_IDLE_CYCLES", 0),
    renderOutputDir: resolve(process.env.NOX_GENERATION_WORKER_RENDER_DIR || join(root, "dist", "generation-worker-renders")),
    maxDailyCostUsd: numberValue("NOX_GENERATION_WORKER_MAX_DAILY_COST_USD", 0),
    alertWebhookUrl: process.env.NOX_GENERATION_WORKER_ALERT_WEBHOOK_URL || "",
  };
}

function reportedJobCost(job) {
  if (typeof job?.costActual === "number" && Number.isFinite(job.costActual)) return job.costActual;
  const usageCost = Number(job?.usageMetadata?.costActual ?? job?.usageMetadata?.costUsd ?? job?.usageMetadata?.estimatedCostUsd);
  return Number.isFinite(usageCost) ? usageCost : 0;
}

async function notifyWorkerAlert(type, message) {
  if (!config.alertWebhookUrl) return;
  try {
    await fetch(config.alertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        message,
        workerId: config.workerId,
        hostname: hostname(),
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error(`Worker alert webhook failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function listValue(key) {
  return (process.env[key] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function numberValue(key, fallback) {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isRenderJob(job) {
  return /render engine|ffmpeg|mp4 assembly/i.test(`${job.task ?? ""} ${job.provider ?? ""}`);
}

function parseRenderManifest(value) {
  const parsed = parseJsonDeep(value);
  if (parsed?.engine === "NOX Render Engine V1") return parsed;
  if (parsed?.manifest?.engine === "NOX Render Engine V1") return parsed.manifest;
  return undefined;
}

function parseJsonDeep(value) {
  if (!value) return undefined;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.text && typeof parsed.text === "string") return parseJsonDeep(parsed.text);
    return parsed;
  } catch {
    return undefined;
  }
}

function parseRenderUpload(output) {
  const match = output.match(/NOX render worker uploaded\s+([^\s/]+)\/([^\r\n]+)/);
  return match ? { bucket: match[1], path: match[2].trim() } : undefined;
}

function appendJobLog(job, message) {
  return [...(Array.isArray(job.logs) ? job.logs : []), `${new Date().toISOString()} - ${message}`].slice(-12);
}

function safeFilename(filename) {
  const fallback = "nox-render.mp4";
  const source = String(filename || fallback);
  const extension = source.toLowerCase().endsWith(".mp4") ? ".mp4" : ".mp4";
  const stem = basename(source, extension)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${stem || "nox-render"}${extension}`;
}

function runNode(scriptArgs, extraEnv) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, scriptArgs, {
      cwd: root,
      env: {
        ...process.env,
        ...extraEnv,
      },
      shell: process.platform === "win32",
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise({ output });
      else reject(new Error(`${process.execPath} ${scriptArgs.join(" ")} exited with ${code}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
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
