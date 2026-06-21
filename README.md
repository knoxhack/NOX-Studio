# NOX Studio

NOX Studio is a cyberglass AI film production OS focused on the Scene Card Cinema Pipeline:

```text
1 Scene Card = 1 generated 10-second video
```

This V1 app includes the production shell, Command Center, Create Wizard, editable Project Library, editable Scene Composer with continuity checks, Asset/Character/World Vaults with prompt/provider lineage, NOX Cut assembly controls, Render Engine manifest handoff, Publish Kit, Analytics, Settings, local persistence, and a Supabase-ready repository layer.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Verify

```bash
npm run verify:production
npm run verify:workflow
npm run verify:render
npm run build
```

The production verifier checks the Supabase tables, RLS policies, private storage buckets, auth paths, storage adapter, generation gateway, Asset Vault prompt lineage, and Edge Function entrypoints required by the V1 roadmap. The workflow verifier dynamically exercises NOX Core package generation, provider prompt regeneration/polish, Asset Vault prompt snapshots, publish exports, and NOX Cut edit-plan readiness. The render verifier creates six synthetic 10-second Scene Card videos, applies title/subtitle/music/watermark finishing tracks, and proves the FFmpeg renderer can write an actual 60-second MP4.

## Render Engine V1

NOX Cut can export a Render Engine manifest and queue a render job from approved Scene Card videos. The manifest preserves timeline order, approved asset IDs, trim notes, transition labels, title/subtitle/audio/watermark utility tracks, utility asset source pointers, and FFmpeg target settings.

On a renderer machine with FFmpeg installed, run:

```bash
npm run render:nox-cut -- path/to/render-manifest.json path/to/output.mp4
```

For production manifests that point at private Supabase Storage paths, use the render worker instead:

```bash
npm run render:worker -- path/to/render-manifest.json path/to/output.mp4
```

Set `NOX_SUPABASE_RENDER_EMAIL` and `NOX_SUPABASE_RENDER_PASSWORD` to a confirmed workspace member account, or reuse the live audit test credentials, so the worker can download private `nox-videos`, `nox-audio`, `nox-images`, and `nox-brand` assets through RLS. Set `NOX_RENDER_UPLOAD=1` or pass `--upload` when the finished MP4 should be uploaded to `nox-exports`.

If FFmpeg is not on `PATH`, set `NOX_FFMPEG_PATH` to the FFmpeg executable first. Source video URLs from Supabase Storage are resolved by the worker before the renderer assembles the MP4.

The V1 runner now performs a two-stage MP4 assembly: it normalizes each approved Scene Card video to the project frame, applies transition fades, concatenates the six-scene timeline, then applies title-card text, subtitle text, text or image watermark overlays, and local music beds when the corresponding NOX Cut utility assets resolve to files. Set `NOX_RENDER_FONT` to a local font file if the renderer machine needs a specific typeface for FFmpeg `drawtext`.

Run `npm run verify:render` to create a repeatable smoke MP4 at `dist/render-smoke/nox-render-smoke.mp4`. The script uses the bundled `ffmpeg-static` binary when a system FFmpeg is not installed.

## Generation Queue

Long-running prompt, render, export, provider upload, and review actions are tracked as generation jobs. Jobs persist status, retry count, retry limits, lifecycle logs, start/completion timestamps, errors, cost estimates, actual cost, currency, and provider usage metadata through the local store or Supabase `generation_jobs` table.

The queue Run action now routes work through a job runner: scene prompt jobs execute through the Supabase Grok gateway or local NOX Core fallback, continuity review jobs compare Scene Cards against Character Vault and World Bible records, video jobs call the Grok video route when configured or prepare a manual upload handoff, and render jobs preflight the Render Engine manifest before handing off to an FFmpeg worker.

In Supabase deployments, `process-generation-job` also supports `action: "process-next"` for worker processes. The `claim_next_generation_job` SQL function claims the next due job per workspace with priority, retry limits, `run_after`, and lock metadata, then the Edge Function releases the lock when the job completes or schedules the next retry after failure.

Run the production queue worker from a trusted machine or container with a confirmed workspace member account:

```bash
npm run jobs:worker
```

