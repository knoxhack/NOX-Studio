import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = process.cwd();
const failures = [];
const passes = [];

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function check(label, condition) {
  if (condition) passes.push(label);
  else failures.push(label);
}

function has(text, pattern) {
  return pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);
}

const migrationFiles = [
  "supabase/migrations/202606200001_nox_studio_v1.sql",
  "supabase/migrations/202606200002_timeline_trim_notes.sql",
  "supabase/migrations/202606200003_continuity_records.sql",
  "supabase/migrations/202606200004_provider_settings.sql",
  "supabase/migrations/202606200005_generation_job_lifecycle.sql",
  "supabase/migrations/202606200006_generation_job_queue_claims.sql",
  "supabase/migrations/202606200007_provider_connection_settings.sql",
  "supabase/migrations/202606200008_generation_job_cost_usage.sql",
  "supabase/migrations/202606200009_workspace_provider_secrets.sql",
];
const migrations = migrationFiles.map(read).join("\n").toLowerCase();

const requiredTables = [
  "profiles",
  "workspaces",
  "workspace_members",
  "projects",
  "characters",
  "worlds",
  "locations",
  "factions",
  "scenes",
  "scene_beats",
  "assets",
  "generation_jobs",
  "publish_kits",
  "timeline_items",
  "brand_kits",
  "provider_settings",
  "workspace_provider_secrets",
];

