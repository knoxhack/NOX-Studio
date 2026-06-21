alter table public.provider_settings
  add column if not exists api_endpoint text not null default '',
  add column if not exists secret_name text not null default '',
  add column if not exists webhook_enabled boolean not null default false,
  add column if not exists connection_status text not null default 'Not configured',
  add column if not exists config jsonb not null default '{}'::jsonb;

create index if not exists provider_settings_workspace_connection_idx
  on public.provider_settings (workspace_id, provider_id, webhook_enabled, connection_status);
