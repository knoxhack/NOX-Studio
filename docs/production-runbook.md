# NOX Studio Production Runbook

## Deploy

Run the local verification suite before every deploy:

```bash
npm run verify:production
npm run verify:workflow
npm run build
npm run verify:render
```

Deploy Supabase migrations and Edge Functions with:

```bash
npm run supabase:deploy
```

Required server-side secrets are `XAI_API_KEY`, `NOX_GROK_TEXT_MODEL`, `NOX_GROK_IMAGE_MODEL`, `NOX_GROK_VIDEO_MODEL`, `NOX_GROK_STRICT`, `NOX_SECRET_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `NOX_PROVIDER_CALLBACK_TOKEN`.

## Key Rotation

Rotate the workspace Grok key from Settings using Remove Key, then paste, verify, and save the replacement key. Rotate server fallback keys with `supabase secrets set XAI_API_KEY=...`, then redeploy or restart Edge Functions if the platform requires it.

## Worker Restart

Restart hosted workers with:

```bash
docker compose -f docker-compose.worker.yml up -d --build
npm run jobs:healthcheck
```

Use `NOX_GENERATION_WORKER_MAX_DAILY_COST_USD` to stop the worker after a local cost ceiling and `NOX_GENERATION_WORKER_ALERT_WEBHOOK_URL` to receive fatal worker or cost-ceiling alerts.

## Failure Recovery

Use the Generation Queue operator controls to retry failed jobs, queue missing Grok videos, queue Publish Kit media, and approve continuity-passing review assets. Failed render jobs keep logs on the durable generation job and retry through the same queue lifecycle.

## Cleanup

Remove rejected or stale generated assets from Asset Vault so linked Storage objects are deleted. Failed jobs can be retried until their retry limit or left as audit history. Render scratch files are stored in `NOX_GENERATION_WORKER_RENDER_DIR`; container deployments should keep that directory on the `nox-worker-renders` volume and periodically remove old local files after final exports are archived in `nox-exports`.
