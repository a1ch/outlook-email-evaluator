-- Organizations: one row per paying customer (runs after extension_tokens base table)
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'trial' check (plan in ('trial','starter','pro','enterprise')),
  seat_limit int not null default 5,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.organizations enable row level security;
revoke all on public.organizations from anon, authenticated;
grant select, insert, update on public.organizations to service_role;

-- Link tokens to orgs + store user email
alter table public.extension_tokens
  add column if not exists org_id uuid references public.organizations(id) on delete cascade,
  add column if not exists user_email text;

-- Per-org stats view
create or replace view public.org_scan_stats as
select
  o.id as org_id,
  o.name as org_name,
  o.plan,
  o.seat_limit,
  count(distinct et.id) filter (where et.revoked_at is null) as active_seats,
  count(sl.id) as total_scans,
  count(sl.id) filter (where sl.created_at > now() - interval '30 days') as scans_30d,
  count(sl.id) filter (where sl.verdict = 'PHISHING' and sl.created_at > now() - interval '30 days') as phishing_30d,
  count(sl.id) filter (where sl.verdict = 'SUSPICIOUS' and sl.created_at > now() - interval '30 days') as suspicious_30d,
  count(sl.id) filter (where sl.verdict = 'SPAM' and sl.created_at > now() - interval '30 days') as spam_30d,
  count(sl.id) filter (where sl.verdict = 'SAFE' and sl.created_at > now() - interval '30 days') as safe_30d
from public.organizations o
left join public.extension_tokens et on et.org_id = o.id
left join public.scan_log sl on sl.token_key = et.token_hash
group by o.id, o.name, o.plan, o.seat_limit;
