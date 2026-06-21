create table public.workspace_provider_secrets (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider_id text not null,
  secret_kind text not null default 'api_key',
  encrypted_secret text not null,
  nonce text not null,
  key_last4 text not null default '',
  status text not null default 'Not configured',
  verified_model text not null default '',
  verified_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, provider_id, secret_kind)
);

create index workspace_provider_secrets_workspace_idx
  on public.workspace_provider_secrets (workspace_id, provider_id, status);

alter table public.workspace_provider_secrets enable row level security;

create policy workspace_provider_secrets_no_direct_access on public.workspace_provider_secrets
  for all to authenticated
  using (false)
  with check (false);

comment on table public.workspace_provider_secrets is
  'Encrypted workspace-scoped provider API keys. Browser clients use manage-provider-secret and only receive metadata such as key_last4 and status.';
