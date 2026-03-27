create table if not exists public.user_feedback (
  id bigint generated always as identity primary key,
  token_key text not null,
  feedback_type text not null check (feedback_type in ('false_positive', 'missed_threat')),
  original_verdict text not null,
  original_phishing_score smallint,
  original_spam_score smallint,
  email_subject text,
  email_sender text,
  email_recipient text,
  user_comment text,
  reviewed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists user_feedback_type_idx
  on public.user_feedback (feedback_type, reviewed, created_at desc);

create index if not exists user_feedback_token_idx
  on public.user_feedback (token_key, created_at desc);

alter table public.user_feedback enable row level security;

revoke all on table public.user_feedback from anon, authenticated;
