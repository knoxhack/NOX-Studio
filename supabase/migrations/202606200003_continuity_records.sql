alter table public.characters
  add column if not exists reference_image_url text;

alter table public.worlds
  add column if not exists locations text[] not null default '{}',
  add column if not exists timeline text[] not null default '{}';

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  world_id uuid references public.worlds (id) on delete cascade,
  name text not null,
  description text not null default '',
  visual_rules text[] not null default '{}',
  timeline_notes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table public.factions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  world_id uuid references public.worlds (id) on delete cascade,
  name text not null,
  description text not null default '',
  visual_rules text[] not null default '{}',
  negative_rules text[] not null default '{}',
  timeline_notes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create index locations_workspace_name_idx on public.locations (workspace_id, name);
create index locations_world_idx on public.locations (world_id);
create index factions_workspace_name_idx on public.factions (workspace_id, name);
create index factions_world_idx on public.factions (world_id);

alter table public.locations enable row level security;
alter table public.factions enable row level security;

create policy locations_workspace_access on public.locations
  for all using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy factions_workspace_access on public.factions
  for all using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
