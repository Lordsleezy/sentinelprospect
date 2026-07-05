alter table signals
  alter column project_id drop not null;

alter table signals
  add column if not exists source_url text,
  add column if not exists external_id text,
  add column if not exists parcel_number text,
  add column if not exists jurisdiction text;

alter table signals
  drop constraint if exists signals_signal_type_check;

alter table signals
  add constraint signals_signal_type_check check (
    signal_type in (
      'Land Purchase',
      'Parcel Split',
      'Rezoning',
      'Planning Application',
      'CEQA',
      'Subdivision Filing',
      'Environmental Review',
      'Permit',
      'Groundbreaking',
      'Construction Start',
      'Utility Expansion',
      'Infrastructure Project'
    )
  );

create table if not exists evidence_records (
  id uuid primary key default gen_random_uuid(),
  record_type text not null check (record_type in ('project', 'permit', 'signal', 'document', 'company', 'source_record')),
  record_id text not null,
  source_name text not null,
  source_url text,
  title text not null,
  summary text not null,
  captured_at timestamptz not null default now(),
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists opportunities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  title text not null,
  trade text not null,
  horizon text not null check (horizon in ('Fast Money', 'Pipeline', 'Early Signals')),
  city text not null,
  county text not null,
  state text not null default 'CA',
  score integer not null check (score >= 0 and score <= 100),
  score_explanations jsonb not null default '[]'::jsonb,
  recommended_action text not null,
  estimated_start_months integer,
  estimated_completion_months integer,
  estimated_value numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(trade, '') || ' ' || coalesce(horizon, '') || ' ' || coalesce(city, '') || ' ' || coalesce(county, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(recommended_action, '')), 'C')
  ) stored
);

create table if not exists opportunity_evidence (
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  evidence_id uuid not null references evidence_records(id) on delete cascade,
  relevance_score integer not null default 50 check (relevance_score >= 0 and relevance_score <= 100),
  primary key (opportunity_id, evidence_id)
);

create index if not exists signals_external_idx on signals(external_id);
create index if not exists signals_parcel_idx on signals(parcel_number);
create index if not exists signals_jurisdiction_idx on signals(jurisdiction);
create index if not exists evidence_records_type_idx on evidence_records(record_type);
create index if not exists evidence_records_record_idx on evidence_records(record_id);
create index if not exists opportunities_project_idx on opportunities(project_id);
create index if not exists opportunities_horizon_idx on opportunities(horizon);
create index if not exists opportunities_trade_idx on opportunities(trade);
create index if not exists opportunities_score_idx on opportunities(score desc);
create index if not exists opportunities_search_idx on opportunities using gin(search_vector);

drop trigger if exists opportunities_set_updated_at on opportunities;
create trigger opportunities_set_updated_at
before update on opportunities
for each row execute function set_updated_at();