Set `NOX_SUPABASE_WORKER_EMAIL` and `NOX_SUPABASE_WORKER_PASSWORD`, or let the worker reuse the live-audit test credentials in development. By default it discovers every workspace the worker account can access and repeatedly invokes `process-generation-job` with `action: "process-next"`. Set `NOX_GENERATION_WORKER_WORKSPACE_IDS` to a comma-separated workspace allowlist, `NOX_GENERATION_WORKER_INTERVAL_MS` for poll cadence, or `NOX_GENERATION_WORKER_MAX_IDLE_CYCLES` when the worker should stop after an idle drain.

For a production service container, set the worker env vars in `.env.local` and run:

```bash
docker compose -f docker-compose.worker.yml up -d --build
```

The worker image uses `Dockerfile.worker`, runs as the non-root `node` user, keeps render scratch output on the `nox-worker-renders` volume, restarts with `unless-stopped`, and uses `npm run jobs:healthcheck` as its Docker health check. That healthcheck signs in with the worker account, checks the deployed `process-generation-job` health action, and verifies the configured workspace allowlist through RLS without claiming jobs. See `docs/worker-deployment.md` for the deployment runbook and `docs/production-runbook.md` for deploy, key rotation, worker restart, cost ceiling, cleanup, and failure recovery steps.

For render-capable workers, run:

```bash
npm run jobs:worker -- --render --upload
```

With `--render`, a ready Render Engine V1 job is handed to `scripts/render-worker.mjs`. With `--upload` or `NOX_RENDER_UPLOAD=1`, the finished MP4 is uploaded to `nox-exports`, archived as a `Final Export` Asset Vault row, and the generation job is marked `Completed`.

Use the Grok API Key card in Settings to verify, save, or remove the workspace key. The raw key is sent only to the `manage-provider-secret` Edge Function, encrypted with `NOX_SECRET_ENCRYPTION_KEY`, and never stored in browser state, `localStorage`, RLS-visible tables, or provider settings. Settings shows only status, verified model, timestamp, and the key last four characters. Local demo mode can hold a temporary in-memory key for testing, but production save requires Supabase.

Provider callbacks are handled by `process-generation-job` with `action: "provider-callback"`. Set server-side `NOX_PROVIDER_CALLBACK_TOKEN` and, for external providers, `NOX_PROVIDER_CALLBACK_URL`; providers must send the token in `x-nox-callback-token` or as a bearer token. A successful callback can include `jobId`, `status`, `externalJobId`, and an `asset` object with `url` or `storagePath`, `filename`, `mimeType`, and `durationSeconds`. NOX then updates the durable generation job, creates a Scene Card video asset in the Asset Vault, moves the Scene Card to `Video Uploaded` or `Approved` when `autoApprove` is true, and preserves provider response metadata for audit.

## Publishing Release Bundles

Publish Kit exports include TikTok, YouTube, and NOX Films release bundles. Each bundle includes the platform preset, release status and schedule handoff, metadata, hashtags/tags/chapters, thumbnail or poster prompt, approved Scene Card video manifest, final export references, and a posting checklist. The Publish Kit screen shows a release operation preflight for each platform using the same readiness plan that will be queued as a durable job, including final MP4 status, approved Scene Card video count, checklist progress, schedule state, and blockers. Bundle exports are archived back into the Asset Vault through the same `nox-exports` storage path as other production packages.

Publish Kit can also queue platform release operations. A release operation stores the release bundle, readiness blockers, schedule/status, files, metadata, thumbnail prompt, and checklist as a durable generation job, so final posting work can be tracked alongside render, provider, and export jobs. When a release operation is processed by the in-app runner or Supabase queue worker, it validates final MP4 readiness, metadata, schedule handoff, and checklist blockers, then moves the Project and Publish Kit release status to `Scheduled` when ready or `NOX Films Draft` when review is still needed.

## Supabase

Copy `.env.example` to `.env.local`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then run the launch preflight:

```bash
npm run supabase:preflight
```

When the Supabase CLI is installed and authenticated, `npm run supabase:deploy` will push every migration in `supabase/migrations/`, deploy `generate-concept`, `generate-scene-prompt`, `process-generation-job`, and `manage-provider-secret`, set any available Grok and secret-vault server values from `.env.local`, and run the live Supabase audit. Set `SUPABASE_PROJECT_REF` or `NOX_SUPABASE_PROJECT_REF` when the CLI project is not already linked, or set `SUPABASE_DB_URL` when you want `supabase db push` to target a database URL directly.

