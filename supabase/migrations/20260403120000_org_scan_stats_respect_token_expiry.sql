-- active_seats: not revoked and not past expires_at (NULL expires_at = legacy unlimited)

create or replace view public.org_scan_stats as
select
  o.id as org_id,
  o.name as org_name,
  o.plan,
  o.seat_limit,
  count(distinct et.id) filter (
    where et.revoked_at is null
      and (et.expires_at is null or et.expires_at > now())
  ) as active_seats,
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
