-- Run only with a schema operator. Never grant ownership or bypassrls to wedding_app.
create schema wedding;
revoke all on schema wedding from public, anon, authenticated;
grant usage on schema wedding to wedding_app;
alter default privileges in schema wedding revoke all on tables from public, anon, authenticated;
-- PostgreSQL grants function EXECUTE globally; a schema-local REVOKE cannot remove it.
alter default privileges revoke execute on functions from public, anon, authenticated;
alter default privileges in schema wedding revoke all on sequences from public, anon, authenticated;

create table wedding.invitation_groups (
  id text primary key check (id in ('group-1','group-2')),
  code_hash text unique check (code_hash ~ '^[a-f0-9]{64}$'),
  rotated_at timestamptz not null default now()
);
create table wedding.guest_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id text not null references wedding.invitation_groups(id),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index guest_sessions_group_id_idx on wedding.guest_sessions(group_id);
create table wedding.events (
  id text primary key check (id in ('mehendi','brides-mayara','haldi','grooms-mayara','reception','baraat','phere-sajjan-goth','closing-dinner')),
  start_at timestamptz not null, end_at timestamptz,
  title jsonb not null check (title ?& array['en','hi']),
  description jsonb not null check (description ?& array['en','hi']),
  venue_sublocation jsonb, dress_code jsonb,
  map_url text not null check (map_url ~ '^https?://'),
  cancelled boolean not null default false,
  check (end_at is null or end_at > start_at)
);
create table wedding.event_groups (
  event_id text not null references wedding.events(id) on delete restrict,
  group_id text not null references wedding.invitation_groups(id),
  primary key(event_id, group_id)
);
create index event_groups_group_id_idx on wedding.event_groups(group_id);
create table wedding.website_content (
  singleton boolean primary key default true check (singleton),
  revision integer not null check(revision > 0),
  couple jsonb not null, wedding jsonb not null,
  story jsonb not null check (story ?& array['en','hi']),
  families jsonb not null check (families ?& array['en','hi']),
  welcome jsonb not null check (welcome ?& array['en','hi']),
  labels jsonb not null check (labels ?& array['en','hi']),
  ceremony_copy_approved boolean not null default false,
  hindi_approved boolean not null default false
);
create table wedding.content_photos (
  id text primary key,
  storage_path text not null unique check (storage_path !~ '(^/|\.\.|:)'),
  alt jsonb not null check (alt ?& array['en','hi']),
  position integer not null unique check (position >= 0),
  provenance text not null check (length(provenance) > 0)
);
create table wedding.site_settings (
  singleton boolean primary key default true check (singleton),
  new_rsvp_closes_at timestamptz not null,
  help_phone text not null check (help_phone ~ '^\+[1-9][0-9 ]{6,20}$'),
  help_tel_url text not null, help_whatsapp_url text not null,
  max_party_size integer not null check (max_party_size between 1 and 200),
  check (help_tel_url = 'tel:' || replace(help_phone, ' ', '')),
  check (help_whatsapp_url = 'https://wa.me/' || substring(replace(help_phone, ' ', '') from 2))
);
-- Auth lives in the vendor database: identity is verified by Auth API, then this allowlist.
create table wedding.organizer_users (
  user_id uuid primary key, created_at timestamptz not null default now()
);
create table wedding.rsvp_submissions (
  id uuid primary key default gen_random_uuid(),
  group_id text not null references wedding.invitation_groups(id),
  version integer not null default 1 check(version > 0),
  request_id uuid not null,
  original_duplicate_warning boolean not null default false,
  payload_fingerprint text not null check(payload_fingerprint ~ '^[a-f0-9]{64}$'),
  edit_token_hash text not null unique check(edit_token_hash ~ '^[a-f0-9]{64}$'),
  decision text not null check(decision in ('accept','decline')),
  contact_full_name text not null check(length(contact_full_name) between 1 and 200),
  contact_name_normalized text not null,
  contact_phone text not null check(contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  arrival_date date, arrival_window text,
  departure_date date, departure_window text,
  song_name text check(length(song_name)<=200), song_artist text check(length(song_artist)<=200),
  song_url text check(length(song_url)<=2048 and song_url ~ '^https?://'),
  questions text check(length(questions)<=2000), note text check(length(note)<=2000),
  source text not null default 'website' check(source in ('website','whatsapp','phone')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,group_id),
  constraint rsvp_submissions_group_request_id_key unique(group_id,request_id),
  check ((decision='accept' and arrival_date is not null and departure_date is not null and arrival_window is not null and departure_window is not null and note is null)
    or (decision='decline' and arrival_date is null and departure_date is null and arrival_window is null and departure_window is null and song_name is null and song_artist is null and song_url is null and questions is null)),
  check(arrival_window in ('before-noon','noon-5pm','5-9pm','after-9pm')),
  check(departure_window in ('before-noon','noon-5pm','5-9pm','after-9pm')),
  check (departure_date - arrival_date between 0 and 366),
  check (departure_date <> arrival_date or array_position(array['before-noon','noon-5pm','5-9pm','after-9pm'], departure_window) >= array_position(array['before-noon','noon-5pm','5-9pm','after-9pm'], arrival_window)),
  check ((song_name is null and song_artist is null and song_url is null) or (song_name is not null and song_artist is not null and length(song_name)>0 and length(song_artist)>0))
);
create index rsvp_submissions_group_id_idx on wedding.rsvp_submissions(group_id);
create index rsvp_submissions_phone_idx on wedding.rsvp_submissions(contact_phone);
create index rsvp_submissions_name_idx on wedding.rsvp_submissions(contact_name_normalized);
create table wedding.rsvp_guests (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references wedding.rsvp_submissions(id) on delete cascade,
  full_name text not null check(length(full_name) between 1 and 200),
  position integer not null check(position between 0 and 199),
  unique(submission_id,position)
);
create table wedding.rsvp_event_selections (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  event_id text not null, group_id text not null,
  foreign key(submission_id,group_id) references wedding.rsvp_submissions(id,group_id) on delete cascade,
  foreign key(event_id,group_id) references wedding.event_groups(event_id,group_id) on delete restrict,
  unique(submission_id,event_id)
);
create index rsvp_event_selections_event_idx on wedding.rsvp_event_selections(event_id,group_id);
create table wedding.edit_sessions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references wedding.rsvp_submissions(id) on delete cascade,
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(), expires_at timestamptz not null,
  revoked_at timestamptz,
  check(expires_at > created_at)
);
create index edit_sessions_submission_idx on wedding.edit_sessions(submission_id);
create table wedding.audit_log (
  id uuid primary key default gen_random_uuid(),
  organizer_user_id uuid references wedding.organizer_users(user_id),
  submission_id uuid references wedding.rsvp_submissions(id) on delete set null,
  action text not null, reason text, details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_organizer_idx on wedding.audit_log(organizer_user_id);
create index audit_log_submission_idx on wedding.audit_log(submission_id);
create table wedding.abuse_buckets (
  key_hash text primary key check(key_hash ~ '^[a-f0-9]{64}$'),
  count integer not null check(count >= 0), window_start timestamptz not null,
  expires_at timestamptz not null check(expires_at > window_start)
);
create index abuse_buckets_expiry_idx on wedding.abuse_buckets(expires_at);

-- Contextual guest/editor/admin authorization belongs to server services.
-- This role is server-only; browser Supabase roles receive no policy or grant.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='wedding' loop
    execute format('alter table wedding.%I enable row level security', t.tablename);
    execute format('alter table wedding.%I force row level security', t.tablename);
    execute format('revoke all on wedding.%I from public, anon, authenticated', t.tablename);
    execute format('grant select, insert, update, delete on wedding.%I to wedding_app', t.tablename);
    execute format('create policy server_only on wedding.%I for all to wedding_app using (true) with check (true)', t.tablename);
  end loop;
end $$;
revoke execute on all functions in schema wedding from public, anon, authenticated;
