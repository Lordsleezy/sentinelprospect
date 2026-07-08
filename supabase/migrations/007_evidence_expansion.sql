create table if not exists evidence_documents (
  id text primary key,
  title text not null,
  source_type text not null check (
    source_type in (
      'planning_application',
      'planning_commission_agenda',
      'city_council_agenda',
      'board_agenda',
      'environmental_document',
      'staff_report',
      'project_pdf',
      'developer_announcement',
      'construction_news',
      'public_bid_system',
      'award_notice',
      'meeting_minutes',
      'project_website'
    )
  ),
  source_name text not null,
  source_url text not null,
  project_name text,
  location text,
  summary text,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists document_extractions (
  id text primary key,
  evidence_document_id text not null references evidence_documents(id) on delete cascade,
  extraction_type text not null check (
    extraction_type in (
      'developer',
      'general_contractor',
      'architect',
      'engineer',
      'project_manager',
      'construction_manager',
      'property_owner',
      'trade_reference',
      'known_contractor',
      'known_relationship',
      'award_information'
    )
  ),
  entity_name text not null,
  entity_role text not null,
  source_url text not null,
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  last_verified timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists relationship_evidence (
  id text primary key,
  evidence_document_id text not null references evidence_documents(id) on delete cascade,
  from_company text not null,
  to_company text not null,
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
  project_name text,
  source_url text not null,
  evidence_summary text not null,
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  last_verified timestamptz not null default now()
);

create index if not exists evidence_documents_source_type_idx on evidence_documents(source_type);
create index if not exists evidence_documents_project_idx on evidence_documents(project_name);
create index if not exists document_extractions_document_idx on document_extractions(evidence_document_id);
create index if not exists document_extractions_type_idx on document_extractions(extraction_type);
create index if not exists relationship_evidence_document_idx on relationship_evidence(evidence_document_id);
create index if not exists relationship_evidence_type_idx on relationship_evidence(relationship_type);
