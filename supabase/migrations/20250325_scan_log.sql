create table if not exists public.scan_log (
  id bigint generated always as identity primary key,
  token_key text not null,
  verdict text not null,
  phishing_score smallint,
  spam_score smallint,
  response_time_ms int,
  created_at timestamptz not null default now()
);

create index if not exists scan_log_token_created_idx
  on public.scan_log (token_key, created_at desc);

alter table public.scan_log enable row level security;

revoke all on table public.scan_log from anon, authenticated;
