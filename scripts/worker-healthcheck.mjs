#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

loadDotEnvFiles([".env.local", ".env"]);

const quiet = process.argv.includes("--quiet");
const config = readConfig();

main().catch((error) => {
  console.error(`NOX worker healthcheck failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

async function main() {
  const missing = [];
  if (!config.url) missing.push("VITE_SUPABASE_URL");
  if (!config.anonKey) missing.push("VITE_SUPABASE_ANON_KEY");
  if (!config.email) missing.push("NOX_SUPABASE_WORKER_EMAIL");
  if (!config.password) missing.push("NOX_SUPABASE_WORKER_PASSWORD");
  if (missing.length) {
    throw new Error(`Missing ${missing.join(", ")}.`);
  }

  const supabase = createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: config.email,
    password: config.password,
  });
  if (signInError) throw new Error(`Worker sign-in failed: ${signInError.message}`);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user?.id) {
    throw new Error(userError?.message ?? "Worker sign-in returned no Supabase user.");
  }

  await verifyWorkspaceAccess(supabase);
  await verifyQueueFunction(supabase);

  if (!quiet) {
    const workspaceDetail = config.workspaceIds.length
      ? `${config.workspaceIds.length} configured workspace(s)`
      : "workspace discovery query";
    console.log(`NOX worker healthcheck passed for ${config.email} (${workspaceDetail}).`);
  }
}

async function verifyWorkspaceAccess(supabase) {
  if (config.workspaceIds.length) {
    const { data, error } = await supabase.from("workspaces").select("id").in("id", config.workspaceIds);
    if (error) throw new Error(`Workspace allowlist check failed: ${error.message}`);
    const visible = new Set((data ?? []).map((row) => row.id));
    const missing = config.workspaceIds.filter((id) => !visible.has(id));
    if (missing.length) {
      throw new Error(`Worker account cannot read configured workspace(s): ${missing.join(", ")}.`);
    }
    return;
  }

  const { error } = await supabase.from("workspaces").select("id").limit(1);
  if (error) throw new Error(`Workspace discovery check failed: ${error.message}`);
}

async function verifyQueueFunction(supabase) {
  const { data, error } = await supabase.functions.invoke("process-generation-job", {
    body: { action: "health" },
  });
  if (error) throw new Error(`process-generation-job health action failed: ${error.message}`);
  if (!data?.ok || data?.function !== "process-generation-job") {
    throw new Error("process-generation-job health action returned an unexpected payload.");
  }
}

function readConfig() {
  return {
    url: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
    anonKey: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "",
    email: process.env.NOX_SUPABASE_WORKER_EMAIL || process.env.NOX_GENERATION_WORKER_EMAIL || process.env.NOX_SUPABASE_TEST_EMAIL || "",
    password:
      process.env.NOX_SUPABASE_WORKER_PASSWORD || process.env.NOX_GENERATION_WORKER_PASSWORD || process.env.NOX_SUPABASE_TEST_PASSWORD || "",
    workspaceIds: listValue("NOX_GENERATION_WORKER_WORKSPACE_IDS"),
  };
}

function listValue(key) {
  return (process.env[key] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
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
