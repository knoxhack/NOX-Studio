# NOX Studio V1 Implementation Phases

This repository now implements the 10-phase V1 as a local-first app with a Supabase-ready database and repository foundation.

## What Runs Today

- Cyberglass React/Vite app shell.
- Local persistent workspace state through `localStorage` when Supabase env vars are absent.
- Email/password local demo auth, Supabase sign-in/sign-up/password reset, Google OAuth path, session boot screen, and user workspace bootstrap.
- Project Library and Create Wizard that generate a full production package, search/filter/sort projects, inspect project detail metadata, edit project and language settings, advance status, and delete projects.
- Persistent Scene Cards with editable production fields and 1-3 internal timed beats.
- NOX Core local generator for project concept, characters, world, Scene Cards, prompts, publish kit, and edit plan.
- Scene Prompt Engine with Grok and Manual Copy Mode prompt paths; regenerate/polish actions; Spanish dialogue and Honduran/Central American voice support; negative prompts; and character/world continuity blocks.
- Manual generation workflow: copy prompt with persisted copy marker, track the selected external provider on each Scene Card, queue video generation, upload generated 10-second videos through the storage adapter, approve, and send to timeline.
- Asset Vault metadata, upload intake, media preview panel, asset review actions, prompt-used snapshots, provider/scene lineage, searchable provenance, and Supabase Storage backing when configured.
- Editable Character Vault and World Bible records used by prompt regeneration and continuity checks, including prompt identity, reference image URL, voice/accent, wardrobe, negative rules, saved locations, visual rules, technology, factions, recurring symbols, and timeline anchors.
- Publish Kit generation with saved Brand Kit settings, platform captions, tags, poster prompts, Markdown/JSON exports, and TikTok/YouTube/NOX Films release bundle exports.
- NOX Cut V1 assembly controls for approved-video readiness, scene reorder, transitions, trim start/end notes, editor notes, title cards, subtitles, music, watermark overlays, assembly checks, edit-plan export, Render Engine manifest export, and queued render jobs.
- Publishing release pipeline helpers that generate platform presets, schedule/status handoff, metadata, thumbnail/poster prompts, approved video manifests, final export references, posting checklists, platform preflight cards, and queued release operation jobs for TikTok, YouTube, and NOX Films. Release operation jobs now process through both the local runner and Supabase queue processor, validate readiness blockers, and sync Project/Publish Kit status to `Scheduled` or `NOX Films Draft`.
- Render Engine V1 handoff with a shared manifest contract, `scripts/render-nox-cut.mjs` FFmpeg assembly, `scripts/render-worker.mjs` for renderer machines that need to download private Supabase Storage assets before MP4 export, and `npm run verify:render` proof that six 10-second Scene Card clips can export as an actual 60-second MP4 with title, subtitles, music, and watermark.
- Generation Queue lifecycle records for prompt work, continuity review, render jobs, export archives, provider uploads, and review actions, including retries, logs, errors, timestamps, cost estimates, actual cost, currency, provider usage metadata, workspace provider routing, a client-side runner that can execute prompt and continuity jobs or prepare provider/render handoffs, a Supabase queue claim path where `process-generation-job` can process the next due workspace job with priority, locks, retry limits, and `run_after` scheduling, and `npm run jobs:worker` for a trusted worker process that drains due jobs across accessible workspaces.
- Render-capable queue workers can run `npm run jobs:worker -- --render --upload` to hand ready Render Engine V1 jobs to `scripts/render-worker.mjs`, upload the finished MP4 to `nox-exports`, archive it as a `Final Export` Asset Vault record, and mark the durable render job complete.
- Production worker deployment artifacts: `Dockerfile.worker`, `docker-compose.worker.yml`, `scripts/worker-healthcheck.mjs`, and `docs/worker-deployment.md` define a non-root container, restart policy, render-output volume, production dependency install, Supabase/RLS healthcheck, and `npm run jobs:worker -- --render --upload` command for hosted workers.
- Production reliability controls: `docs/production-runbook.md`, worker cost ceilings, worker alert webhooks, durable job logs, retry limits, and Asset Vault cleanup guidance cover deploy, key rotation, worker restart, failure recovery, and generated asset cleanup.
- Grok-only provider foundations: Settings has a Grok API Key card for verify/save/remove, stores only encrypted workspace secrets through `manage-provider-secret`, shows masked status from `workspace_provider_secrets`, and keeps raw keys out of browser state, localStorage, RLS-visible tables, and provider settings. Grok prompt, continuity, image, and video jobs route server-side through `process-generation-job`; unconfigured local/demo work can continue through deterministic NOX Core and Manual Mode handoff.
- Supabase migrations with profiles, workspaces, projects, scenes, scene beats, assets, characters, worlds, locations, factions, generation jobs, publish kits, timeline items, timeline trim notes, brand kits, constraints, indexes, RLS, and private storage buckets.

## Supabase Connection

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local`.
3. Set the Supabase URL, anon key, test user credentials, Grok key or saved workspace Grok secret, and `NOX_SECRET_ENCRYPTION_KEY`.
4. Set:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
NOX_SUPABASE_TEST_EMAIL=
NOX_SUPABASE_TEST_PASSWORD=
```

When these env vars are set, `src/lib/studioRepository.ts` switches to the Supabase repository and persists the same domain records used by local mode.

