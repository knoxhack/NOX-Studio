alter table public.generation_jobs
  add column if not exists cost_actual numeric(10,4),
  add column if not exists cost_currency text not null default 'USD',
  add column if not exists usage_metadata jsonb not null default '{}'::jsonb;

create index if not exists generation_jobs_workspace_cost_idx
  on public.generation_jobs (workspace_id, cost_actual, created_at desc)
  where cost_actual is not null;
