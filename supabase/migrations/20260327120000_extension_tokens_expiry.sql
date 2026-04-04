-- Trial / annual license expiry for extension_tokens (product keys).
-- NULL expires_at = legacy keys with no expiry (unchanged behavior).

alter table public.extension_tokens
  add column if not exists license_type text
    check (license_type is null or license_type in ('trial', 'annual'));

alter table public.extension_tokens
  add column if not exists expires_at timestamptz;

comment on column public.extension_tokens.expires_at is 'After this time (UTC) the key is invalid. NULL = no expiry (legacy).';
comment on column public.extension_tokens.license_type is 'trial | annual — informational; enforcement uses expires_at.';

create index if not exists extension_tokens_expires_at_idx
  on public.extension_tokens (expires_at)
  where revoked_at is null and expires_at is not null;
