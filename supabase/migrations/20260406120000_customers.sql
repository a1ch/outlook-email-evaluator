-- Customers: one row per signup / licensed contact; product keys reference this row.

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  company_name text not null,
  full_name text,
  status text not null default 'active' check (status in ('active', 'churned', 'paused')),
  signup_source text not null default 'streamlit',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_org_email_unique unique (org_id, email)
);

comment on table public.customers is 'People or teams who signed up; each product key can reference one customer.';
comment on column public.customers.signup_source is 'e.g. streamlit, admin_console, import';

create index if not exists customers_org_id_idx on public.customers (org_id);
create index if not exists customers_email_idx on public.customers (lower(email));
create index if not exists customers_created_at_idx on public.customers (created_at desc);

alter table public.customers enable row level security;
revoke all on public.customers from anon, authenticated;
grant select, insert, update, delete on public.customers to service_role;

-- Link product keys back to the customer who received them (nullable for legacy rows).
alter table public.extension_tokens
  add column if not exists customer_id uuid references public.customers(id) on delete set null;

create index if not exists extension_tokens_customer_id_idx
  on public.extension_tokens (customer_id)
  where customer_id is not null;