for (const table of requiredTables) {
  check(`table public.${table}`, has(migrations, new RegExp(`create\\s+table\\s+public\\.${table}\\b`)));
  check(`RLS enabled on public.${table}`, has(migrations, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`)));
  check(`policy on public.${table}`, has(migrations, new RegExp(`create\\s+policy\\s+\\w+\\s+on\\s+public\\.${table}\\b`)));
}

for (const bucket of ["nox-videos", "nox-images", "nox-audio", "nox-exports", "nox-brand"]) {
  check(`private storage bucket ${bucket}`, has(migrations, `'${bucket}', '${bucket}', false`));
}

for (const policy of [
  "storage_workspace_read",
  "storage_workspace_write",
  "storage_workspace_update",
  "storage_workspace_delete",
]) {
  check(`storage policy ${policy}`, has(migrations, new RegExp(`create\\s+policy\\s+${policy}\\s+on\\s+storage\\.objects`)));
}

check("scene_beats documented as internal prompt instructions", has(migrations, "these are not separate generated video files"));
check("timeline trim notes migration present", has(migrations, "trim_start_note") && has(migrations, "trim_end_note") && has(migrations, "editor_notes"));
check("continuity records migration present", has(migrations, "reference_image_url") && has(migrations, "timeline_notes"));
check("generation job lifecycle migration present", has(migrations, "retry_count") && has(migrations, "max_retries") && has(migrations, "logs jsonb"));
check("generation job queue claim migration present", has(migrations, "claim_next_generation_job") && has(migrations, "for update skip locked") && has(migrations, "locked_at") && has(migrations, "run_after") && has(migrations, "priority"));
check("provider connection settings migration present", has(migrations, "api_endpoint") && has(migrations, "secret_name") && has(migrations, "webhook_enabled") && has(migrations, "connection_status") && has(migrations, "provider_settings_workspace_connection_idx"));
check("generation job cost usage migration present", has(migrations, "cost_actual") && has(migrations, "cost_currency") && has(migrations, "usage_metadata") && has(migrations, "generation_jobs_workspace_cost_idx"));
check("workspace provider secrets migration present", has(migrations, "workspace_provider_secrets") && has(migrations, "encrypted_secret") && has(migrations, "nonce") && has(migrations, "workspace_provider_secrets_no_direct_access"));

const auth = read("src/lib/auth.ts");
check("email/password Supabase auth path", has(auth, "signInWithPassword"));
check("email/password Supabase sign-up path", has(auth, "signUpWithEmail") && has(auth, "auth.signUp"));
check("Supabase password reset path", has(auth, "sendPasswordReset") && has(auth, "resetPasswordForEmail"));
check("Google OAuth auth path", has(auth, 'provider: "google"') && has(auth, "signInWithOAuth"));
check("session boot auth path", has(auth, "auth.getUser"));
check("sign out auth path", has(auth, "auth.signOut"));
check("local demo auth fallback", has(auth, 'mode: "local"'));

const store = read("src/lib/studioStore.ts");
check("local state normalizes stale blob character references", has(store, "normalizeCharacterReferences") && has(store, 'referenceImageUrl?.startsWith("blob:")') && has(store, "referenceAsset?.storagePath"));

const loginScreen = read("src/screens/LoginScreen.tsx");
check("Login screen exposes sign-in/create/reset modes", has(loginScreen, "Create Studio Access") && has(loginScreen, "Reset Access") && has(loginScreen, "Send Reset Email"));
check("Login screen routes create account", has(loginScreen, "onCreateAccount") && has(loginScreen, "Create Account"));
check("Login screen routes password reset", has(loginScreen, "onResetPassword") && has(loginScreen, "Reset"));

const createWizard = read("src/screens/CreateWizard.tsx");
check("Create Wizard sends editable language settings", has(createWizard, "languagePresets") && has(createWizard, "setLanguage") && has(createWizard, "language,"));
check("Create Wizard exposes prompt/dialogue/subtitle/voice inputs", has(createWizard, "Prompt language") && has(createWizard, "Dialogue language") && has(createWizard, "Subtitles") && has(createWizard, "Voice style"));

const storage = read("src/lib/storage.ts");
for (const bucket of ["nox-videos", "nox-images", "nox-audio", "nox-exports", "nox-brand"]) {
  check(`storage adapter maps ${bucket}`, has(storage, `"${bucket}"`));
}
check("Supabase Storage upload path", has(storage, ".storage.from(bucket).upload"));
check("Supabase Storage signed URL preview", has(storage, ".storage.from(bucket).createSignedUrl"));
check("local asset preview fallback", has(storage, "URL.createObjectURL"));
check("storage adapter supports character-scoped reference paths", has(storage, "characterId?: string") && has(storage, '"characters"') && has(storage, "characterId, objectName"));
check("storage adapter supports brand-scoped files", has(storage, '"Brand File"') && has(storage, "brandFile?: boolean") && has(storage, '"brand"'));
check("storage adapter creates collision-safe object paths", has(storage, "makeStorageObjectName") && has(storage, "makeStoragePathId") && has(storage, "safeStem") && has(storage, "upsert: false"));

const liveAudit = read("scripts/verify-supabase-live.mjs");
check("live Supabase audit script exists", has(liveAudit, "NOX_SUPABASE_TEST_EMAIL") && has(liveAudit, "NOX_SUPABASE_TEST_PASSWORD"));
check("live Supabase audit signs in with Auth", has(liveAudit, "signInWithPassword") && has(liveAudit, "auth.getUser"));
check("live Supabase audit checks RLS tables", has(liveAudit, "requiredTables") && has(liveAudit, "select(\"*\", { count: \"exact\", head: true })"));
check("live Supabase audit verifies workspace membership readback", has(liveAudit, 'from("workspace_members").select("*")') && has(liveAudit, "Workspace member readback"));
check("live Supabase audit verifies provider settings readback", has(liveAudit, 'from("provider_settings")') && has(liveAudit, "Provider settings readback did not preserve Manual Mode routing"));
check("live Supabase audit verifies Grok provider connection metadata", has(liveAudit, "Provider settings readback did not preserve Grok connection metadata") && has(liveAudit, "provider_id === \"grok\"") && has(liveAudit, "connection_status"));
check(
  "live Supabase audit exercises Edge Functions",
  has(liveAudit, 'functions.invoke("generate-concept"') &&
    has(liveAudit, 'functions.invoke("generate-scene-prompt"') &&
    has(liveAudit, 'functions.invoke("process-generation-job"'),
);
check("live Supabase audit verifies language propagation", has(liveAudit, "auditLanguage") && has(liveAudit, "Generated package did not preserve custom project language settings") && has(liveAudit, "Polished prompt did not preserve custom language settings"));
check("live Supabase audit verifies deployed provider runtime health", has(liveAudit, "getFunctionRuntimeHealth") && has(liveAudit, "grokConfigured") && has(liveAudit, "grokTextModel") && has(liveAudit, "did not report provider runtime configuration"));
check("live Supabase audit can require Grok-backed generation", has(liveAudit, "NOX_LIVE_AUDIT_REQUIRE_GROK") && has(liveAudit, "reports ${runtime.provider} is not configured"));
check("live Supabase audit verifies Grok secret manager", has(liveAudit, "verifyGrokSecretManager") && has(liveAudit, "NOX_LIVE_AUDIT_TEST_GROK_SECRET") && has(liveAudit, "manage-provider-secret"));
check("live Supabase audit can verify Grok media jobs", has(liveAudit, "verifyOptionalGrokMediaJobs") && has(liveAudit, "NOX_LIVE_AUDIT_RUN_GROK_MEDIA") && has(liveAudit, "grok-image") && has(liveAudit, "grok-video"));
check("live Supabase audit verifies private Storage", has(liveAudit, "storageBuckets") && has(liveAudit, ".storage.from(bucket).upload") && has(liveAudit, ".createSignedUrl"));
check("live Supabase audit persists full V1 package", has(liveAudit, "saveProductionPackage") && has(liveAudit, "scene_beats") && has(liveAudit, "publish_kits") && has(liveAudit, "timeline_items"));
check("live Supabase audit verifies generation job lifecycle", has(liveAudit, "Generation job lifecycle readback") && has(liveAudit, "retry_count") && has(liveAudit, "max_retries") && has(liveAudit, "Array.isArray(job.logs)"));
check("live Supabase audit verifies actual cost usage metadata", has(liveAudit, "costActual: 1.25") && has(liveAudit, "providerCredits") && has(liveAudit, "actual cost and usage metadata"));
check("live Supabase audit verifies remote generation job processor", has(liveAudit, "verifyGenerationJobProcessor") && has(liveAudit, 'functions.invoke("process-generation-job"') && has(liveAudit, "output_payload?.route"));
check("live Supabase audit verifies continuity review processor", has(liveAudit, "verifyContinuityJobProcessor") && has(liveAudit, "Grok Continuity") && has(liveAudit, "continuity-review") && has(liveAudit, "structured report"));
check("live Supabase audit verifies queue worker claim path", has(liveAudit, "verifyGenerationQueueWorker") && has(liveAudit, 'action: "process-next"') && has(liveAudit, "process-next did not claim") && has(liveAudit, "job: null"));
check("live Supabase audit supports provider callback ingestion", has(liveAudit, "verifyProviderCallback") && has(liveAudit, 'action: "provider-callback"') && has(liveAudit, "NOX_PROVIDER_CALLBACK_TOKEN") && has(liveAudit, "Provider callback did not persist approved Scene Card asset linkage"));
check("live Supabase audit verifies release operation processing", has(liveAudit, "verifyReleaseOperationProcessor") && has(liveAudit, "TikTok release operation") && has(liveAudit, "Release operation did not persist Scheduled status") && has(liveAudit, 'route !== "release-operation"'));
check("live Supabase audit verifies fresh-session reload survival", has(liveAudit, "verifyFreshSessionReload") && has(liveAudit, "fresh-session reload user") && has(liveAudit, "Fresh-session reload did not preserve") && has(liveAudit, ".createSignedUrl(videoUpload.path"));
check("live Supabase audit verifies edited Scene Beat replacement", has(liveAudit, "verifySceneBeatReplacement") && has(liveAudit, "Edited Scene Beat replacement did not remove stale rows"));
check("live Supabase audit cleans up workspace and objects", has(liveAudit, "cleanupAuditData") && has(liveAudit, "NOX_LIVE_AUDIT_KEEP_DATA"));
check("live Supabase audit fails on cleanup errors", has(liveAudit, "NOX live Supabase cleanup failed") && has(liveAudit, "process.exitCode = 1"));
check("live Supabase audit verifies Storage cleanup", has(liveAudit, ".storage.from(bucket).remove([path])") && has(liveAudit, ".storage.from(bucket).list(prefix") && has(liveAudit, "Storage cleanup left"));
check("live Supabase audit verifies workspace cleanup", has(liveAudit, 'from("workspaces").delete().eq("id", workspaceId).select("id")') && has(liveAudit, "Workspace cleanup left workspace visible"));
check("live Supabase audit supports second-user RLS isolation", has(liveAudit, "verifyWorkspaceIsolation") && has(liveAudit, "NOX_SUPABASE_OTHER_EMAIL") && has(liveAudit, "NOX_SUPABASE_STRICT_ISOLATION"));
check("live Supabase audit denies outsider workspace and Storage access", has(liveAudit, "Secondary user can read the primary audit workspace") && has(liveAudit, "Secondary user can create a signed URL") && has(liveAudit, "Secondary user can upload into the primary workspace storage prefix"));

const supabaseLaunch = read("scripts/supabase-launch.mjs");
check("Supabase launch script loads .env.local", has(supabaseLaunch, 'loadDotEnvFiles([".env.local", ".env"])') && has(supabaseLaunch, "SUPABASE_PROJECT_REF") && has(supabaseLaunch, "SUPABASE_DB_URL"));
check("Supabase launch script deploys migrations", has(supabaseLaunch, '"db", "push"') && has(supabaseLaunch, "supabase db push"));
check("Supabase launch script deploys required Edge Functions", has(supabaseLaunch, "generate-concept") && has(supabaseLaunch, "generate-scene-prompt") && has(supabaseLaunch, "process-generation-job") && has(supabaseLaunch, "manage-provider-secret") && has(supabaseLaunch, '"functions", "deploy"'));
check("Supabase launch script sets server-side secrets", has(supabaseLaunch, "XAI_API_KEY") && has(supabaseLaunch, "NOX_GROK_TEXT_MODEL") && has(supabaseLaunch, "NOX_GROK_IMAGE_MODEL") && has(supabaseLaunch, "NOX_GROK_VIDEO_MODEL") && has(supabaseLaunch, "NOX_SECRET_ENCRYPTION_KEY") && has(supabaseLaunch, '"secrets", "set"'));
check("Supabase launch script sets provider callback secrets", has(supabaseLaunch, "NOX_PROVIDER_CALLBACK_TOKEN") && has(supabaseLaunch, "NOX_PROVIDER_CALLBACK_URL") && has(supabaseLaunch, "SUPABASE_SERVICE_ROLE_KEY"));
check("Supabase launch script runs live audit", has(supabaseLaunch, "scripts/verify-supabase-live.mjs") && has(supabaseLaunch, "NOX_SUPABASE_SKIP_LIVE_AUDIT"));

const repository = read("src/lib/studioRepository.ts");
check("Scene Card metadata maps prompt copied marker", has(repository, "promptCopiedAt"));
check("Scene Card metadata maps external provider", has(repository, "externalProvider"));
check("Repository replaces Scene Card beat rows on save", has(repository, 'from("scene_beats").delete().eq("scene_id", scene.id)') && has(repository, "scene.beats.map((beat, index) => beatToRow(beat, scene.id, index))"));
check("Asset metadata maps prompt snapshot", has(repository, "promptUsed") && has(repository, "prompt_id"));
check("Repository persists first-class locations", has(repository, "upsertLocation") && has(repository, "rowToLocation") && has(repository, 'from("locations")'));
check("Repository persists first-class factions", has(repository, "upsertFaction") && has(repository, "rowToFaction") && has(repository, 'from("factions")'));
check("Supabase project delete clears linked asset rows", has(repository, 'deleteLinkedAssets(supabase, "project_id", projectId)'));
check("Supabase scene delete clears linked assets and timeline rows", has(repository, 'deleteLinkedAssets(supabase, "scene_id", sceneId)') && has(repository, 'from("timeline_items").delete().eq("scene_id", sceneId)'));
check("Supabase asset cleanup removes storage objects", has(repository, "assetStorageBuckets") && has(repository, ".storage.from(bucket).remove(paths)"));
check("Repository can delete individual assets with storage cleanup", has(repository, "deleteAsset(assetId)") && has(repository, 'deleteAssetRows(supabase, "id", assetId)'));
check("Repository cleans up Brand File storage objects", has(repository, '"Brand File": "nox-brand"'));
check("Repository can update generation job lifecycle", has(repository, "upsertGenerationJob") && has(repository, 'from("generation_jobs").upsert(generationJobToRow(job))'));
check("Repository maps generation job retry logs", has(repository, "retryCount: asNumber(row.retry_count") && has(repository, "logs: asTextArray(row.logs)") && has(repository, "startedAt: formatOptionalDate(row.started_at)") && has(repository, "retry_count: job.retryCount"));
check("Repository maps generation job queue claim fields", has(repository, "priority: asNumber(row.priority") && has(repository, "runAfter: formatOptionalDate(row.run_after)") && has(repository, "lockedAt: formatOptionalDate(row.locked_at)") && has(repository, "run_after: dateOrNow(job.runAfter)"));
check("Repository maps generation job actual cost usage", has(repository, "costActual:") && has(repository, "cost_actual: job.costActual") && has(repository, "usageMetadata") && has(repository, "usage_metadata"));
check("Repository persists Brand Kit watermark asset id", has(repository, "watermarkAssetId") && has(repository, "watermark_asset_id"));
check("Repository maps Scene Card approved asset id", has(repository, "approvedAssetId: asText(row.approved_asset_id") && has(repository, "approved_asset_id: scene.approvedAssetId"));
check("Repository self-heals owner workspace membership", has(repository, "ensureWorkspaceMembership") && has(repository, "workspace.ownerId === user.id") && has(repository, 'onConflict: "workspace_id,user_id"'));
check("Repository persists provider settings", has(repository, "upsertProvider") && has(repository, 'from("provider_settings")') && has(repository, "mergeProviderSettings"));
check("Repository maps provider connection settings", has(repository, "apiEndpoint: asText(row.api_endpoint") && has(repository, "secretName: asText(row.secret_name") && has(repository, "webhookEnabled: Boolean(row.webhook_enabled)") && has(repository, "connection_status: provider.connectionStatus"));
check("Repository backfills workspace settings defaults", has(repository, "backfillWorkspaceDefaults") && has(repository, "if (!brandKitRow)") && has(repository, "missingProviders"));
check("Repository reports default settings seed errors", has(repository, "brandKitSeed.error") && has(repository, "providerSettingsError"));

const types = read("src/types.ts");
check("StudioAsset supports prompt lineage", has(types, "promptUsed?: string") && has(types, "promptId?: string"));
check("StudioState supports continuity records", has(types, "LocationEntry") && has(types, "FactionEntry"));

const gateway = read("src/lib/generationGateway.ts");
check("concept generation gateway invokes Edge Function", has(gateway, '"generate-concept"'));
check("scene prompt gateway invokes Edge Function", has(gateway, '"generate-scene-prompt"'));
check("generation job gateway invokes Edge Function", has(gateway, '"process-generation-job"') && has(gateway, "runRemoteGenerationJob"));
check("concept generation local fallback", has(gateway, "createProductionPackage(input)"));
check("scene regenerate local fallback", has(gateway, "regenerateScenePrompt"));
check("scene polish local fallback", has(gateway, "polishScenePrompt"));

const jobRunner = read("src/lib/generationJobRunner.ts");
check("Generation job runner exists", has(jobRunner, "runGenerationJob") && has(jobRunner, "GenerationJobRunResult"));
check("Generation job runner resolves workspace providers", has(jobRunner, "resolveJobProvider") && has(jobRunner, "providers.find") && has(jobRunner, "provider.enabled"));
check("Generation job runner preserves actual cost usage", has(jobRunner, "costActual") && has(jobRunner, "costCurrency") && has(jobRunner, "usageMetadata"));
check("Generation job runner executes prompt jobs", has(jobRunner, "runScenePromptJob") && has(jobRunner, "generateScenePrompt") && has(jobRunner, "Supabase Edge Function"));
check("Generation job runner executes continuity review jobs", has(jobRunner, "runContinuityReviewJob") && has(jobRunner, "runContinuityCheck") && has(jobRunner, "NOX Continuity Review"));
check("Generation job runner routes Grok image jobs", has(jobRunner, "runImageGenerationHandoffJob") && has(jobRunner, "grok-image") && has(jobRunner, "resolveImageAssetType"));
check("Generation job runner routes video handoffs", has(jobRunner, "runVideoProviderHandoffJob") && has(jobRunner, "provider.mode === \"API\"") && has(jobRunner, "Manual"));
check("Generation job runner routes render handoffs", has(jobRunner, "runRenderHandoffJob") && has(jobRunner, "createRenderManifest") && has(jobRunner, "summarizeRenderReadiness") && has(jobRunner, "npm run render:worker"));
check("Generation job runner processes release operations", has(jobRunner, "runReleaseOperationJob") && has(jobRunner, "NOX Release Operation Result") && has(jobRunner, "Upload or schedule the final package"));

const noxCore = read("src/lib/noxCore.ts");
check("NOX Core accepts project language input", has(noxCore, "language?: Project[\"language\"]") && has(noxCore, "const language = input.language ??") && has(noxCore, "regenerateScenePrompt(scene, input.target, { language })"));
check("NOX Cut edit plan sorts timeline by time and track priority", has(noxCore, "compareTimelineItems") && has(noxCore, "trackSortRank") && has(noxCore, "a.startTime - b.startTime"));
check("NOX Cut edit plan prefers approved asset ids", has(noxCore, "scene.approvedAssetId ? assetsById.get(scene.approvedAssetId)") && has(noxCore, "candidate.id === scene.approvedAssetId"));
check("Publish Kit exports plain text production packages", has(noxCore, "export function exportProjectText") && has(noxCore, "NOX STUDIO PRODUCTION PACKAGE") && has(noxCore, "PUBLISH KIT"));
check("Publish Kit creates platform release bundles", has(noxCore, "createReleaseBundle") && has(noxCore, "ReleasePlatform") && has(noxCore, "TikTok") && has(noxCore, "YouTube") && has(noxCore, "NOX Films"));
check("Release bundles include files, schedule, presets, and checklist", has(noxCore, "getReleasePlatformPreset") && has(noxCore, "schedule:") && has(noxCore, "finalVideo") && has(noxCore, "checklist") && has(noxCore, "exportReleaseBundleJson"));
check("NOX Core creates release operation plans", has(noxCore, "createReleaseOperationPlan") && has(noxCore, "NOX Release Operation") && has(noxCore, "blockers") && has(noxCore, "Upload or schedule"));

const renderEngine = read("src/lib/renderEngine.ts");
check("Render Engine V1 creates FFmpeg manifest", has(renderEngine, "createRenderManifest") && has(renderEngine, "NOX Render Engine V1") && has(renderEngine, "scripts/render-nox-cut.mjs"));
check("Render manifest carries workspace id and worker script", has(renderEngine, "workspaceId: string") && has(renderEngine, "workspaceId: state.workspace.id") && has(renderEngine, 'workerScript: "scripts/render-worker.mjs"'));
check("Render manifest requires approved scene video assets", has(renderEngine, "scene.approvedAssetId") && has(renderEngine, 'asset.status === "Approved"') && has(renderEngine, "missingReason"));
check("Render manifest preserves timeline utility tracks", has(renderEngine, "toRenderUtilityTrack") && has(renderEngine, "subtitleText") && has(renderEngine, "textOverlay"));
check("Render manifest carries utility asset lineage", has(renderEngine, "assetSourceUrl") && has(renderEngine, "assetStoragePath") && has(renderEngine, "assetMimeType") && has(renderEngine, "assetsById.get(item.assetId)"));
check("Render manifest exports readiness summary", has(renderEngine, "summarizeRenderReadiness") && has(renderEngine, "clips ready for MP4 assembly"));

const diagnostics = read("src/lib/productionDiagnostics.ts");
const providerReadiness = read("src/lib/providerReadiness.ts");
check("provider readiness helper classifies routes", has(providerReadiness, "assessProviderReadiness") && has(providerReadiness, "API route ready") && has(providerReadiness, "Manual route ready") && has(providerReadiness, "Webhook incomplete"));
check("provider readiness helper protects browser secrets", has(providerReadiness, "Browser-safe: no raw provider key stored") && has(providerReadiness, "providerConnectionStatusFromReadiness") && has(providerReadiness, "Secret missing"));
check("provider readiness helper validates webhook endpoints", has(providerReadiness, "new URL(endpoint)") && has(providerReadiness, "https:") && has(providerReadiness, "localhost"));
check("production diagnostics checks Supabase runtime config", has(diagnostics, "getSupabaseRuntimeInfo"));
check("production diagnostics checks auth session", has(diagnostics, "auth.getUser"));
check("production diagnostics checks RLS tables", has(diagnostics, "requiredTables") && has(diagnostics, '.from(table).select("*"'));
check("production diagnostics checks Storage buckets", has(diagnostics, "storageBuckets") && has(diagnostics, ".storage.from(bucket).upload") && has(diagnostics, ".createSignedUrl") && has(diagnostics, ".remove([path])"));
check("production diagnostics uses active workspace for Storage", has(diagnostics, "workspaceId") && has(diagnostics, "_diagnostics"));
check("production diagnostics checks provider routes", has(diagnostics, "checkProviderRoutes") && has(diagnostics, 'from("provider_settings")') && has(diagnostics, "assessProviderReadiness") && has(diagnostics, "Provider route:"));
check("production diagnostics checks Edge Functions", has(diagnostics, "generate-concept") && has(diagnostics, "generate-scene-prompt") && has(diagnostics, "process-generation-job") && has(diagnostics, 'action: "health"'));
check("production diagnostics reports provider runtime readiness", has(diagnostics, "getFunctionRuntimeHealth") && has(diagnostics, "grokConfigured") && has(diagnostics, "grokTextModel") && has(diagnostics, "deterministic NOX Core fallback"));
check("production diagnostics checks job processor runtime readiness", has(diagnostics, "authRequired") && has(diagnostics, "supabaseConfigured") && has(diagnostics, "authenticated Supabase runtime readiness"));
check("production diagnostics fails stale Edge Function health", has(diagnostics, "does not report provider runtime metadata") && has(diagnostics, "Redeploy the current Edge Function"));

const sceneComposer = read("src/screens/SceneComposer.tsx");
check("Scene Composer marks prompt copy state", has(sceneComposer, "onCopyPrompt"));
check("Scene Composer exposes external provider state", has(sceneComposer, "External Provider"));
check("Scene Composer exposes prompt copied state", has(sceneComposer, "Prompt Copied"));
check("Scene Composer exposes continuity checker", has(sceneComposer, "Continuity Check") && has(sceneComposer, "matchedCharacters"));
check("Scene Composer gates manual approval controls", has(sceneComposer, "hasSceneVideo") && has(sceneComposer, "hasApprovedSceneVideo") && has(sceneComposer, "Upload a generated video before approval") && has(sceneComposer, "Approve an uploaded scene video before timeline assembly"));
check("Scene Composer supports 1-3 editable beats", has(sceneComposer, "const addBeat") && has(sceneComposer, "const deleteBeat") && has(sceneComposer, "draft.beats.length >= 3") && has(sceneComposer, "draft.beats.length <= 1") && has(sceneComposer, "createDraftBeat"));

const settingsScreen = read("src/screens/SettingsScreen.tsx");
check("Settings exposes production readiness diagnostics", has(settingsScreen, "Production Readiness") && has(settingsScreen, "runProductionDiagnostics"));
check("Settings passes workspace id into diagnostics", has(settingsScreen, "workspaceId") && has(settingsScreen, "runProductionDiagnostics({ workspaceId })"));
check("Settings shows diagnostic status rows", has(settingsScreen, "diagnostic-row") && has(settingsScreen, "Run Check"));
check("Settings uploads Brand Kit watermark assets", has(settingsScreen, "Upload Watermark") && has(settingsScreen, "onUploadWatermark") && has(settingsScreen, "watermarkAssetId"));
check("Settings routes provider preference toggles", has(settingsScreen, "onToggleProvider") && has(settingsScreen, "provider.enabled"));
check("Settings edits provider API connection metadata", has(settingsScreen, "ProviderConnectionEditor") && has(settingsScreen, "Webhook endpoint") && has(settingsScreen, "Supabase secret name") && has(settingsScreen, "Use API webhook") && has(settingsScreen, "connectionStatus"));
check("Settings surfaces provider route readiness", has(settingsScreen, "assessProviderReadiness") && has(settingsScreen, "provider-readiness") && has(settingsScreen, "readiness.routeLabel") && has(settingsScreen, "providerConnectionStatusFromReadiness"));
check("Settings separates Grok key vault routing from generic webhooks", has(settingsScreen, "GrokKeyManager") && has(settingsScreen, 'provider.id !== "grok"') && has(settingsScreen, "getGrokKeyStatus") && has(settingsScreen, "saveGrokKey"));
check("Settings uses provider-specific secret placeholders", has(settingsScreen, "getProviderSecretPlaceholder") && has(settingsScreen, "Managed by Grok API Key"));

const projectLibrary = read("src/screens/ProjectLibrary.tsx");
check("Project Library exposes project CRUD controls", has(projectLibrary, "onUpdateProject") && has(projectLibrary, "onDeleteProject") && has(projectLibrary, "ProjectEditForm"));
check("Project Library search covers saved production fields", has(projectLibrary, "project.aiTarget") && has(projectLibrary, "project.language.voiceStyle") && has(projectLibrary, "project.synopsis"));
check("Project Library sorts recently updated projects", has(projectLibrary, 'sortBy === "Recently updated"') && has(projectLibrary, "parseUpdatedAtRank") && has(projectLibrary, "Date.parse"));

const app = read("src/App.tsx");
check("Project edits refresh update timestamp", has(app, "const updateProject = (project: Project)") && has(app, "{ ...project, updatedAt: nowLabel() }"));
check("Project pipeline derives from Scene Card workflow status", has(app, "function deriveProjectProgress") && has(app, "function deriveProjectNextStep") && has(app, '"Generating Videos"') && has(app, "Review Scene") && has(app, "Upload Scene"));
check("Manual queue and upload sync Project Library progress", has(app, 'updateProjectProgress(scene.projectId') && has(app, '"Video queue scene state"') && has(app, '"Scene video attachment"'));
check("Asset Vault video upload attaches selected Scene Card", has(app, 'const linkedScene = type === "Video" ? selectedScene : undefined') && has(app, "sceneId: linkedScene?.id") && has(app, 'status: linkedScene ? "Needs Review" : "Stored"') && has(app, "uploadedAsset: file.name") && has(app, 'status: "Video Uploaded"'));
check("Asset Vault video upload creates review job and progress sync", has(app, '"Vault scene video upload"') && has(app, '"Vault scene video attachment"') && has(app, '"Vault video upload job"') && has(app, "updateProjectProgress(nextScene.projectId"));
check("Local world delete clears child continuity records", has(app, "locations: current.locations.filter((item) => item.worldId !== worldId)") && has(app, "factions: current.factions.filter((item) => item.worldId !== worldId)"));
check("Asset review updates linked scene and generation job status", has(app, "sceneStatusForAssetStatus") && has(app, "jobStatusForAssetStatus") && has(app, "repository.upsertGenerationJob(job)"));
check("Asset approval links reviewed scene video to NOX Cut timeline", has(app, "buildApprovedAssetTimelineItem") && has(app, "assetId: asset.id") && has(app, "Timeline asset review link") && has(app, "and linked to NOX Cut"));
check("Scene status cannot approve without uploaded video", has(app, "Upload a generated scene video before approving this Scene Card") && has(app, "assetToApprove") && has(app, "updateAssetStatus(assetToApprove.id, \"Approved\")"));
check("Scene timeline send requires approved asset", has(app, "Approve an uploaded scene video before sending this Scene Card to NOX Cut") && has(app, "if (!approvedAsset) return current") && has(app, "buildApprovedAssetTimelineItem(approvedAsset, nextScene"));
check("Asset review keeps Scene Card uploaded asset filename in sync", has(app, "uploadedAsset:") && has(app, 'status === "Approved" || status === "Needs Review"') && has(app, "asset.filename"));
check("Asset approval persists canonical approved asset id", has(app, "approvedAssetId:") && has(app, "? asset.id") && has(app, "linkedScene.approvedAssetId === asset.id"));
check("Asset delete clears scene video and timeline source links", has(app, "const deleteAsset = (assetId: string)") && has(app, "repository.deleteAsset(assetId)") && has(app, "appendAssetDeletedNote") && has(app, "status: \"Needs Redo\""));
check("Character reference upload creates linked Asset Vault image", has(app, "uploadCharacterReference") && has(app, "characterId,") && has(app, "type: \"Image\"") && has(app, "tags: [\"character-reference\""));
check("Character reference stores stable storage path", has(app, "const referencePointer = upload.path") && has(app, "referenceImageUrl: referencePointer"));
check("Manual generation queue status updates persist", has(app, "updateGenerationJobStatus") && has(app, "sceneStatusForGenerationJob") && has(app, "onUpdateGenerationJobStatus={updateGenerationJobStatus}"));
check("Generation jobs append lifecycle logs and retries", has(app, "appendGenerationJobLog") && has(app, "withGenerationJobRetry") && has(app, "retryGenerationJob") && has(app, "retryCount >= maxRetries"));
check("Generation Queue Run button invokes job runner", has(app, "runQueuedGenerationJob") && has(app, "runGenerationJob({") && has(app, 'status === "Running"') && has(app, "Generation job runner result"));
check("Generation Queue Run button prefers remote Supabase processor", has(app, "runRemoteGenerationJob") && has(app, "isSupabaseConfigured ? await runRemoteGenerationJob") && has(app, "Supabase Edge processor fallback"));
check("App exposes batch generation operator actions", has(app, "queueAllMissingVideos") && has(app, "queuePublishMediaJobs") && has(app, "retryFailedGenerationJobs") && has(app, "approvePassingGeneratedAssets"));
check("App records Grok media job metadata", has(app, "grok-video") && has(app, "grok-image") && has(app, "grok-imagine-video") && has(app, "grok-imagine-image-quality"));
check("Provider toggles persist to repository", has(app, "const updateProvider = (providerId: string, enabled: boolean)") && has(app, "repository.upsertProvider(updatedProvider, state.workspace.id)"));
check("Provider connection edits persist to repository", has(app, "const updateProviderSettings = (updatedProvider: Provider)") && has(app, "onUpdateProvider={updateProviderSettings}"));
check("Publish Kit edits persist and sync release status", has(app, "const updatePublishKit = (kit: PublishKit)") && has(app, "repository.upsertPublishKit(nextKit)") && has(app, "Project release status") && has(app, "onUpdate={updatePublishKit}"));
check("App routes Publish Kit TXT exports", has(app, 'format === "txt"') && has(app, "exportProjectText(state, activeProject.id)") && has(app, "TXT production package exported."));
check("App routes platform release bundle exports", has(app, "exportReleaseBundle") && has(app, "exportReleaseBundleJson(state, activeProject.id, platform)") && has(app, "release-bundle") && has(app, "onExportReleaseBundle={exportReleaseBundle}"));
check("App queues platform release operations", has(app, "queueReleaseOperation") && has(app, "createReleaseOperationPlan") && has(app, "Release operation job") && has(app, "onQueueReleaseOperation={queueReleaseOperation}"));
check("App builds Publish Kit release operation preflight plans", has(app, "releaseOperationPlans") && has(app, "releasePlatforms.map") && has(app, "createReleaseOperationPlan(state, activeProject.id, platform)") && has(app, "releaseOperationPlans={releaseOperationPlans}"));
check("Generated exports archive into Asset Vault", has(app, "downloadAndArchiveExport") && has(app, 'type: "Final Export"') && has(app, "repository.createAsset(asset)") && has(app, "Saved to Asset Vault"));
check("Generated exports create queue jobs", has(app, "Archive export") && has(app, "Export archive job") && has(app, "Export archive job completed") && has(app, "Export archive job failed"));
check("Generated exports upload through nox-exports storage", has(app, "uploadStudioFile({") && has(app, 'type: "Final Export"') && has(app, 'tags: ["export", "publish-kit"') && has(app, 'tags: ["export", "nox-cut"'));
check("App exports Render Engine manifest into Asset Vault", has(app, "exportRenderManifestFile") && has(app, 'tags: ["export", "render-engine", "ffmpeg-manifest", "json"]') && has(app, "Render manifest exported"));
check("App queues Render Engine generation jobs", has(app, "queueRenderJob") && has(app, "Render Engine V1 MP4 assembly") && has(app, "summarizeRenderReadiness(manifest)") && has(app, "repository.createGenerationJob(job)"));
check("App uploads Brand Kit watermark to Asset Vault", has(app, "uploadBrandWatermark") && has(app, 'type: "Brand File"') && has(app, 'tags: ["brand-kit", "watermark", "nox-brand"]') && has(app, "persistBrandWatermarkAsset(asset, nextBrandKit"));
check("Brand Kit watermark persists asset before FK update", has(app, "persistBrandWatermarkAsset") && has(app, "const assetResult = await repository.createAsset(asset)") && has(app, "const brandKitResult = await repository.upsertBrandKit(brandKit, workspaceId)"));
check("NOX Cut watermark track uses Brand Kit asset", has(app, "watermarkAsset") && has(app, "assetId: trackType === \"overlay\" ? watermarkAsset?.id : undefined") && has(app, "Use approved Brand Kit watermark asset"));

const vaultHub = read("src/screens/VaultHub.tsx");
const styles = read("src/styles.css");
check("Settings styles provider route readiness", has(styles, ".provider-readiness") && has(styles, ".provider-readiness.status-ready") && has(styles, ".provider-readiness.status-blocked") && has(styles, ".provider-readiness-meta"));
check("Settings styles Grok provider key vault", has(styles, ".grok-key-card") && has(styles, ".grok-key-actions") && has(styles, ".grok-key-error"));
check("Asset Vault searches prompt lineage", has(vaultHub, "asset.promptUsed"));
check("Asset Vault exposes prompt snapshot copy", has(vaultHub, "Copy Prompt Used"));
check("Asset Vault exposes asset delete control", has(vaultHub, "onDeleteAsset") && has(vaultHub, "Delete Asset") && has(vaultHub, "Trash2"));
check("Asset Vault previews Brand File images", has(vaultHub, 'asset.type === "Brand File"'));
check("Vault supports reference images", has(vaultHub, "Reference Image URL"));
check("Vault uploads character reference images into Asset Vault", has(vaultHub, "Upload Reference") && has(vaultHub, "onUploadReference") && has(vaultHub, "accept=\"image/*\"") && has(vaultHub, "Reference Asset"));
check("Vault avoids stale blob reference previews", has(vaultHub, "getPreviewableReferenceUrl") && !has(vaultHub, 'value.startsWith("blob:")') && has(vaultHub, "getCharacterReferenceAsset"));
check("Vault previews generated export assets", has(vaultHub, "Download Export") && has(vaultHub, 'asset.type === "Final Export"') && has(vaultHub, 'asset.type === "Prompt Export"'));
check("World Bible supports locations and timeline", has(vaultHub, "Locations") && has(vaultHub, "Timeline"));
check("Vault supports first-class location editor", has(vaultHub, "Location Record") && has(vaultHub, "Save Location"));
check("Vault supports first-class faction editor", has(vaultHub, "Faction Record") && has(vaultHub, "Save Faction"));
check("Generation Queue exposes job lifecycle controls", has(vaultHub, "onUpdateGenerationJobStatus") && has(vaultHub, "Run") && has(vaultHub, "Complete") && has(vaultHub, "Approve") && has(vaultHub, "Fail"));
check("Generation Queue exposes retry and logs", has(vaultHub, "onRetryGenerationJob") && has(vaultHub, "Retry") && has(vaultHub, "Recent logs") && has(vaultHub, "Attempt"));
check("Generation Queue exposes priority and worker locks", has(vaultHub, "job.priority") && has(vaultHub, "job.runAfter") && has(vaultHub, "job.lockedAt") && has(vaultHub, "job.lockedBy"));
check("Generation Queue exposes actual cost and usage metadata", has(vaultHub, "formatActualJobCost") && has(vaultHub, "job.costActual") && has(vaultHub, "summarizeUsageMetadata") && has(vaultHub, "job.usageMetadata"));
check("Generation Queue exposes operator batch controls", has(vaultHub, "Queue Missing Videos") && has(vaultHub, "Queue Publish Media") && has(vaultHub, "Retry Failed") && has(vaultHub, "Approve Passing"));
check("Generation Queue exposes provider response metadata", has(vaultHub, "job.providerJobId") && has(vaultHub, "job.providerResponse") && has(vaultHub, "Provider Job"));
check("Generation Queue uses a dedicated operator card", has(vaultHub, "function GenerationQueueJob") && has(vaultHub, "queue-metrics") && has(vaultHub, "queue-log-block") && has(vaultHub, "queue-usage"));
check("Generation Queue styles operator metadata", has(styles, ".queue-metrics") && has(styles, ".queue-metric") && has(styles, ".queue-logs") && has(styles, ".queue-usage"));
check("Generation Queue styles production operator controls", has(styles, ".queue-operator-band") && has(styles, ".queue-operator-actions"));
check("Generation Queue styles responsive actions", has(styles, "grid-template-columns: 34px minmax(0, 1fr) minmax(196px, auto)") && has(styles, "max-width: 268px") && has(styles, "grid-column: 1 / -1"));

const studioData = read("src/data/studioData.ts");
check("Provider settings include prompt and local routes", has(studioData, 'id: "manual"') && has(studioData, 'id: "grok"') && has(studioData, 'id: "ollama"'));

const publishScreen = read("src/screens/PublishKitScreen.tsx");
check("Publish Kit screen exposes editable release metadata", has(publishScreen, "Edit Metadata") && has(publishScreen, "Save Metadata") && has(publishScreen, "PublishKitEditor"));
check("Publish Kit editor supports release status and list fields", has(publishScreen, "releaseStatuses") && has(publishScreen, "Release Status") && has(publishScreen, "splitLines(value)") && has(publishScreen, "Chapters"));
check("Publish Kit screen exposes MD, TXT, and JSON exports", has(publishScreen, "Export MD") && has(publishScreen, "Export TXT") && has(publishScreen, "Export JSON"));
check("Publish Kit screen exposes platform bundle exports", has(publishScreen, "TikTok Bundle") && has(publishScreen, "YouTube Bundle") && has(publishScreen, "NOX Films Bundle") && has(publishScreen, "onExportReleaseBundle"));
check("Publish Kit screen queues release operations", has(publishScreen, "Release Operations") && has(publishScreen, "Queue TikTok") && has(publishScreen, "Queue YouTube") && has(publishScreen, "Queue NOX Films") && has(publishScreen, "onQueueReleaseOperation"));
check("Publish Kit screen shows release operation preflight", has(publishScreen, "ReleasePreflightCard") && has(publishScreen, "releaseOperationPlans") && has(publishScreen, "Final MP4") && has(publishScreen, "Scene videos") && has(publishScreen, "Blockers"));
check("Publish Kit preflight uses release operation plan contract", has(publishScreen, "plan.ready") && has(publishScreen, "plan.files.finalVideo") && has(publishScreen, "plan.files.approvedSceneVideos") && has(publishScreen, "plan.thumbnail.prompt") && has(publishScreen, "plan.schedule.status"));
check("Publish Kit styles release operation preflight", has(styles, ".release-preflight-grid") && has(styles, ".release-preflight-card") && has(styles, ".release-preflight-metrics") && has(styles, ".release-preflight-blockers"));
check("Section headers preserve title width with wrapped action toolbars", has(styles, ".section-heading > div:first-child") && has(styles, "flex: 1 1 260px") && has(styles, ".section-action > .toolbar-row") && has(styles, "justify-content: flex-end"));

const noxCutScreen = read("src/screens/NoxCut.tsx");
check("NOX Cut previews approved assembly clips", has(noxCutScreen, "assemblyClips") && has(noxCutScreen, "<video controls") && has(noxCutScreen, "assembly-playlist"));
check("NOX Cut resolves approved source by approved asset id", has(noxCutScreen, "scene.approvedAssetId ? assets.find((asset) => asset.id === scene.approvedAssetId)") && has(noxCutScreen, "sourceAsset?.status === \"Approved\""));
check("NOX Cut exposes Render Engine controls", has(noxCutScreen, "Render Manifest") && has(noxCutScreen, "Queue Render") && has(noxCutScreen, "Queue a render job"));
check("NOX Cut exposes V1 assembly controls", has(noxCutScreen, "Move earlier") && has(noxCutScreen, "Move later") && has(noxCutScreen, "Trim start") && has(noxCutScreen, "Trim end") && has(noxCutScreen, "Export Edit Plan"));
check("NOX Cut exposes utility tracks", has(noxCutScreen, "Title Card") && has(noxCutScreen, "Subtitles") && has(noxCutScreen, "Music") && has(noxCutScreen, "Watermark"));

const renderScript = read("scripts/render-nox-cut.mjs");
check("Render script consumes exported manifest", has(renderScript, "render-nox-cut.mjs <render-manifest.json> <output.mp4>") && has(renderScript, "manifest.readiness"));
check("Render script shells out to FFmpeg", has(renderScript, "NOX_FFMPEG_PATH") && has(renderScript, "ffmpeg-static") && has(renderScript, "libx264") && has(renderScript, "concat"));
check("Render script applies timeline transitions", has(renderScript, "transitionFadeFilters") && has(renderScript, "getTransitionFadeSeconds") && has(renderScript, "fade=t=in") && has(renderScript, "fade=t=out"));
check("Render script applies title and subtitle tracks", has(renderScript, "drawTextFilter") && has(renderScript, "trackType === \"title\"") && has(renderScript, "trackType === \"subtitle\"") && has(renderScript, "drawtext="));
check("Render script applies watermark overlays", has(renderScript, "imageOverlayTracks") && has(renderScript, "overlay=x=W-w-48") && has(renderScript, "isImageSource"));
check("Render script mixes local music beds", has(renderScript, "audioTracks") && has(renderScript, "amix=inputs") && has(renderScript, "afade=t=in") && has(renderScript, "isAudioSource"));
check("Render script resolves utility asset sources", has(renderScript, "assetSourceUrl") && has(renderScript, "assetFilename") && has(renderScript, "assetStoragePath") && has(renderScript, "local://"));

const renderWorker = read("scripts/render-worker.mjs");
check("Render worker command exists", has(read("package.json"), '"render:worker"') && has(renderWorker, "render-worker.mjs <render-manifest.json> <output.mp4>"));
check("Render worker signs into Supabase for private assets", has(renderWorker, "NOX_SUPABASE_RENDER_EMAIL") && has(renderWorker, "signInWithPassword") && has(renderWorker, "VITE_SUPABASE_ANON_KEY"));
check("Render worker downloads Storage assets by bucket", has(renderWorker, 'downloadStorageObject(supabase, "nox-videos"') && has(renderWorker, "bucketForUtilityTrack") && has(renderWorker, "nox-audio") && has(renderWorker, "nox-brand"));
check("Render worker rewrites manifest with local paths", has(renderWorker, "resolved-render-manifest.json") && has(renderWorker, "clip.localPath") && has(renderWorker, "track.localPath"));
check("Render worker calls FFmpeg assembler", has(renderWorker, "render-nox-cut.mjs") && has(renderWorker, "process.execPath"));
check("Render worker can upload final MP4", has(renderWorker, "NOX_RENDER_UPLOAD") && has(renderWorker, 'storage.from("nox-exports").upload') && has(renderWorker, "video/mp4"));

const generationWorker = read("scripts/generation-worker.mjs");
const workerHealthcheck = read("scripts/worker-healthcheck.mjs");
const workerDockerfile = read("Dockerfile.worker");
const workerCompose = read("docker-compose.worker.yml");
const dockerignore = read(".dockerignore");
const envExample = read(".env.example");
const packageJson = read("package.json");
check("Generation queue worker command exists", has(packageJson, '"jobs:worker"') && has(generationWorker, "NOX generation worker"));
check("Generation queue worker loads production env", has(generationWorker, 'loadDotEnvFiles([".env.local", ".env"])') && has(generationWorker, "NOX_SUPABASE_WORKER_EMAIL") && has(generationWorker, "NOX_GENERATION_WORKER_WORKSPACE_IDS"));
check("Generation queue worker signs into Supabase", has(generationWorker, "signInWithPassword") && has(generationWorker, "VITE_SUPABASE_ANON_KEY"));
check("Generation queue worker discovers accessible workspaces", has(generationWorker, 'from("workspaces").select("id")') && has(generationWorker, "discoverWorkspaceIds"));
check("Generation queue worker invokes process-next", has(generationWorker, 'action: "process-next"') && has(generationWorker, '"process-generation-job"') && has(generationWorker, "workerId"));
check("Generation queue worker can run render jobs", has(generationWorker, "NOX_GENERATION_WORKER_RENDER") && has(generationWorker, "scripts/render-worker.mjs") && has(generationWorker, "--render"));
check("Generation queue worker supports cost ceilings and alerts", has(generationWorker, "NOX_GENERATION_WORKER_MAX_DAILY_COST_USD") && has(generationWorker, "NOX_GENERATION_WORKER_ALERT_WEBHOOK_URL") && has(generationWorker, "notifyWorkerAlert"));
check("Generation queue worker completes rendered jobs", has(generationWorker, "completeRenderedJob") && has(generationWorker, 'status: "Completed"') && has(generationWorker, "generation-worker-render"));
check("Generation queue worker archives final exports", has(generationWorker, "archiveRenderedAsset") && has(generationWorker, 'type: "Final Export"') && has(generationWorker, "nox-exports") && has(generationWorker, "storagePath"));
check("Generation queue worker healthcheck command exists", has(packageJson, '"jobs:healthcheck"') && has(workerHealthcheck, "NOX worker healthcheck"));
check("Generation queue worker healthcheck signs in safely", has(workerHealthcheck, "signInWithPassword") && has(workerHealthcheck, "auth.getUser") && has(workerHealthcheck, "persistSession: false"));
check("Generation queue worker healthcheck verifies function health only", has(workerHealthcheck, 'action: "health"') && has(workerHealthcheck, '"process-generation-job"') && !has(workerHealthcheck, 'action: "process-next"'));
check("Generation queue worker healthcheck verifies workspace allowlist", has(workerHealthcheck, "NOX_GENERATION_WORKER_WORKSPACE_IDS") && has(workerHealthcheck, "Worker account cannot read configured workspace") && has(workerHealthcheck, ".in(\"id\", config.workspaceIds)"));
check("FFmpeg static is a production worker dependency", has(packageJson, '"dependencies"') && has(packageJson, '"ffmpeg-static"') && !/"devDependencies"[\s\S]*"ffmpeg-static"/.test(packageJson));
check("Worker Dockerfile installs production runtime", has(workerDockerfile, "FROM node:22-bookworm-slim") && has(workerDockerfile, "npm ci --omit=dev") && has(workerDockerfile, "NODE_ENV=production"));
check("Worker Dockerfile runs as non-root service", has(workerDockerfile, "USER node") && has(workerDockerfile, "HEALTHCHECK") && has(workerDockerfile, "worker-healthcheck.mjs") && has(workerDockerfile, 'CMD ["npm", "run", "jobs:worker", "--", "--render", "--upload"]'));
check("Worker Dockerfile preserves render scratch directory", has(workerDockerfile, "NOX_GENERATION_WORKER_RENDER_DIR=/app/dist/generation-worker-renders") && has(workerDockerfile, "mkdir -p /app/dist/generation-worker-renders"));
check("Worker compose uses env file and restart policy", has(workerCompose, "Dockerfile.worker") && has(workerCompose, "env_file:") && has(workerCompose, ".env.local") && has(workerCompose, "restart: unless-stopped"));
check("Worker compose enables render upload runtime", has(workerCompose, 'NOX_GENERATION_WORKER_RENDER: "1"') && has(workerCompose, 'NOX_RENDER_UPLOAD: "1"') && has(workerCompose, "--render") && has(workerCompose, "--upload"));
check("Worker compose wires healthcheck and render volume", has(workerCompose, "worker-healthcheck.mjs") && has(workerCompose, "nox-worker-renders") && has(workerCompose, "/app/dist/generation-worker-renders"));
check("Docker ignore keeps secrets and build noise out", has(dockerignore, "node_modules") && has(dockerignore, "dist") && has(dockerignore, ".env.*") && has(dockerignore, "!.env.example"));
check("Env example includes worker service controls", has(envExample, "NOX_GENERATION_WORKER_ID") && has(envExample, "NOX_GENERATION_WORKER_MAX_CYCLES") && has(envExample, "NOX_SUPABASE_WORKER_EMAIL") && has(envExample, "NOX_RENDER_UPLOAD"));

const renderSmoke = read("scripts/verify-render-smoke.mjs");
check("Render smoke script creates six Scene Card sources", has(renderSmoke, "createSceneCardClips") && has(renderSmoke, "colors.entries()") && has(renderSmoke, "durationSeconds: 10"));
check("Render smoke script exercises finishing tracks", has(renderSmoke, "Title Card") && has(renderSmoke, "Smoke Test Subtitles") && has(renderSmoke, "Low Cinematic Pulse") && has(renderSmoke, "NOX Watermark"));
check("Render smoke script verifies actual MP4 duration", has(renderSmoke, "inspectDuration") && has(renderSmoke, "duration < 59") && has(renderSmoke, "runtimeSeconds: 60"));
check("Render smoke script is in npm verification", has(read("package.json"), '"verify:render"') && has(read("package.json"), "npm run verify:render"));

const functionFiles = [
  "supabase/functions/generate-concept/index.ts",
  "supabase/functions/generate-scene-prompt/index.ts",
  "supabase/functions/process-generation-job/index.ts",
  "supabase/functions/manage-provider-secret/index.ts",
  "supabase/functions/_shared/nox-core.ts",
  "supabase/functions/_shared/grok.ts",
];

for (const path of functionFiles) {
  check(`function file exists: ${path}`, existsSync(join(root, path)));
}

const sharedNoxCore = read("supabase/functions/_shared/nox-core.ts");
check("Edge NOX Core accepts project language input", has(sharedNoxCore, "language?:") && has(sharedNoxCore, "const language = input.language ??"));
check("Edge NOX Core includes approved asset id field", has(sharedNoxCore, "approvedAssetId?: string"));
check(
  "Edge NOX Core emits UUID-compatible record ids",
  has(sharedNoxCore, "function makeId(_prefix: string)") &&
    has(sharedNoxCore, "return crypto.randomUUID();") &&
    !has(sharedNoxCore, "${prefix}-${crypto.randomUUID()}"),
);
await verifyEdgeNoxCorePackageIds();
await verifyEdgeFunctionBundles([
  "supabase/functions/generate-concept/index.ts",
  "supabase/functions/generate-scene-prompt/index.ts",
  "supabase/functions/process-generation-job/index.ts",
  "supabase/functions/manage-provider-secret/index.ts",
]);

const grokShared = read("supabase/functions/_shared/grok.ts");
check("Grok Edge helper uses xAI chat completions", has(grokShared, "https://api.x.ai/v1") && has(grokShared, "/chat/completions"));
check("Grok Edge helper uses configurable models", has(grokShared, "NOX_GROK_TEXT_MODEL") && has(grokShared, "grok-4.3") && has(grokShared, "NOX_GROK_IMAGE_MODEL") && has(grokShared, "NOX_GROK_VIDEO_MODEL"));
check("Grok Edge helper uses Structured Outputs", has(grokShared, 'type: "json_schema"') && has(grokShared, "strict: true") && has(grokShared, "response_format"));
check("Grok Edge helper supports workspace secrets", has(grokShared, "getWorkspaceGrokSecret") && has(grokShared, "workspace_provider_secrets") && has(grokShared, "decryptSecret"));
check("Grok Edge helper supports strict production mode", has(grokShared, "NOX_GROK_STRICT") && has(grokShared, "nox-core-fallback"));

const conceptFunction = read("supabase/functions/generate-concept/index.ts");
check("generate-concept handles POST", has(conceptFunction, 'request.method !== "POST"'));
check("generate-concept handles CORS preflight", has(conceptFunction, 'request.method === "OPTIONS"'));
check("generate-concept handles health action", has(conceptFunction, 'input?.action === "health"') && has(conceptFunction, '"generate-concept"'));
check("generate-concept reports Grok health", has(conceptFunction, "grokConfigured") && has(conceptFunction, "grokTextModel") && has(conceptFunction, "grokStrict"));
check("generate-concept uses Grok structured draft path", has(conceptFunction, "requestStructuredOutput") && has(conceptFunction, "conceptDraftSchema") && has(conceptFunction, "applyGrokConceptDraft"));
check("generate-concept preserves Scene Card video invariant", has(conceptFunction, "one Scene Card equals one generated 10-second video") && has(conceptFunction, "One generated video"));
check("generate-concept returns productionPackage", has(conceptFunction, "productionPackage"));

const promptFunction = read("supabase/functions/generate-scene-prompt/index.ts");
check("generate-scene-prompt handles POST", has(promptFunction, 'request.method !== "POST"'));
check("generate-scene-prompt handles CORS preflight", has(promptFunction, 'request.method === "OPTIONS"'));
check("generate-scene-prompt handles health action", has(promptFunction, 'input?.action === "health"') && has(promptFunction, '"generate-scene-prompt"'));
check("generate-scene-prompt reports Grok health", has(promptFunction, "grokConfigured") && has(promptFunction, "grokTextModel") && has(promptFunction, "grokStrict"));
check("generate-scene-prompt uses Grok structured prompt path", has(promptFunction, "requestStructuredOutput") && has(promptFunction, "scenePromptDraftSchema") && has(promptFunction, "applyGrokScenePromptDraft"));
check("generate-scene-prompt enforces prompt section contract", has(promptFunction, "requiredPromptSections") && has(promptFunction, "[NEGATIVE PROMPT]") && has(promptFunction, "normalizeFullPrompt"));
check("generate-scene-prompt preserves language markers through provider path", has(promptFunction, "getLanguageMarkers") && has(promptFunction, "Prompt language:") && has(promptFunction, "Subtitle language:") && has(promptFunction, "hasLanguageMarkers"));
check("generate-scene-prompt supports polish", has(promptFunction, 'input.action === "polish"'));
check("generate-scene-prompt returns scene", has(promptFunction, "return Response.json") && has(promptFunction, "scene,"));

const processFunction = read("supabase/functions/process-generation-job/index.ts");
check("process-generation-job handles POST", has(processFunction, 'request.method !== "POST"'));
check("process-generation-job handles CORS preflight", has(processFunction, 'request.method === "OPTIONS"'));
check("process-generation-job handles health action", has(processFunction, 'input?.action === "health"') && has(processFunction, '"process-generation-job"'));
check("process-generation-job requires caller authorization", has(processFunction, 'request.headers.get("authorization")') && has(processFunction, "Authorization header is required"));
check("process-generation-job uses Supabase REST with RLS", has(processFunction, "/rest/v1/") && has(processFunction, "apikey: rest.anonKey") && has(processFunction, "authorization: rest.authorization"));
check("process-generation-job reads and updates generation jobs", has(processFunction, '"generation_jobs"') && has(processFunction, "retry_count") && has(processFunction, "logs") && has(processFunction, "updateJob"));
check("process-generation-job persists actual cost usage metadata", has(processFunction, "cost_actual") && has(processFunction, "cost_currency") && has(processFunction, "usage_metadata") && has(processFunction, "formatJobCost"));
check("process-generation-job can claim next due queue job", has(processFunction, 'input?.action === "process-next"') && has(processFunction, "claim_next_generation_job") && has(processFunction, "workspaceId is required for process-next") && has(processFunction, "No queued generation jobs are due"));
check("process-generation-job releases locks and schedules retries", has(processFunction, "locked_at: null") && has(processFunction, "locked_by: null") && has(processFunction, "nextRunAfter") && has(processFunction, "30 * 2 ** retryCount"));
check("process-generation-job supports provider webhooks", has(processFunction, "invokeProviderWebhook") && has(processFunction, "api_endpoint") && has(processFunction, "secret_name") && has(processFunction, "provider-webhook") && has(processFunction, "X-NOX-Provider"));
check("process-generation-job sends provider callback instructions", has(processFunction, "jobId: job.id") && has(processFunction, "NOX_PROVIDER_CALLBACK_URL") && has(processFunction, "provider-callback") && has(processFunction, "x-nox-callback-token"));
check("process-generation-job receives provider callbacks", has(processFunction, "processProviderCallback") && has(processFunction, "NOX_PROVIDER_CALLBACK_TOKEN") && has(processFunction, "getServiceRestConfig") && has(processFunction, "SUPABASE_SERVICE_ROLE_KEY"));
check("process-generation-job callback creates generated video assets", has(processFunction, "createProviderCallbackAsset") && has(processFunction, 'type: "Video"') && has(processFunction, "provider-callback") && has(processFunction, "patchProviderCallbackScene"));
check("process-generation-job marks provider connection status", has(processFunction, "updateProviderConnectionStatus") && has(processFunction, "Secret missing") && has(processFunction, "connection_status"));
check("process-generation-job supports prompt jobs", has(processFunction, "processScenePromptJob") && has(processFunction, "regenerateScenePrompt") && has(processFunction, "polishScenePrompt") && has(processFunction, '"scenes"'));
check("process-generation-job supports continuity review jobs", has(processFunction, "processContinuityReviewJob") && has(processFunction, "runContinuityReview") && has(processFunction, "continuity-review") && has(processFunction, '"characters"') && has(processFunction, '"worlds"'));
check("process-generation-job supports Grok image jobs", has(processFunction, "processGrokImageJob") && has(processFunction, "requestGrokImage") && has(processFunction, "grok-image") && has(processFunction, "createGrokImageAsset"));
check("process-generation-job supports video handoff jobs", has(processFunction, "processVideoProviderJob") && has(processFunction, "handoff package prepared"));
check("process-generation-job supports render handoff jobs", has(processFunction, "processRenderJob") && has(processFunction, "NOX Render Engine V1"));
check("process-generation-job supports release operation jobs", has(processFunction, "processReleaseOperationJob") && has(processFunction, "release-operation") && has(processFunction, '"publish_kits"') && has(processFunction, "release_status") && has(processFunction, "uploadId"));

const docs = read("README.md") + "\n" + read("docs/implementation-phases.md") + "\n" + read("docs/worker-deployment.md") + "\n" + read("docs/production-runbook.md");
check("README documents migration deployment", has(docs, "push every migration in `supabase/migrations/`") && has(docs, "supabase db push"));
check("Package exposes Supabase launch commands", has(read("package.json"), '"supabase:preflight"') && has(read("package.json"), '"supabase:deploy"'));
check("Docs document Supabase launch automation", has(docs, "npm run supabase:preflight") && has(docs, "npm run supabase:deploy") && has(docs, "SUPABASE_PROJECT_REF") && has(docs, ".env.local"));
check("README documents generate-concept deploy", has(docs, "supabase functions deploy generate-concept"));
check("README documents generate-scene-prompt deploy", has(docs, "supabase functions deploy generate-scene-prompt"));
check("README documents process-generation-job deploy", has(docs, "supabase functions deploy process-generation-job"));
check("README documents Grok Edge secrets", has(docs, "supabase secrets set XAI_API_KEY") && has(docs, "NOX_GROK_TEXT_MODEL") && has(docs, "NOX_GROK_VIDEO_MODEL") && has(docs, "NOX_SECRET_ENCRYPTION_KEY") && has(docs, "NOX_GROK_STRICT"));
check("README documents Grok live audit requirement", has(docs, "NOX_LIVE_AUDIT_REQUIRE_GROK") && has(docs, "Grok-backed generation"));
check("README documents live Supabase audit", has(docs, "npm run verify:supabase-live") && has(docs, "NOX_SUPABASE_TEST_EMAIL"));
check("README documents second-user isolation audit", has(docs, "NOX_SUPABASE_OTHER_EMAIL") && has(docs, "NOX_SUPABASE_STRICT_ISOLATION"));
check("Docs document production readiness diagnostics", has(docs, "Production Readiness") && has(docs, "Run Check") && has(docs, "Storage"));
check("Docs document release bundle exports", has(docs, "release bundle") && has(docs, "TikTok") && has(docs, "YouTube") && has(docs, "NOX Films"));
check("Docs document release operation jobs", has(docs, "release operation") && has(docs, "durable generation job") && has(docs, "readiness blockers") && has(docs, "Project and Publish Kit release status"));
check("Docs document actual job cost tracking", has(docs, "actual cost") && has(docs, "provider usage metadata") && has(docs, "cost estimates"));
check("Docs document Grok secret vault integration", has(docs, "Grok API Key card") && has(docs, "manage-provider-secret") && has(docs, "workspace_provider_secrets") && has(docs, "encrypted workspace Grok key"));
check("Docs document Grok readiness", has(docs, "Grok key-vault readiness") && has(docs, "Grok is the only production AI provider route") && has(docs, "Manual Mode"));
check("Docs document provider callback ingestion", has(docs, 'action: "provider-callback"') && has(docs, "NOX_PROVIDER_CALLBACK_TOKEN") && has(docs, "x-nox-callback-token") && has(docs, "Scene Card video asset"));
check("Docs document production queue worker", has(docs, "npm run jobs:worker") && has(docs, "--render --upload") && has(docs, "NOX_SUPABASE_WORKER_EMAIL") && has(docs, "Final Export"));
check("Docs document worker container deployment", has(docs, "docker compose -f docker-compose.worker.yml up -d --build") && has(docs, "Dockerfile.worker") && has(docs, "restart: unless-stopped") && has(docs, "nox-worker-renders"));
check("Docs document worker healthcheck", has(docs, "npm run jobs:healthcheck") && has(docs, "process-generation-job") && has(docs, "will not claim or mutate jobs"));
check("Docs document production runbook operations", has(docs, "docs/production-runbook.md") && has(docs, "Key Rotation") && has(docs, "NOX_GENERATION_WORKER_MAX_DAILY_COST_USD") && has(docs, "failure recovery"));

// Electron desktop standalone checks
const electronFiles = [
  "electron/main.mjs",
  "electron/preload.mjs",
  "electron/local-backend.mjs",
  "electron/xai-client.mjs",
  "electron/media-store.mjs",
  "electron/render-service.mjs",
  "electron/publish-service.mjs",
  "electron/secrets-store.mjs",
];
for (const file of electronFiles) {
  check(`Electron file exists: ${file}`, existsSync(join(root, file)));
}

const mainProcess = read("electron/main.mjs");
check("Electron main disables node integration", has(mainProcess, "nodeIntegration: false"));
check("Electron main enables context isolation", has(mainProcess, "contextIsolation: true"));
check("Electron main registers nox-media protocol", has(mainProcess, 'protocol.handle("nox-media"'));
check("Electron main loads dev Vite URL", has(mainProcess, '"http://127.0.0.1:5173"'));
check("Electron main loads production dist", has(mainProcess, '"dist", "index.html"'));

const preload = read("electron/preload.mjs");
check("Electron preload exposes window.noxDesktop", has(preload, 'exposeInMainWorld("noxDesktop"'));
check("Electron preload includes secrets API", has(preload, "secrets:") && has(preload, "grokStatus"));
check("Electron preload includes files API", has(preload, "files:") && has(preload, "importUserFile"));

const secretsStore = read("electron/secrets-store.mjs");
check("Electron secrets use safeStorage", has(secretsStore, "safeStorage.encryptString") && has(secretsStore, "safeStorage.decryptString"));

const xaiClient = read("electron/xai-client.mjs");
check("xAI client defines default models", has(xaiClient, "grok-4.3") && has(xaiClient, "grok-imagine-image-quality") && has(xaiClient, "grok-imagine-video"));
check("xAI client redacts auth headers", has(xaiClient, "Bearer [REDACTED]"));

const desktopBridge = read("src/lib/desktopBridge.ts");
check("Desktop bridge has isDesktop guard", has(desktopBridge, "export function isDesktop"));
check("Desktop bridge exposes file import API", has(desktopBridge, "importUserFile") && has(desktopBridge, "revealInFolder"));

const providerSecrets = read("src/lib/providerSecrets.ts");
check("Provider secrets prefer desktop in desktop mode", has(providerSecrets, "isDesktop()") && has(providerSecrets, "desktopSecrets"));
check("Provider secrets never persist raw key to localStorage", !has(providerSecrets, /localStorage\.setItem\([^)]*apiKey/) && !has(providerSecrets, /localStorage\.setItem\([^)]*grokKey/));

const storageAdapter = read("src/lib/storage.ts");
check("Storage adapter prefers desktop import in desktop mode", has(storageAdapter, "isDesktop()") && has(storageAdapter, "desktopFiles.importUserFile"));

const generationRunner = read("src/lib/generationJobRunner.ts");
check("Generation runner uses desktop Grok for images", has(generationRunner, "desktopGrok.generateImage"));
check("Generation runner uses desktop Grok for videos", has(generationRunner, "desktopGrok.generateVideo"));
check("Generation runner uses desktop render service", has(generationRunner, "desktopRender.runRender"));
check("Generation runner uses desktop publish service", has(generationRunner, "desktopPublish.createReleasePackage"));

if (failures.length) {
  console.error("NOX production readiness verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(`\nPassed ${passes.length} checks before failing.`);
  process.exit(1);
}

console.log(`NOX production readiness verification passed (${passes.length} checks).`);

async function verifyEdgeNoxCorePackageIds() {
  const tempDir = await mkdtemp(join(tmpdir(), "nox-edge-core-"));
  const outfile = join(tempDir, "edge-core.mjs");
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  try {
    await build({
      entryPoints: [join(root, "supabase/functions/_shared/nox-core.ts")],
      bundle: true,
      format: "esm",
      platform: "browser",
      outfile,
      sourcemap: false,
      logLevel: "silent",
    });

    const edgeCore = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
    const productionPackage = edgeCore.createProductionPackage({
      title: "Edge UUID Verifier",
      idea: "A director tests the live Supabase generation path.",
      type: "Shortfilm",
      format: "TikTok / Reels / Shorts - 9:16",
      length: "60 seconds = 6 scene cards",
      genre: "Sci-fi",
      tone: "Dark",
      target: "Grok",
      workspaceId,
      brandKit: {
        studioName: "NOX Films",
        defaultExport: "9:16 TikTok + 16:9 YouTube",
        hashtags: ["#NOXFilms"],
      },
    });

    const ids = [
      productionPackage.project.id,
      ...productionPackage.characters.map((item) => item.id),
      ...productionPackage.worlds.map((item) => item.id),
      ...productionPackage.locations.map((item) => item.id),
      ...productionPackage.factions.map((item) => item.id),
      ...productionPackage.scenes.flatMap((scene) => [scene.id, ...scene.beats.map((beat) => beat.id)]),
      productionPackage.publishKit.id,
      ...productionPackage.timelineItems.map((item) => item.id),
      ...productionPackage.generationJobs.map((item) => item.id),
    ];
    const workspaceIds = [
      productionPackage.project.workspaceId,
      ...productionPackage.characters.map((item) => item.workspaceId),
      ...productionPackage.worlds.map((item) => item.workspaceId),
      ...productionPackage.locations.map((item) => item.workspaceId),
      ...productionPackage.factions.map((item) => item.workspaceId),
      ...productionPackage.generationJobs.map((item) => item.workspaceId),
    ];

    check("Edge NOX Core dynamic package ids are UUIDs", ids.length > 30 && ids.every((id) => uuidPattern.test(id)));
    check("Edge NOX Core preserves workspace ownership ids", workspaceIds.every((id) => id === workspaceId));
  } catch {
    check("Edge NOX Core dynamic package id verifier runs", false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function verifyEdgeFunctionBundles(functionPaths) {
  const tempDir = await mkdtemp(join(tmpdir(), "nox-edge-functions-"));

  try {
    for (const functionPath of functionPaths) {
      await build({
        entryPoints: [join(root, functionPath)],
        bundle: true,
        format: "esm",
        platform: "browser",
        outfile: join(tempDir, `${functionPath.replace(/[^a-z0-9]+/gi, "-")}.mjs`),
        sourcemap: false,
        logLevel: "silent",
      });
      check(`Edge Function bundles: ${functionPath}`, true);
    }
  } catch (error) {
    check(`Edge Function bundles: ${error instanceof Error ? error.message : String(error)}`, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
