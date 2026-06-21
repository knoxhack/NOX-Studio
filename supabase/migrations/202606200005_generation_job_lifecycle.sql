alter table public.generation_jobs
  add column if not exists retry_count integer not null default 0,
  add column if not exists max_retries integer not null default 2,
  add column if not exists logs jsonb not null default '[]'::jsonb;

create index if not exists generation_jobs_workspace_retry_idx
  on public.generation_jobs (workspace_id, status, retry_count, created_at desc);
