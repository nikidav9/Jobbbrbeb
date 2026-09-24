-- Separate consent for an employer's own legal terms.
--
-- Enabling Jupiter/live submission is authorization to apply, but it is not
-- acceptance of a third party's privacy/processing terms. Store that consent
-- on the concrete application row so it cannot leak to another employer or a
-- later vacancy.
alter table public.jm_jupiter_applications
  add column if not exists third_party_consent_at timestamptz,
  add column if not exists third_party_terms_url text;

comment on column public.jm_jupiter_applications.third_party_consent_at is
  'Explicit user consent for the employer terms attached to this application.';
comment on column public.jm_jupiter_applications.third_party_terms_url is
  'Terms URL shown to the user when third_party_consent_at was recorded.';
