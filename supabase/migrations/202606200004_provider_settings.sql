create table public.provider_settings (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider_id text not null,
  name text not null,
  supported_tasks text not null default '',
  speed text not null default '',
  quality text not null default '',
  enabled boolean not null default true,
  mode text not null default 'Manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, provider_id)
);

create index provider_settings_workspace_enabled_idx on public.provider_settings (workspace_id, enabled);

alter table public.provider_settings enable row level security;

create policy provider_settings_workspace_access on public.provider_settings
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
