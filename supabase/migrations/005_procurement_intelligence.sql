alter table company_profiles
  add column if not exists plan_room_url text,
  add column if not exists procurement_portal_url text,
  add column if not exists estimating_department text,
  add column if not exists estimating_department_url text;

create table if not exists company_procurement_paths (
  id text primary key,
  company_profile_id text not null references company_profiles(id) on delete cascade,
  path_type text not null check (
    path_type in (
      'vendor_registration',
      'subcontractor_registration',
      'trade_partner',
      'estimating_contact',
      'bid_portal',
      'public_procurement',
      'plan_room',
      'general_contact'
    )
  ),
  path_url text not null,
  source_url text not null,
  source_type text not null,
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  contractor_value text not null check (contractor_value in ('High', 'Medium', 'Low')),
  last_verified timestamptz not null default now(),
  evidence_summary text not null,
  created_at timestamptz not null default now()
);

create table if not exists company_registration_portals (
  id text primary key,
  company_profile_id text not null references company_profiles(id) on delete cascade,
  registration_type text not null check (
    registration_type in (
      'vendor_registration',
      'subcontractor_registration',
      'trade_partner'
    )
  ),
  registration_url text not null,
  source_url text not null,
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  last_verified timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists company_bid_opportunities (
  id text primary key,
  company_profile_id text not null references company_profiles(id) on delete cascade,
  opportunity_type text not null check (opportunity_type in ('bid_portal', 'public_procurement', 'plan_room')),
  opportunity_url text not null,
  source_url text not null,
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  last_verified timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists company_procurement_paths_profile_idx on company_procurement_paths(company_profile_id);
create index if not exists company_procurement_paths_type_idx on company_procurement_paths(path_type);
create index if not exists company_registration_portals_profile_idx on company_registration_portals(company_profile_id);
create index if not exists company_registration_portals_type_idx on company_registration_portals(registration_type);
create index if not exists company_bid_opportunities_profile_idx on company_bid_opportunities(company_profile_id);
create index if not exists company_bid_opportunities_type_idx on company_bid_opportunities(opportunity_type);
