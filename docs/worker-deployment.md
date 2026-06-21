# NOX Production Worker Deployment

The generation worker is the production runtime for long-running work: queue claims, prompt jobs, continuity jobs, provider handoffs, Render Engine jobs, final MP4 uploads, and release operation jobs. It runs as a trusted Supabase workspace member, not as an anonymous browser client.

## Required Environment

Copy `.env.example` to `.env.local` and set these values before starting the worker container:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
NOX_SUPABASE_WORKER_EMAIL=
NOX_SUPABASE_WORKER_PASSWORD=
```

The worker account must be confirmed in Supabase Auth and must belong to every workspace it is allowed to process. Set `NOX_GENERATION_WORKER_WORKSPACE_IDS` to a comma-separated allowlist when the account can see multiple workspaces and the service should only drain specific ones.

Render-capable production workers also use:

```text
NOX_GENERATION_WORKER_RENDER=1
NOX_RENDER_UPLOAD=1
NOX_GENERATION_WORKER_RENDER_DIR=/app/dist/generation-worker-renders
NOX_SUPABASE_RENDER_EMAIL=
NOX_SUPABASE_RENDER_PASSWORD=
NOX_FFMPEG_PATH=
```

If `NOX_SUPABASE_RENDER_EMAIL` and `NOX_SUPABASE_RENDER_PASSWORD` are omitted, the render worker reuses the generation worker credentials. The Docker image uses the bundled `ffmpeg-static` binary by default, so `NOX_FFMPEG_PATH` is only needed when you mount a custom FFmpeg build.

## Container Runtime

Build and start the production worker:

```bash
docker compose -f docker-compose.worker.yml up -d --build
```

Watch logs:

```bash
docker compose -f docker-compose.worker.yml logs -f nox-generation-worker
```

Stop the worker:

```bash
docker compose -f docker-compose.worker.yml down
```

The compose service runs:

```bash
npm run jobs:worker -- --render --upload
```

That mode claims due jobs through `process-generation-job` with `action: "process-next"`. When a claimed job contains a ready `NOX Render Engine V1` manifest, the worker runs `scripts/render-worker.mjs`, downloads private Storage assets through RLS, assembles the MP4, uploads it to `nox-exports`, archives a `Final Export` asset, and marks the durable job completed.

## Health Check

Run the same healthcheck used by Docker:

```bash
npm run jobs:healthcheck
```

The healthcheck signs in with the worker credentials, verifies the `process-generation-job` Edge Function health action, and confirms configured workspace IDs are visible through RLS. It never calls `process-next`, so it will not claim or mutate jobs.

The container healthcheck runs every 60 seconds with a 20-second timeout. A healthy service proves credentials, Supabase URL/anon key, deployed queue function, and workspace membership are all wired correctly.

## Operational Notes

Use `restart: unless-stopped` for a long-running worker. Keep the render output directory on a named volume so partially written local files survive container restarts long enough for inspection. Jobs remain durable in Supabase either way: successful renders are archived to `nox-exports`, and failed renders write error logs, unlock the job, and schedule the next retry through the queue lifecycle fields.

Run `npm run verify:production` after changing worker deployment artifacts. Run `npm run verify:supabase-live` after real Supabase credentials are available to prove the end-to-end production path with user-owned data.
