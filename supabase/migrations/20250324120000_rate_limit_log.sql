-- Used by Edge Function analyze-email for per-token rate limiting (hashed keys only).
create table if not exists public.rate_limit_log (
  id bigint generated always as identity primary key,
  token_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_log_token_created_idx
  on public.rate_limit_log (token_key, created_at desc);

alter table public.rate_limit_log enable row level security;

revoke all on table public.rate_limit_log from anon, authenticated;
