create table if not exists contact_resolution_results (
  id text primary key,
  project_external_id text,
  project_name text not null,
  company_name text not null,
  project_role text not null check (
    project_role in (
      'Developer',
      'Property Owner',
      'Applicant',
      'General Contractor',
      'Architect',
      'Engineer'
    )
  ),
  resolved_website text,
  linkedin_url text,
  phone text,
  contact_page_url text,
  staff_directory_url text,
  contact_name text,
  contact_title text,
  contact_role text check (
    contact_role is null or contact_role in (
      'Owner',
      'President',
      'CEO',
      'Development Director',
      'Construction Director',
      'Project Executive',
      'Project Manager',
      'Procurement Contact',
      'Estimator'
    )
  ),
  source_url text not null,
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  last_verified timestamptz not null default now(),
  status text not null check (status in ('source_backed_company', 'source_backed_contact', 'not_found')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contact_confidence_score (
  id text primary key,
  contact_resolution_result_id text not null references contact_resolution_results(id) on delete cascade,
  score numeric not null check (score >= 0 and score <= 1),
  factors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists contact_source_evidence (
  id text primary key,
  contact_resolution_result_id text not null references contact_resolution_results(id) on delete cascade,
  evidence_type text not null check (
    evidence_type in (
      'source_record_company',
      'source_record_phone',
      'source_record_website',
      'source_record_contact_page',
      'source_record_staff_directory',
      'source_record_person',
      'public_profile_company',
      'public_profile_phone',
      'public_profile_website',
      'public_profile_contact_page',
      'public_profile_staff_directory',
      'public_profile_person'
    )
  ),
  source_name text not null,
  source_url text not null,
  excerpt text not null,
  captured_at timestamptz not null,
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now()
);

create index if not exists contact_resolution_company_idx on contact_resolution_results(company_name);
create index if not exists contact_resolution_project_idx on contact_resolution_results(project_external_id);
create index if not exists contact_resolution_role_idx on contact_resolution_results(project_role);
create index if not exists contact_resolution_status_idx on contact_resolution_results(status);
create index if not exists contact_confidence_result_idx on contact_confidence_score(contact_resolution_result_id);
create index if not exists contact_evidence_result_idx on contact_source_evidence(contact_resolution_result_id);

drop trigger if exists contact_resolution_results_set_updated_at on contact_resolution_results;
create trigger contact_resolution_results_set_updated_at
before update on contact_resolution_results
for each row execute function set_updated_at();
