alter table public.edutech_integration_sessions
  add column if not exists attempt_number integer not null default 1 check (attempt_number > 0);

create table if not exists public.edutech_tutorial_answer_locks (
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  edutech_user_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  question_id uuid not null references public.questions(id) on delete cascade,
  selected_option integer not null,
  is_correct boolean not null,
  created_at timestamptz not null default now(),
  primary key (quiz_id, edutech_user_id, attempt_number, question_id)
);

alter table public.edutech_tutorial_answer_locks enable row level security;
revoke all on public.edutech_tutorial_answer_locks from anon, authenticated;
grant all on public.edutech_tutorial_answer_locks to service_role;
