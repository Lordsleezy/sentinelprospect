create table if not exists company_profiles (
  id text primary key,
  company_name text not null,
  normalized_name text not null unique,
  company_type text not null check (
    company_type in (
      'Developer',
      'General Contractor',
      'Architect',
      'Engineer',
      'Property Owner',
      'Unknown'
    )
  ),
  official_website text,
  phone text,
  linkedin_company_page text,
  contact_page_url text,
  bid_opportunities_page_url text,
  vendor_registration_page_url text,
  subcontractor_registration_page_url text,
  trade_partner_portal_url text,
  source_count integer not null default 0,
  profile_confidence numeric not null default 0 check (profile_confidence >= 0 and profile_confidence <= 1),
  last_verified timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists company_web_sources (
  id text primary key,
  company_profile_id text not null references company_profiles(id) on delete cascade,
  source_type text not null check (
    source_type in (
      'collector_record',
      'official_website',
      'phone_source',
      'linkedin_company_page',
      'contact_page',
      'bid_opportunities_page',
      'vendor_registration_page',
      'subcontractor_registration_page',
      'trade_partner_portal',
      'plan_room',
      'procurement_portal',
      'estimating_department',
      'procurement_path',
      'public_profile'
    )
  ),
  source_name text not null,
  source_url text not null,
  field_name text not null,
  field_value text not null,
  excerpt text not null,
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists company_intelligence (
  id text primary key,
  company_profile_id text not null references company_profiles(id) on delete cascade,
  intelligence_type text not null check (
    intelligence_type in (
      'coverage_summary',
      'company_type_evidence',
      'web_presence',
      'vendor_access',
      'subcontractor_access',
      'procurement_access',
      'missing_fields'
    )
  ),
  summary text not null,
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  evidence_source_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists company_profiles_type_idx on company_profiles(company_type);
create index if not exists company_profiles_name_idx on company_profiles(normalized_name);
create index if not exists company_web_sources_profile_idx on company_web_sources(company_profile_id);
create index if not exists company_web_sources_type_idx on company_web_sources(source_type);
create index if not exists company_intelligence_profile_idx on company_intelligence(company_profile_id);
create index if not exists company_intelligence_type_idx on company_intelligence(intelligence_type);

drop trigger if exists company_profiles_set_updated_at on company_profiles;
create trigger company_profiles_set_updated_at
before update on company_profiles
for each row execute function set_updated_at();
