alter table public.quizzes
  alter column owner_id drop not null,
  add column if not exists owner_edutech_user_id uuid,
  add column if not exists linked_lesson_id uuid,
  add column if not exists attempt_limit integer,
  add column if not exists release_mode text not null default 'manual',
  add column if not exists release_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quizzes_attempt_limit_check') then
    alter table public.quizzes add constraint quizzes_attempt_limit_check check (attempt_limit is null or attempt_limit between 1 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quizzes_release_mode_check') then
    alter table public.quizzes add constraint quizzes_release_mode_check check (release_mode in ('automatic','manual','scheduled'));
  end if;
end $$;

create unique index if not exists quizzes_one_linked_quiz_per_lesson on public.quizzes(linked_lesson_id) where linked_lesson_id is not null;
create index if not exists quizzes_edutech_owner_idx on public.quizzes(owner_edutech_user_id) where owner_edutech_user_id is not null;

create table if not exists public.quiz_versions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_by_edutech_user_id uuid,
  created_at timestamptz not null default now(),
  unique (quiz_id, version_number)
);

alter table public.questions add column if not exists quiz_version_id uuid references public.quiz_versions(id);
create index if not exists questions_quiz_version_idx on public.questions(quiz_version_id) where quiz_version_id is not null;

alter table public.submissions
  add column if not exists edutech_user_id uuid,
  add column if not exists quiz_version_id uuid references public.quiz_versions(id),
  add column if not exists attempt_number integer not null default 1;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'submissions_attempt_number_check') then
    alter table public.submissions add constraint submissions_attempt_number_check check (attempt_number > 0);
  end if;
end $$;

create unique index if not exists submissions_edutech_attempt_unique on public.submissions(quiz_id, edutech_user_id, attempt_number) where edutech_user_id is not null;
create index if not exists submissions_edutech_user_idx on public.submissions(edutech_user_id, quiz_id) where edutech_user_id is not null;

create table if not exists public.edutech_integration_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  edutech_user_id uuid not null,
  lesson_id uuid not null,
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  quiz_version_id uuid references public.quiz_versions(id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.edutech_integration_sessions add column if not exists quiz_version_id uuid references public.quiz_versions(id);
create index if not exists edutech_sessions_expiry_idx on public.edutech_integration_sessions(expires_at);

alter table public.quiz_versions enable row level security;
alter table public.edutech_integration_sessions enable row level security;
revoke all on public.quiz_versions from anon, authenticated;
revoke all on public.edutech_integration_sessions from anon, authenticated;
grant all on public.quiz_versions to service_role;
grant all on public.edutech_integration_sessions to service_role;
