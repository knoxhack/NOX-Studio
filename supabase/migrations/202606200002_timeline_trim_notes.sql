alter table public.timeline_items
  add column if not exists trim_start_note text,
  add column if not exists trim_end_note text,
  add column if not exists editor_notes text;