Before deploys, run:

```text
npm run verify:production
npm run verify:workflow
npm run verify:render
npm run build
npm run supabase:preflight
```

The production verifier checks the V1 contract for Supabase tables, RLS, storage buckets, auth paths, storage upload routing, generation gateway calls, Asset Vault prompt lineage, Grok-backed Edge Function entrypoints, the encrypted secret manager, the authenticated generation job processor, production worker container artifacts, and bundled Edge deployability. The workflow verifier dynamically exercises a six-scene production package, Grok prompts, manual approved-video assembly state, Asset Vault prompt snapshots, Publish Kit exports, and NOX Cut edit-plan readiness.

For the production launch path, authenticate the Supabase CLI, set `SUPABASE_PROJECT_REF` or `NOX_SUPABASE_PROJECT_REF` when the project is not already linked, then run:

```text
npm run supabase:deploy
```

That command loads `.env.local`, runs `supabase db push`, deploys all four Edge Functions, sets any present Grok/secret-vault server values, and finishes by running `npm run verify:supabase-live` against the real project.

Phase 4 and Phase 5 use Grok in deployed Supabase Edge Functions. Set `XAI_API_KEY` with `supabase secrets set XAI_API_KEY=xai-...`, optionally set `NOX_GROK_TEXT_MODEL=grok-4.3`, `NOX_GROK_IMAGE_MODEL=grok-imagine-image-quality`, and `NOX_GROK_VIDEO_MODEL=grok-imagine-video`, and set `NOX_GROK_STRICT=1` when the deployed function should fail instead of falling back to deterministic NOX Core. Set `NOX_SECRET_ENCRYPTION_KEY` before saving workspace Grok keys. Deploy `generate-concept`, `generate-scene-prompt`, `process-generation-job`, and `manage-provider-secret`. The creative functions use xAI chat completions with Structured Outputs, then map the result into NOX Studio's stable production schema so IDs, workspace ownership, Scene Card duration, and the one-video-per-card rule remain app-controlled. The job processor uses the caller's Supabase session, respects RLS, writes durable lifecycle logs, and persists prompt/video/render handoff results.

After deploy, open Settings > Production Readiness and press Run Check. The diagnostic uses the browser's configured Supabase session to verify Auth, RLS-backed tables, private Storage bucket upload/signed-preview/cleanup checks, Grok key-vault readiness from `workspace_provider_secrets`, the `generate-concept` / `generate-scene-prompt` Edge Function health actions, and the authenticated `process-generation-job` runtime health action. It also warns when the creative functions are deployed but Grok is not configured, because that means Phase 4/5 are using deterministic fallback. In local demo mode, the same panel clearly reports that live production services are not being checked yet.

For CI or terminal-based live proof, run `npm run verify:supabase-live` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `NOX_SUPABASE_TEST_EMAIL`, and `NOX_SUPABASE_TEST_PASSWORD` set. The audit signs in as the test user, creates a temporary workspace, checks RLS visibility, exercises the Edge Functions, processes a named queued Scene Card prompt job, claims and completes the next due queued job through the worker path, uploads to every private Storage bucket, persists a generated six-scene package, verifies Project/Scene/Asset/Publish/Timeline readback, signs in again with a fresh client to prove those records and private Storage previews survive production reload, and fails if it cannot remove the temporary audit workspace and Storage objects by default. Set `NOX_LIVE_AUDIT_REQUIRE_GROK=1` when CI must prove deployed Phase 4/5 generation is Grok-backed instead of fallback. Add `NOX_SUPABASE_OTHER_EMAIL` and `NOX_SUPABASE_OTHER_PASSWORD` to prove a second authenticated user cannot read/delete the audit workspace or access its private Storage prefix; set `NOX_SUPABASE_STRICT_ISOLATION=1` to require that denial proof in CI.

For hosted queue/render execution, set the worker credentials in `.env.local`, then run:

```text
docker compose -f docker-compose.worker.yml up -d --build
npm run jobs:healthcheck
```

The compose worker runs the same trusted queue processor with `--render --upload`, stores render scratch files on the `nox-worker-renders` volume, restarts unless stopped, and uses the healthcheck to prove Supabase Auth, the deployed queue function, and any configured workspace allowlist before it is considered healthy.

## Current Limits

- NOX Core, Scene Prompt Engine, and the manual Run action for queued jobs run through `src/lib/generationGateway.ts`: Supabase deployments call `generate-concept`, `generate-scene-prompt`, and `process-generation-job`, while local/demo mode uses the deterministic generator and local job-runner fallback.
- Grok video generation is wired through the server queue path when a Grok key is configured; Manual Mode remains available for local/demo fallback and operator review.
- Full in-app MP4 rendering still needs a hosted renderer worker or desktop worker process. The current Render Engine V1 slice exports a manifest, queues a render job, includes a Supabase-aware render worker that downloads private Storage assets for a signed-in workspace member, and includes a Node FFmpeg runner that assembles an MP4 when FFmpeg is available; it also applies title cards, subtitles, transition fades, watermark overlays, and local music beds from NOX Cut utility tracks when their assets resolve on the renderer machine.
- Production queue automation now has a container and compose contract, but it still needs the user's real Supabase project credentials and a confirmed worker account before it can be proven against production data.
