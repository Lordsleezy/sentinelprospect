create table if not exists developer_profiles (
  id text primary key,
  company_profile_id text not null references company_profiles(id) on delete cascade,
  company_name text not null,
  project_count integer not null default 0,
  project_types jsonb not null default '[]'::jsonb,
  cities jsonb not null default '[]'::jsonb,
  counties jsonb not null default '[]'::jsonb,
  known_trades jsonb not null default '[]'::jsonb,
  procurement_path_count integer not null default 0,
  opportunity_likelihood numeric not null default 0 check (opportunity_likelihood >= 0 and opportunity_likelihood <= 1),
  last_verified timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists gc_profiles (
  id text primary key,
  company_profile_id text not null references company_profiles(id) on delete cascade,
  company_name text not null,
  project_count integer not null default 0,
  project_types jsonb not null default '[]'::jsonb,
  cities jsonb not null default '[]'::jsonb,
  counties jsonb not null default '[]'::jsonb,
  known_trades jsonb not null default '[]'::jsonb,
  procurement_path_count integer not null default 0,
  opportunity_likelihood numeric not null default 0 check (opportunity_likelihood >= 0 and opportunity_likelihood <= 1),
  outsourcing_by_trade jsonb not null default '{}'::jsonb,
  last_verified timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists company_behavior (
  id text primary key,
  company_profile_id text not null references company_profiles(id) on delete cascade,
  company_name text not null,
  company_type text not null,
  project_count integer not null default 0,
  project_types jsonb not null default '[]'::jsonb,
  cities jsonb not null default '[]'::jsonb,
  counties jsonb not null default '[]'::jsonb,
  known_trades jsonb not null default '[]'::jsonb,
  procurement_paths jsonb not null default '[]'::jsonb,
  outsourcing_by_trade jsonb not null default '{}'::jsonb,
  opportunity_likelihood numeric not null default 0 check (opportunity_likelihood >= 0 and opportunity_likelihood <= 1),
  evidence_count integer not null default 0,
  last_verified timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists historical_relationships (
  id text primary key,
  from_company_profile_id text not null references company_profiles(id) on delete cascade,
  to_company_profile_id text not null references company_profiles(id) on delete cascade,
  relationship_type text not null check (
    relationship_type in (
      'developer_gc',
      'developer_architect',
      'developer_engineer',
      'developer_trade_contractor',
      'gc_trade_contractor',
      'company_project_cooccurrence'
    )
  ),
  project_count integer not null default 0,
  projects jsonb not null default '[]'::jsonb,
  trades jsonb not null default '[]'::jsonb,
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  last_verified timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists developer_profiles_company_idx on developer_profiles(company_profile_id);
create index if not exists gc_profiles_company_idx on gc_profiles(company_profile_id);
create index if not exists company_behavior_company_idx on company_behavior(company_profile_id);
create index if not exists company_behavior_type_idx on company_behavior(company_type);
create index if not exists historical_relationships_from_idx on historical_relationships(from_company_profile_id);
create index if not exists historical_relationships_to_idx on historical_relationships(to_company_profile_id);
create index if not exists historical_relationships_type_idx on historical_relationships(relationship_type);
