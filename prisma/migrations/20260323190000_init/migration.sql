CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE batch_status AS ENUM (
  'draft',
  'collecting_reference',
  'analyzing',
  'generating_scripts',
  'scripts_ready',
  'generating_storyboards',
  'completed',
  'partial_success',
  'failed',
  'archived'
);

CREATE TYPE source_platform AS ENUM (
  'tiktok'
);

CREATE TYPE task_status AS ENUM (
  'draft',
  'queued',
  'running',
  'succeeded',
  'failed',
  'partial_success'
);

CREATE TYPE task_type AS ENUM (
  'reference_video_sync',
  'media_prep',
  'video_analysis',
  'reference_synthesis',
  'script_generation',
  'storyboard_decomposition',
  'storyboard_image_generation',
  'compliance_check',
  'export_package'
);

CREATE TYPE asset_type AS ENUM (
  'video',
  'image',
  'document',
  'archive',
  'json'
);

CREATE TYPE asset_role AS ENUM (
  'reference_video_cover',
  'reference_video_downloaded',
  'media_prep_input',
  'media_prep_proxy',
  'product_white_bg',
  'human_reference',
  'pet_reference',
  'storyboard_grid',
  'export_zip',
  'script_export_doc',
  'storyboard_json_export'
);

CREATE TYPE script_style_base AS ENUM (
  'stable_conversion',
  'strong_hook',
  'atmosphere_seeding'
);

CREATE TYPE compliance_target_type AS ENUM (
  'batch',
  'script_variant',
  'storyboard_variant'
);

CREATE TYPE risk_level AS ENUM (
  'low',
  'medium',
  'high',
  'critical'
);

CREATE TABLE batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  description TEXT,
  status batch_status NOT NULL DEFAULT 'draft',
  reference_video_limit SMALLINT NOT NULL DEFAULT 1 CHECK (reference_video_limit = 1),
  script_target_count SMALLINT NOT NULL DEFAULT 10 CHECK (script_target_count BETWEEN 1 AND 50),
  progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  script_generated_count INTEGER NOT NULL DEFAULT 0 CHECK (script_generated_count >= 0),
  storyboard_generated_count INTEGER NOT NULL DEFAULT 0 CHECK (storyboard_generated_count >= 0),
  failed_task_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_task_count >= 0),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE reference_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform source_platform NOT NULL DEFAULT 'tiktok',
  source_provider VARCHAR(32) NOT NULL DEFAULT 'fastmoss',
  external_video_id VARCHAR(128) NOT NULL,
  author_external_id VARCHAR(128),
  author_name VARCHAR(255),
  author_handle VARCHAR(255),
  title TEXT,
  description TEXT,
  video_url TEXT,
  cover_url TEXT,
  duration_seconds NUMERIC(8,2),
  published_at TIMESTAMPTZ,
  play_count BIGINT,
  like_count BIGINT,
  comment_count BIGINT,
  share_count BIGINT,
  engagement_rate NUMERIC(10,4),
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, external_video_id)
);

CREATE TABLE batch_reference_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id),
  reference_video_id UUID NOT NULL REFERENCES reference_videos(id),
  is_selected BOOLEAN NOT NULL DEFAULT FALSE,
  selection_rank INTEGER,
  selected_at TIMESTAMPTZ,
  query_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, reference_video_id)
);

CREATE UNIQUE INDEX uq_batch_single_selected_reference
  ON batch_reference_videos(batch_id)
  WHERE is_selected = TRUE;

CREATE TABLE product_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id),
  brand_name VARCHAR(120),
  product_name VARCHAR(200) NOT NULL,
  product_category VARCHAR(120),
  target_species VARCHAR(64),
  product_summary TEXT,
  selling_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_claims JSONB NOT NULL DEFAULT '[]'::jsonb,
  forbidden_claims JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_selling_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  usage_scenarios JSONB NOT NULL DEFAULT '[]'::jsonb,
  tone_constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id)
);

CREATE TABLE reference_synthesis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id),
  status task_status NOT NULL DEFAULT 'draft',
  source_video_count SMALLINT NOT NULL DEFAULT 1 CHECK (source_video_count >= 1),
  synthesis_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  traceability_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id)
);

CREATE TABLE script_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id),
  product_profile_id UUID NOT NULL REFERENCES product_profiles(id),
  reference_synthesis_result_id UUID REFERENCES reference_synthesis_results(id),
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  style_base script_style_base NOT NULL,
  title VARCHAR(255),
  script_text TEXT NOT NULL,
  script_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  generation_tags TEXT[] NOT NULL DEFAULT '{}',
  source_trace JSONB NOT NULL DEFAULT '{}'::jsonb,
  origin_type VARCHAR(32) NOT NULL DEFAULT 'generated',
  is_selected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, sequence_no)
);

CREATE TABLE storyboard_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id),
  script_variant_id UUID NOT NULL REFERENCES script_variants(id),
  variant_no SMALLINT NOT NULL DEFAULT 1 CHECK (variant_no BETWEEN 1 AND 3),
  status task_status NOT NULL DEFAULT 'draft',
  system_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_script_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_user_edited BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at TIMESTAMPTZ,
  default_restored_at TIMESTAMPTZ,
  image_generation_count SMALLINT NOT NULL DEFAULT 0 CHECK (image_generation_count BETWEEN 0 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (script_variant_id, variant_no)
);