The login screen supports Supabase email/password sign-in, creator account creation, password reset email delivery, and Google OAuth. In local demo mode, email/password entry creates a local session without touching Supabase.

Deploy the generation functions when you want Phase 4/5 to run through Supabase instead of the local fallback:

```bash
supabase functions deploy generate-concept
supabase functions deploy generate-scene-prompt
supabase functions deploy process-generation-job
supabase functions deploy manage-provider-secret
```

To make those functions use Grok for the story package and provider prompt pass, set server-side Supabase secrets before or after deploy:

```bash
supabase secrets set XAI_API_KEY=xai-...
supabase secrets set NOX_GROK_TEXT_MODEL=grok-4.3
supabase secrets set NOX_GROK_IMAGE_MODEL=grok-imagine-image-quality
supabase secrets set NOX_GROK_VIDEO_MODEL=grok-imagine-video
supabase secrets set NOX_GROK_STRICT=1
supabase secrets set NOX_SECRET_ENCRYPTION_KEY=[base64-32-byte-key]
```

The creative Edge Functions call xAI's Grok chat completions with Structured Outputs, then map the draft back into NOX Studio's stable Scene Card schema. If `XAI_API_KEY`, `NOX_GROK_API_KEY`, or a verified saved Grok workspace key is not configured, they fall back to deterministic NOX Core output unless `NOX_GROK_STRICT=1` is set. The `process-generation-job` function is the authenticated queue processor: it uses the caller's Supabase session, respects RLS, updates generation job lifecycle logs, and persists prompt/video/render handoff results.

The app calls those functions through `src/lib/generationGateway.ts` when Supabase is configured. If they are not deployed, NOX Studio falls back to the local deterministic NOX Core generator and local job runner, keeping the workflow usable.

Grok is the only production AI provider route. Readiness first checks the encrypted workspace Grok key, then falls back to server env `XAI_API_KEY` or `NOX_GROK_API_KEY`. Manual Mode and Local Ollama remain non-production fallback options.

Without Supabase env vars, NOX Studio runs in local demo mode with `localStorage` persistence.

After setting env vars and deploying the functions, open Settings > Production Readiness and press Run Check. The in-app diagnostic verifies the current browser session against Supabase Auth, the RLS-backed production tables, private Storage bucket upload/signed-preview/cleanup checks, Grok key-vault readiness, the `generate-concept` / `generate-scene-prompt` Grok runtime health actions, and the authenticated `process-generation-job` runtime health action. It also reports whether the creative functions can reach Grok or are using deterministic NOX Core fallback.

For headless live proof, set `NOX_SUPABASE_TEST_EMAIL` and `NOX_SUPABASE_TEST_PASSWORD` for a real confirmed test user, then run:

```bash
npm run verify:supabase-live
```

That audit signs in with Supabase Auth, creates a temporary workspace through RLS, calls the Edge Functions, processes a named queued Scene Card prompt job through `process-generation-job`, claims and completes the next due queued job through the worker path, uploads to every private Storage bucket, writes a generated six-scene production package, links an approved Scene Card asset into NOX Cut, verifies readback, signs in again with a fresh client to prove the saved workspace/project/scenes/assets/publish/timeline data survive a production reload, and fails if cleanup cannot remove the temporary Storage objects and workspace. Set `NOX_LIVE_AUDIT_KEEP_DATA=1` to preserve the audit data for inspection.

Set `NOX_LIVE_AUDIT_REQUIRE_GROK=1` when the live audit must fail unless the deployed Edge Functions report a configured Grok runtime or saved workspace Grok key. This is useful for CI once generation should be proven through Grok-backed generation instead of deterministic fallback.

For stricter RLS proof, also set `NOX_SUPABASE_OTHER_EMAIL` and `NOX_SUPABASE_OTHER_PASSWORD` for a second confirmed test user. The audit then verifies that the second user cannot read/delete the audit workspace or create/read private Storage objects under its workspace prefix. Set `NOX_SUPABASE_STRICT_ISOLATION=1` in CI when this second-user denial check must be mandatory.
