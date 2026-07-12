-- Stage 0: repair verification state created by the retired click-verification
-- flow and remove its misleading RPC owner.
--
-- The repair is intentionally limited to the two exact evidence labels written
-- by the old Stage 10 function. Before any UPDATE, the complete original rows
-- are copied into a server-only audit table so a reviewed forward migration can
-- restore them without guessing. Re-running this migration is safe: repaired
-- rows no longer match the evidence predicates, and audit inserts are deduped.

create table if not exists public.legacy_click_verification_repair_audit (
  subject_type text not null
    check (subject_type in ('product', 'alternative', 'search_cache')),
  subject_id uuid not null,
  old_values jsonb not null,
  captured_at timestamptz not null default now(),
  primary key (subject_type, subject_id)
);

comment on table public.legacy_click_verification_repair_audit is
  'Original rows captured before the one-time legacy click-verification repair.';

alter table public.legacy_click_verification_repair_audit enable row level security;
revoke all on table public.legacy_click_verification_repair_audit from public, anon, authenticated;
revoke all on table public.legacy_click_verification_repair_audit from service_role;
grant select on table public.legacy_click_verification_repair_audit to service_role;

-- Capture every legacy product row before changing any verification field.
insert into public.legacy_click_verification_repair_audit (
  subject_type,
  subject_id,
  old_values
)
select
  'product',
  p.id,
  jsonb_build_object(
    'verification_status', p.verification_status,
    'verified_at', p.verified_at,
    'verification_evidence', p.verification_evidence,
    'verified_by_search_id', p.verified_by_search_id
  )
from public.products p
where p.verification_evidence = 'user_product_click'
on conflict (subject_type, subject_id) do nothing;

-- Capture every legacy alternative row, including its acceptance state. The
-- repair below deliberately does not write accepted_match or accepted_at.
insert into public.legacy_click_verification_repair_audit (
  subject_type,
  subject_id,
  old_values
)
select
  'alternative',
  a.id,
  jsonb_build_object(
    'verification_status', a.verification_status,
    'verified_at', a.verified_at,
    'verification_evidence', a.verification_evidence
  )
from public.alternatives a
where a.verification_evidence = 'user_product_click'
on conflict (subject_type, subject_id) do nothing;

-- Capture every scan cache promoted by the retired alternative-click rule.
insert into public.legacy_click_verification_repair_audit (
  subject_type,
  subject_id,
  old_values
)
select
  'search_cache',
  s.id,
  jsonb_build_object(
    'cache_status', s.cache_status,
    'cache_verified_at', s.cache_verified_at,
    'cache_verification_evidence', s.cache_verification_evidence
  )
from public.searches s
where s.cache_verification_evidence = 'persisted_alternative_click'
on conflict (subject_type, subject_id) do nothing;

-- Only the exact legacy click evidence is demoted. Product authenticity and
-- all classification fields remain unchanged.
update public.products
set verification_status = 'unverified',
    verified_at = null,
    verification_evidence = null,
    verified_by_search_id = null
where verification_evidence = 'user_product_click';

-- Acceptance and click analytics remain intact; only legacy trust fields move
-- back to their neutral state.
update public.alternatives
set verification_status = 'unverified',
    verified_at = null,
    verification_evidence = null
where verification_evidence = 'user_product_click';

-- Exact-image cache entries promoted solely by clicks are no longer trusted.
-- Fingerprints, scan results, correction history, and hit analytics remain.
update public.searches
set cache_status = 'unverified',
    cache_verified_at = null,
    cache_verification_evidence = null
where cache_verification_evidence = 'persisted_alternative_click';

-- Application click handling now uses the existing interest-only alternative
-- PATCH owner. There are no remaining repository callers of this RPC.
drop function if exists public.verify_product_click(uuid, text, timestamptz);

-- Rollback policy: use a reviewed forward migration that restores verification
-- fields from old_values only when the current row still has the neutral values
-- written above. This prevents rollback from overwriting newer trusted evidence.
