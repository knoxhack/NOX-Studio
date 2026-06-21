alter table public.generation_jobs
  add column if not exists priority integer not null default 0,
  add column if not exists run_after timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text;

create index if not exists generation_jobs_workspace_claim_idx
  on public.generation_jobs (workspace_id, status, run_after, priority desc, created_at asc)
  where status in ('Queued', 'Failed');

create or replace function public.claim_next_generation_job(
  target_workspace_id uuid,
  worker_id text default null
)
returns setof public.generation_jobs
language plpgsql
security invoker
set search_path = public
as $$
declare
  claimed_id uuid;
  actual_worker text := coalesce(nullif(worker_id, ''), gen_random_uuid()::text);
begin
  if not public.is_workspace_member(target_workspace_id) then
    raise exception 'Workspace access denied for generation job claim.' using errcode = '42501';
  end if;

  update public.generation_jobs job
  set
    status = 'Running',
    started_at = coalesce(job.started_at, now()),
    completed_at = null,
    error_message = '',
    retry_count = case
      when job.status = 'Failed' then least(job.retry_count + 1, job.max_retries)
      else job.retry_count
    end,
    locked_at = now(),
    locked_by = actual_worker,
    logs = coalesce(job.logs, '[]'::jsonb) || to_jsonb(to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ' - Running: claimed by queue worker ' || actual_worker || '.')
  where job.id = (
    select candidate.id
    from public.generation_jobs candidate
    where candidate.workspace_id = target_workspace_id
      and candidate.run_after <= now()
      and (
        candidate.status = 'Queued'
        or (candidate.status = 'Failed' and candidate.retry_count < candidate.max_retries)
      )
      and (
        candidate.locked_at is null
        or candidate.locked_at < now() - interval '15 minutes'
      )
    order by candidate.priority desc, candidate.created_at asc
    for update skip locked
    limit 1
  )
  returning job.id into claimed_id;

  if claimed_id is null then
    return;
  end if;

  return query
    select *
    from public.generation_jobs
    where id = claimed_id;
end;
$$;

grant execute on function public.claim_next_generation_job(uuid, text) to authenticated;
