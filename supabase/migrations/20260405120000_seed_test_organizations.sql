-- Sample rows for local / staging dashboards (admin-console org picker).
-- Safe to re-run: skips if slug already exists.

insert into public.organizations (name, slug, plan, seat_limit, trial_ends_at)
values
  ('Demo Organization', 'demo-local', 'trial', 5, now() + interval '30 days'),
  ('Test — Acme Corp', 'test-acme', 'starter', 10, now() + interval '14 days'),
  ('Test — Contoso Ltd', 'test-contoso', 'pro', 25, null)
on conflict (slug) do nothing;
