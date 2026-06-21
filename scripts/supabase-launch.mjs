import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply") || process.env.NOX_SUPABASE_DEPLOY_APPLY === "1";
const skipAudit = args.has("--skip-audit") || process.env.NOX_SUPABASE_SKIP_LIVE_AUDIT === "1";

loadDotEnvFiles([".env.local", ".env"]);

const projectRef = value("SUPABASE_PROJECT_REF") || value("NOX_SUPABASE_PROJECT_REF");
const dbUrl = value("SUPABASE_DB_URL");
const migrationDir = join(root, "supabase", "migrations");
const functionsDir = join(root, "supabase", "functions");
const requiredFunctions = ["generate-concept", "generate-scene-prompt", "process-generation-job", "manage-provider-secret"];
const requiredAuditEnv = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "NOX_SUPABASE_TEST_EMAIL",
  "NOX_SUPABASE_TEST_PASSWORD",
];
const optionalStrictIsolationEnv = ["NOX_SUPABASE_OTHER_EMAIL", "NOX_SUPABASE_OTHER_PASSWORD"];
const serverSecretKeys = [
  "XAI_API_KEY",
  "NOX_GROK_API_KEY",
  "NOX_GROK_TEXT_MODEL",
  "NOX_GROK_IMAGE_MODEL",
  "NOX_GROK_VIDEO_MODEL",
  "NOX_GROK_STRICT",
  "NOX_SECRET_ENCRYPTION_KEY",
  "NOX_PROVIDER_CALLBACK_TOKEN",
  "NOX_PROVIDER_CALLBACK_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const migrationFiles = listFiles(migrationDir).filter((file) => file.endsWith(".sql")).sort();
const functionNames = requiredFunctions.filter((name) => existsSync(join(functionsDir, name, "index.ts")));
const missingFunctions = requiredFunctions.filter((name) => !functionNames.includes(name));
const missingAuditEnv = requiredAuditEnv.filter((key) => !value(key));

if (value("NOX_SUPABASE_STRICT_ISOLATION") === "1") {
  for (const key of optionalStrictIsolationEnv) {
    if (!value(key)) missingAuditEnv.push(key);
  }
}

const cli = commandStatus("supabase", ["--version"]);
const runnable = missingFunctions.length === 0 && migrationFiles.length > 0 && cli.ok;

console.log("NOX Supabase production launch");
console.log(`Mode: ${apply ? "apply" : "preflight"}`);
console.log(`Migrations: ${migrationFiles.length} file(s) in supabase/migrations`);
console.log(`Edge Functions: ${functionNames.join(", ") || "none"}`);
console.log(`Supabase CLI: ${cli.ok ? cli.output : "missing"}`);
console.log(`Project link: ${projectRef ? `SUPABASE_PROJECT_REF=${projectRef}` : dbUrl ? "SUPABASE_DB_URL" : "existing CLI link or project ref required"}`);
console.log(`Live audit credentials: ${missingAuditEnv.length ? `missing ${missingAuditEnv.join(", ")}` : "present"}`);
console.log("");

if (!migrationFiles.length) fail("No SQL migrations were found in supabase/migrations.");
if (missingFunctions.length) fail(`Missing Edge Function entrypoints: ${missingFunctions.join(", ")}.`);
if (!cli.ok) fail("Supabase CLI is required. Install it, authenticate with `supabase login`, then rerun this command.");

if (!apply) {
  console.log("Preflight complete. No remote changes were made.");
  console.log("Run `npm run supabase:deploy` to push migrations, deploy functions, set available secrets, and run the live audit.");
  if (missingAuditEnv.length) {
    console.log("Copy `.env.example` to `.env.local`, fill the missing values, then rerun before production launch.");
  }
  process.exit(runnable ? 0 : 1);
}

if (!runnable) process.exit(1);

if (projectRef) {
  run("supabase", ["link", "--project-ref", projectRef], `supabase link --project-ref ${projectRef}`);
}

const dbPushArgs = dbUrl ? ["db", "push", "--db-url", dbUrl] : ["db", "push"];
run("supabase", dbPushArgs, dbUrl ? "supabase db push --db-url [set]" : "supabase db push");

for (const key of serverSecretKeys) {
  const secretValue = value(key);
  if (!secretValue) continue;
  run("supabase", ["secrets", "set", `${key}=${secretValue}`], `supabase secrets set ${key}=[set]`);
}

for (const functionName of requiredFunctions) {
  run("supabase", ["functions", "deploy", functionName], `supabase functions deploy ${functionName}`);
}

if (!skipAudit) {
  if (missingAuditEnv.length) {
    fail(`Live Supabase audit credentials are missing: ${missingAuditEnv.join(", ")}.`);
  }
  run(process.execPath, ["scripts/verify-supabase-live.mjs"], "node scripts/verify-supabase-live.mjs");
} else {
  console.log("Skipped live audit because --skip-audit or NOX_SUPABASE_SKIP_LIVE_AUDIT=1 was set.");
}

console.log("NOX Supabase production launch complete.");

function value(key) {
  const raw = process.env[key];
  if (!raw) return "";
  const trimmed = raw.trim();
  return trimmed && trimmed !== "0" ? trimmed : "";
}

function loadDotEnvFiles(paths) {
  for (const path of paths) {
    const absolutePath = resolve(root, path);
    if (!existsSync(absolutePath)) continue;
    const lines = readFileSync(absolutePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = unwrap(rawValue.trim());
    }
  }
}

function unwrap(rawValue) {
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return rawValue.slice(1, -1);
  }
  return rawValue;
}

function listFiles(directory) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
  return readdirSync(directory).map((file) => join(directory, file));
}

function commandStatus(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return {
    ok: result.status === 0,
    output: result.stdout?.trim() || result.stderr?.trim() || "available",
  };
}

function run(command, commandArgs, display) {
  console.log(`$ ${display}`);
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function fail(message) {
  console.error(`Launch failed: ${message}`);
  process.exit(1);
}