CREATE TABLE generation_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id),
  parent_task_id UUID REFERENCES generation_tasks(id),
  task_type task_type NOT NULL,
  status task_status NOT NULL DEFAULT 'draft',
  priority SMALLINT NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 999),
  target_type VARCHAR(64),
  target_id UUID,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(64),
  error_message TEXT,
  retry_count SMALLINT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries SMALLINT NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
  queued_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE media_prep_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_reference_video_id UUID NOT NULL REFERENCES batch_reference_videos(id),
  reference_video_id UUID NOT NULL REFERENCES reference_videos(id),
  status task_status NOT NULL DEFAULT 'draft',
  download_strategy VARCHAR(32) NOT NULL DEFAULT 'primary',
  prepared_spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  diagnostic_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_reference_video_id)
);

CREATE TABLE video_analysis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_reference_video_id UUID NOT NULL REFERENCES batch_reference_videos(id),
  reference_video_id UUID NOT NULL REFERENCES reference_videos(id),
  status task_status NOT NULL DEFAULT 'draft',
  analyzer_vendor VARCHAR(64) NOT NULL DEFAULT 'google',
  analyzer_model VARCHAR(128) NOT NULL DEFAULT 'gemini',
  confidence_score NUMERIC(5,2),
  normalized_tags TEXT[] NOT NULL DEFAULT '{}',
  summary_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  analysis_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_reference_video_id)
);

CREATE TABLE compliance_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id),
  source_task_id UUID REFERENCES generation_tasks(id),
  target_type compliance_target_type NOT NULL,
  target_id UUID NOT NULL,
  status task_status NOT NULL DEFAULT 'draft',
  checker_vendor VARCHAR(64) NOT NULL DEFAULT 'internal',
  checker_version VARCHAR(64),
  risk_level risk_level NOT NULL DEFAULT 'low',
  issue_count INTEGER NOT NULL DEFAULT 0 CHECK (issue_count >= 0),
  issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggestion_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE export_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id),
  source_task_id UUID REFERENCES generation_tasks(id),
  status task_status NOT NULL DEFAULT 'draft',
  file_name VARCHAR(255),
  export_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  included_script_count INTEGER NOT NULL DEFAULT 0 CHECK (included_script_count >= 0),
  included_storyboard_count INTEGER NOT NULL DEFAULT 0 CHECK (included_storyboard_count >= 0),
  included_json_count INTEGER NOT NULL DEFAULT 0 CHECK (included_json_count >= 0),
  download_expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id),
  reference_video_id UUID REFERENCES reference_videos(id),
  batch_reference_video_id UUID REFERENCES batch_reference_videos(id),
  product_profile_id UUID REFERENCES product_profiles(id),
  script_variant_id UUID REFERENCES script_variants(id),
  storyboard_variant_id UUID REFERENCES storyboard_variants(id),
  export_package_id UUID REFERENCES export_packages(id),
  asset_type asset_type NOT NULL,
  asset_role asset_role NOT NULL,
  source_provider VARCHAR(64) NOT NULL DEFAULT 'system',
  storage_provider VARCHAR(32) NOT NULL DEFAULT 's3',
  bucket_name VARCHAR(128),
  storage_key VARCHAR(512),
  file_name VARCHAR(255),
  mime_type VARCHAR(128),
  file_size_bytes BIGINT,
  checksum_sha256 VARCHAR(64),
  width INTEGER,
  height INTEGER,
  duration_seconds NUMERIC(8,2),
  external_url TEXT,
  local_path TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_product_single_white_bg_asset
  ON assets(product_profile_id, asset_role)
  WHERE asset_role = 'product_white_bg';

CREATE INDEX idx_reference_videos_published_at
  ON reference_videos(platform, published_at DESC);

CREATE INDEX idx_batch_reference_videos_selected
  ON batch_reference_videos(batch_id, is_selected, selected_at DESC);

CREATE INDEX idx_script_variants_selected
  ON script_variants(batch_id, is_selected, created_at DESC);

CREATE INDEX idx_storyboard_variants_script
  ON storyboard_variants(script_variant_id, created_at DESC);

CREATE INDEX idx_generation_tasks_queue
  ON generation_tasks(status, task_type, priority, queued_at);

CREATE INDEX idx_generation_tasks_target
  ON generation_tasks(target_type, target_id, created_at DESC);

CREATE INDEX idx_media_prep_results_status
  ON media_prep_results(status, created_at DESC);

CREATE INDEX idx_video_analysis_results_tags
  ON video_analysis_results USING GIN (normalized_tags);

CREATE INDEX idx_script_variants_tags
  ON script_variants USING GIN (generation_tags);

CREATE INDEX idx_compliance_checks_target
  ON compliance_checks(target_type, target_id, created_at DESC);

CREATE INDEX idx_assets_batch_role
  ON assets(batch_id, asset_role, created_at DESC);
