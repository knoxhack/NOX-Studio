create extension if not exists pgcrypto;

create type public.project_status as enum (
  'Idea',
  'Script Ready',
  'Scene Prompts Ready',
  'Generating Videos',
  'Editing',
  'Ready to Publish',
  'Published',
  'Scene Videos Needed',
  'Publish Kit Ready'
);

create type public.scene_status as enum (
  'Draft',
  'Prompt Ready',
  'Generating Video',
  'Video Uploaded',
  'Needs Redo',
  'Approved',
  'Added to Timeline',
  'Rendered',
  'Published'
);

create type public.asset_status as enum ('Draft', 'Stored', 'Needs Review', 'Approved', 'Rejected');
create type public.generation_status as enum ('Queued', 'Running', 'Completed', 'Failed', 'Needs Review', 'Approved');
create type public.release_status as enum ('Studio Draft', 'NOX Films Draft', 'Scheduled', 'Published', 'Unlisted', 'Private', 'Archived');
create type public.timeline_track_type as enum ('video', 'audio', 'subtitle', 'overlay', 'title', 'transition');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan text not null default 'Creator',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  type text not null,
  title text not null,
  slug text not null,
  idea text not null default '',
  logline text not null default '',
  synopsis text not null default '',
  status public.project_status not null default 'Idea',
  release_status public.release_status not null default 'Studio Draft',
  format text not null,
  aspect_ratio text not null default '9:16',
  duration_seconds integer not null check (duration_seconds > 0),
  scene_count integer not null check (scene_count > 0),
  genre text not null,
  tone text not null,
  world_name text not null default '',
  ai_target text not null default 'Manual Copy Mode',
  language jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  alias text not null default '',
  role text not null default '',
  personality text not null default '',
  backstory text not null default '',
  visual_identity text not null default '',
  voice_style text not null default '',
  accent text not null default '',
  wardrobe_rules text[] not null default '{}',
  prompt_identity text not null default '',
  negative_rules text[] not null default '{}',
  appears_in text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.worlds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text not null default '',
  tone text not null default '',
  visual_rules text[] not null default '{}',
  technology text[] not null default '{}',
  factions text[] not null default '{}',
  recurring_symbols text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  scene_number integer not null check (scene_number > 0),
  title text not null,
  purpose text not null default '',
  duration_seconds integer not null default 10 check (duration_seconds = 10),
  output text not null default 'One generated video',
  format text not null default '9:16 vertical cinematic',
  location text not null default '',
  characters text[] not null default '{}',
  mood text not null default '',
  visual_style text not null default '',
  summary text not null default '',
  full_prompt text not null default '',
  negative_prompt text not null default '',
  dialogue text not null default '',
  audio_notes text not null default '',
  continuity_rules text[] not null default '{}',
  status public.scene_status not null default 'Draft',
  approved_asset_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, scene_number)
);

create table public.scene_beats (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes (id) on delete cascade,
  beat_number integer not null check (beat_number between 1 and 3),
  start_second integer not null check (start_second >= 0 and start_second < 10),
  end_second integer not null check (end_second > start_second and end_second <= 10),
  beat_type text not null default 'internal_prompt_instruction',
  title text not null default '',
  description text not null,
  camera_direction text not null default '',
  action text not null default '',
  dialogue text not null default '',
  audio text not null default '',
  created_at timestamptz not null default now(),
  unique (scene_id, beat_number)
);

comment on table public.scene_beats is
  'Timed prompt instructions inside one Scene Card video. These are not separate generated video files.';

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  scene_id uuid references public.scenes (id) on delete set null,
  character_id uuid references public.characters (id) on delete set null,
  type text not null,
  file_url text not null default '',
  thumbnail_url text not null default '',
  filename text not null,
  mime_type text not null default '',
  duration_seconds integer,
  width integer,
  height integer,
  status public.asset_status not null default 'Stored',
  provider text not null default 'Uploaded',
  prompt_id uuid,
  notes text not null default '',
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.scenes
  add constraint scenes_approved_asset_id_fkey
  foreign key (approved_asset_id)
  references public.assets (id)
  on delete set null;

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  scene_id uuid references public.scenes (id) on delete cascade,
  job_type text not null,
  provider text not null,
  status public.generation_status not null default 'Queued',
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  error_message text not null default '',
  cost_estimate numeric(10,4),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.publish_kits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  tiktok_title text not null default '',
  caption text not null default '',
  hashtags text[] not null default '{}',
  hook_line text not null default '',
  pinned_comment text not null default '',
  youtube_title text not null default '',
  description text not null default '',
  tags text[] not null default '{}',
  chapters text[] not null default '{}',
  nox_films_row text not null default '',
  runtime text not null default '',
  genre text not null default '',
  thumbnail_prompt text not null default '',
  poster_prompt text not null default '',
  release_status public.release_status not null default 'Studio Draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create table public.timeline_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  asset_id uuid references public.assets (id) on delete set null,
  scene_id uuid references public.scenes (id) on delete set null,
  track_type public.timeline_track_type not null,
  label text not null,
  start_time numeric(8,3) not null check (start_time >= 0),
  end_time numeric(8,3) not null check (end_time > start_time),
  order_index integer not null default 0,
  transition_in text not null default 'None',
  transition_out text not null default 'None',
  text_overlay text,
  subtitle_text text,
  trim_start_note text,
  trim_end_note text,
  editor_notes text,
  created_at timestamptz not null default now()
);

create table public.brand_kits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  studio_name text not null default 'NOX Films',
  creator_name text not null default 'NOX Studio',
  intro_text text not null default 'A NOX Films Original',
  outro_text text not null default 'Watch more on NOX Films',
  watermark_asset_id uuid references public.assets (id) on delete set null,
  default_style text not null default 'Futuristic cyberglass cinematic',
  default_export text not null default '9:16 TikTok + 16:9 YouTube',
  subtitle_style text not null default 'Bold white cinematic subtitles with shadow',
  default_colors text[] not null default '{}',
  default_hashtags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);
create index projects_workspace_status_updated_idx on public.projects (workspace_id, status, updated_at desc);
create index projects_workspace_created_idx on public.projects (workspace_id, created_at desc);
create index scenes_project_status_number_idx on public.scenes (project_id, status, scene_number);
create index scene_beats_scene_id_idx on public.scene_beats (scene_id);
create index assets_workspace_project_idx on public.assets (workspace_id, project_id, created_at desc);
create index assets_scene_id_idx on public.assets (scene_id);
create index generation_jobs_workspace_status_idx on public.generation_jobs (workspace_id, status, created_at desc);
create index generation_jobs_project_idx on public.generation_jobs (project_id, created_at desc);
create index publish_kits_project_id_idx on public.publish_kits (project_id);
create index timeline_items_project_order_idx on public.timeline_items (project_id, order_index);
create index characters_workspace_name_idx on public.characters (workspace_id, name);
create index worlds_workspace_name_idx on public.worlds (workspace_id, name);

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

create or replace function public.is_project_member(target_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.characters enable row level security;
alter table public.worlds enable row level security;
alter table public.scenes enable row level security;
alter table public.scene_beats enable row level security;
alter table public.assets enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.publish_kits enable row level security;
alter table public.timeline_items enable row level security;
alter table public.brand_kits enable row level security;

create policy profiles_self_access on public.profiles
  for all to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy workspaces_member_access on public.workspaces
  for all to authenticated
  using (owner_id = auth.uid() or public.is_workspace_member(id))
  with check (owner_id = auth.uid() or public.is_workspace_member(id));

create policy workspace_members_self_access on public.workspace_members
  for all to authenticated
  using (user_id = auth.uid() or public.is_workspace_member(workspace_id))
  with check (user_id = auth.uid() or public.is_workspace_member(workspace_id));

create policy projects_workspace_access on public.projects
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy characters_workspace_access on public.characters
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy worlds_workspace_access on public.worlds
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy scenes_project_access on public.scenes
  for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

create policy scene_beats_scene_access on public.scene_beats
  for all to authenticated
  using (
    exists (
      select 1 from public.scenes s
      where s.id = scene_id and public.is_project_member(s.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.scenes s
      where s.id = scene_id and public.is_project_member(s.project_id)
    )
  );

create policy assets_workspace_access on public.assets
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy generation_jobs_workspace_access on public.generation_jobs
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy publish_kits_project_access on public.publish_kits
  for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

create policy timeline_items_project_access on public.timeline_items
  for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

create policy brand_kits_workspace_access on public.brand_kits
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

insert into storage.buckets (id, name, public)
values
  ('nox-videos', 'nox-videos', false),
  ('nox-images', 'nox-images', false),
  ('nox-audio', 'nox-audio', false),
  ('nox-exports', 'nox-exports', false),
  ('nox-brand', 'nox-brand', false)
on conflict (id) do nothing;

create policy storage_workspace_read on storage.objects
  for select to authenticated
  using (
    bucket_id in ('nox-videos', 'nox-images', 'nox-audio', 'nox-exports', 'nox-brand')
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );

create policy storage_workspace_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('nox-videos', 'nox-images', 'nox-audio', 'nox-exports', 'nox-brand')
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );

create policy storage_workspace_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('nox-videos', 'nox-images', 'nox-audio', 'nox-exports', 'nox-brand')
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id in ('nox-videos', 'nox-images', 'nox-audio', 'nox-exports', 'nox-brand')
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );

create policy storage_workspace_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('nox-videos', 'nox-images', 'nox-audio', 'nox-exports', 'nox-brand')
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );
