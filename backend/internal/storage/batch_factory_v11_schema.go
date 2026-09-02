package storage

func V11FoundationStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_bridge_users (
  username VARCHAR(191) NOT NULL PRIMARY KEY,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_batches (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  KEY idx_bfv11_batches_owner (owner_username)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_books (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  owner_username VARCHAR(191) NOT NULL,
  ordinal INT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_bfv11_book_ordinal (batch_id, ordinal),
  KEY idx_bfv11_books_owner_batch (owner_username, batch_id)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_videos (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  book_id VARCHAR(64) NOT NULL,
  owner_username VARCHAR(191) NOT NULL,
  ordinal INT NOT NULL,
  compatibility_state VARCHAR(32) NOT NULL DEFAULT 'active',
  revision BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  KEY idx_bfv11_videos_owner_book (owner_username, book_id)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_migration_audits (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  migration_version BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  expected_checksum CHAR(64) NULL,
  recorded_checksum CHAR(64) NULL,
  detail TEXT NULL,
  created_at DATETIME(6) NOT NULL
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_capability_settings (
  capability_key VARCHAR(96) NOT NULL PRIMARY KEY,
  available BOOLEAN NOT NULL DEFAULT FALSE,
  reason VARCHAR(255) NULL,
  updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB`,
	}
}

func V11FoundationMigrations() []Migration {
	return []Migration{{Version: 1100001, SQL: V11FoundationStatements(), CallbackChecksum: "batch-factory-v11-foundation-v1"}}
}

func V11SliceOneStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_intakes (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  payload_json JSON NOT NULL,
  consumed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  KEY idx_bfv11_intakes_owner_created (owner_username, created_at)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_batch_records (
  batch_id VARCHAR(64) NOT NULL PRIMARY KEY,
  title VARCHAR(255) NOT NULL DEFAULT '',
  source_intake_id VARCHAR(64) NULL
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_book_records (
  book_id VARCHAR(64) NOT NULL PRIMARY KEY,
  title VARCHAR(255) NOT NULL DEFAULT '',
  source_text MEDIUMTEXT NULL
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_video_records (
  video_id VARCHAR(64) NOT NULL PRIMARY KEY,
  label VARCHAR(255) NOT NULL DEFAULT '',
  visual_prompt MEDIUMTEXT NULL,
  duration_seconds DECIMAL(10,3) NULL
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_settings_patches (
  scope_type VARCHAR(16) NOT NULL,
  scope_id VARCHAR(64) NOT NULL,
  owner_username VARCHAR(191) NOT NULL,
  batch_id VARCHAR(64) NOT NULL,
  book_id VARCHAR(64) NULL,
  video_id VARCHAR(64) NULL,
  patch_json JSON NOT NULL,
  revision BIGINT NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (scope_type, scope_id),
  KEY idx_bfv11_settings_owner_batch (owner_username, batch_id)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_config_versions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  config_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL
) ENGINE=InnoDB`,
		`INSERT IGNORE INTO batch_factory_v11_config_versions(id,name,config_json,created_at) VALUES ('system-default-v1','System Default',JSON_OBJECT('source','system'),CURRENT_TIMESTAMP(6))`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_config_snapshots (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  batch_id VARCHAR(64) NOT NULL,
  book_id VARCHAR(64) NULL,
  video_id VARCHAR(64) NULL,
  effective_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY idx_bfv11_snapshots_owner_batch (owner_username, batch_id, created_at)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_prompt_definitions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  name VARCHAR(255) NOT NULL,
  kind VARCHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY idx_bfv11_prompts_owner_kind (owner_username, kind)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_prompt_versions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  prompt_id VARCHAR(64) NOT NULL,
  owner_username VARCHAR(191) NOT NULL,
  revision BIGINT NOT NULL,
  content MEDIUMTEXT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_bfv11_prompt_revision (prompt_id, revision),
  KEY idx_bfv11_prompt_versions_owner (owner_username, prompt_id)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_drafts (
  owner_username VARCHAR(191) NOT NULL,
  draft_key VARCHAR(191) NOT NULL,
  kind VARCHAR(64) NOT NULL,
  scope VARCHAR(64) NOT NULL,
  content MEDIUMTEXT NULL,
  revision BIGINT NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (owner_username, draft_key, kind, scope)
) ENGINE=InnoDB`,
		`ALTER TABLE batch_factory_v11_books ADD CONSTRAINT fk_bfv11_books_batch FOREIGN KEY (batch_id) REFERENCES batch_factory_v11_batches(id) ON DELETE RESTRICT`,
		`ALTER TABLE batch_factory_v11_videos ADD CONSTRAINT fk_bfv11_videos_book FOREIGN KEY (book_id) REFERENCES batch_factory_v11_books(id) ON DELETE RESTRICT`,
		`ALTER TABLE batch_factory_v11_batch_records ADD CONSTRAINT fk_bfv11_batch_records_batch FOREIGN KEY (batch_id) REFERENCES batch_factory_v11_batches(id) ON DELETE RESTRICT`,
		`ALTER TABLE batch_factory_v11_book_records ADD CONSTRAINT fk_bfv11_book_records_book FOREIGN KEY (book_id) REFERENCES batch_factory_v11_books(id) ON DELETE RESTRICT`,
		`ALTER TABLE batch_factory_v11_video_records ADD CONSTRAINT fk_bfv11_video_records_video FOREIGN KEY (video_id) REFERENCES batch_factory_v11_videos(id) ON DELETE RESTRICT`,
		`ALTER TABLE batch_factory_v11_config_snapshots ADD CONSTRAINT fk_bfv11_snapshots_batch FOREIGN KEY (batch_id) REFERENCES batch_factory_v11_batches(id) ON DELETE RESTRICT`,
		`ALTER TABLE batch_factory_v11_prompt_versions ADD CONSTRAINT fk_bfv11_prompt_versions_prompt FOREIGN KEY (prompt_id) REFERENCES batch_factory_v11_prompt_definitions(id) ON DELETE RESTRICT`,
	}
}

func V11ConfigVersionOwnershipStatements() []string {
	return []string{
		`ALTER TABLE batch_factory_v11_config_versions
  ADD COLUMN owner_username VARCHAR(191) NULL AFTER id,
  ADD KEY idx_bfv11_config_versions_owner_created (owner_username, created_at, id)`,
	}
}

func V11DirectorStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_hook_revisions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  book_id VARCHAR(64) NOT NULL,
  owner_username VARCHAR(191) NOT NULL,
  revision BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  hook_text MEDIUMTEXT NOT NULL,
  source_digest CHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  approved_at DATETIME(6) NULL,
  UNIQUE KEY uq_bfv11_hook_book_revision (book_id, revision),
  KEY idx_bfv11_hook_owner_book (owner_username, batch_id, book_id)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_director_revisions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  book_id VARCHAR(64) NOT NULL,
  owner_username VARCHAR(191) NOT NULL,
  revision BIGINT NOT NULL,
  snapshot_id VARCHAR(64) NOT NULL,
  mode VARCHAR(32) NOT NULL,
  source_digest CHAR(64) NOT NULL,
  hook_revision_id VARCHAR(64) NULL,
  output_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_bfv11_director_book_revision (book_id, revision),
  KEY idx_bfv11_director_owner_book (owner_username, batch_id, book_id)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_director_video_links (
  director_revision_id VARCHAR(64) NOT NULL,
  video_id VARCHAR(64) NOT NULL,
  ordinal INT NOT NULL,
  PRIMARY KEY (director_revision_id, video_id),
  UNIQUE KEY uq_bfv11_director_video_ordinal (director_revision_id, ordinal)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_orphaned_overrides (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  director_revision_id VARCHAR(64) NOT NULL,
  video_id VARCHAR(64) NOT NULL,
  patch_json JSON NOT NULL,
  state VARCHAR(32) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY idx_bfv11_orphan_director (director_revision_id)
) ENGINE=InnoDB`,
		`ALTER TABLE batch_factory_v11_hook_revisions ADD CONSTRAINT fk_bfv11_hook_book FOREIGN KEY (book_id) REFERENCES batch_factory_v11_books(id) ON DELETE RESTRICT`,
		`ALTER TABLE batch_factory_v11_director_revisions ADD CONSTRAINT fk_bfv11_director_book FOREIGN KEY (book_id) REFERENCES batch_factory_v11_books(id) ON DELETE RESTRICT`,
		`ALTER TABLE batch_factory_v11_director_revisions ADD CONSTRAINT fk_bfv11_director_snapshot FOREIGN KEY (snapshot_id) REFERENCES batch_factory_v11_config_snapshots(id) ON DELETE RESTRICT`,
		`ALTER TABLE batch_factory_v11_director_video_links ADD CONSTRAINT fk_bfv11_director_link_revision FOREIGN KEY (director_revision_id) REFERENCES batch_factory_v11_director_revisions(id) ON DELETE RESTRICT`,
		`ALTER TABLE batch_factory_v11_director_video_links ADD CONSTRAINT fk_bfv11_director_link_video FOREIGN KEY (video_id) REFERENCES batch_factory_v11_videos(id) ON DELETE RESTRICT`,
		`ALTER TABLE batch_factory_v11_orphaned_overrides ADD CONSTRAINT fk_bfv11_orphan_revision FOREIGN KEY (director_revision_id) REFERENCES batch_factory_v11_director_revisions(id) ON DELETE RESTRICT`,
	}
}

// V11ProductionStatements is deliberately append-only.  A production request
// must survive a process restart before any external video provider is called,
// so the job, every VIDEO task and the state-transition audit trail live in
// separate durable tables.
func V11ProductionStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_production_jobs (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  batch_id VARCHAR(64) NOT NULL,
  book_id VARCHAR(64) NOT NULL,
  request_id VARCHAR(128) NOT NULL,
  director_revision_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_bfv11_production_request (owner_username, batch_id, book_id, request_id),
  KEY idx_bfv11_production_jobs_owner_batch_created (owner_username, batch_id, created_at),
  CONSTRAINT fk_bfv11_production_job_batch FOREIGN KEY (batch_id) REFERENCES batch_factory_v11_batches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bfv11_production_job_book FOREIGN KEY (book_id) REFERENCES batch_factory_v11_books(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bfv11_production_job_director FOREIGN KEY (director_revision_id) REFERENCES batch_factory_v11_director_revisions(id) ON DELETE RESTRICT
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_production_tasks (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  job_id VARCHAR(64) NOT NULL,
  owner_username VARCHAR(191) NOT NULL,
  video_id VARCHAR(64) NOT NULL,
  attempt INT NOT NULL,
  final_prompt_hash CHAR(64) NOT NULL,
  compiled_prompt MEDIUMTEXT NOT NULL,
  provider_task_id VARCHAR(255) NULL,
  media_url MEDIUMTEXT NULL,
  status VARCHAR(32) NOT NULL,
  error_message VARCHAR(255) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_bfv11_production_task_attempt (job_id, video_id, attempt),
  KEY idx_bfv11_production_tasks_owner_status (owner_username, status, updated_at),
  CONSTRAINT fk_bfv11_production_task_job FOREIGN KEY (job_id) REFERENCES batch_factory_v11_production_jobs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bfv11_production_task_video FOREIGN KEY (video_id) REFERENCES batch_factory_v11_videos(id) ON DELETE RESTRICT
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_production_events (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(64) NOT NULL,
  task_id VARCHAR(64) NULL,
  owner_username VARCHAR(191) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  from_state VARCHAR(32) NULL,
  to_state VARCHAR(32) NULL,
  message VARCHAR(255) NULL,
  created_at DATETIME(6) NOT NULL,
  KEY idx_bfv11_production_events_job_created (job_id, created_at, id),
  CONSTRAINT fk_bfv11_production_event_job FOREIGN KEY (job_id) REFERENCES batch_factory_v11_production_jobs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bfv11_production_event_task FOREIGN KEY (task_id) REFERENCES batch_factory_v11_production_tasks(id) ON DELETE RESTRICT
) ENGINE=InnoDB`,
	}
}

// V11MergeStatements persists the merge request and its exact ordered inputs.
// Keeping sources separate makes retries idempotent while retaining the media
// list that was actually handed to the merge provider.
func V11MergeStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_merge_jobs (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  batch_id VARCHAR(64) NOT NULL,
  request_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  output_url MEDIUMTEXT NULL,
  error_message VARCHAR(255) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_bfv11_merge_request (owner_username, batch_id, request_id),
  KEY idx_bfv11_merge_jobs_owner_batch_created (owner_username, batch_id, created_at),
  FOREIGN KEY (batch_id) REFERENCES batch_factory_v11_batches(id) ON DELETE RESTRICT
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_merge_sources (
  job_id VARCHAR(64) NOT NULL,
  owner_username VARCHAR(191) NOT NULL,
  video_id VARCHAR(64) NOT NULL,
  ordinal INT NOT NULL,
  media_url MEDIUMTEXT NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (job_id, video_id),
  UNIQUE KEY uq_bfv11_merge_source_ordinal (job_id, ordinal),
  KEY idx_bfv11_merge_sources_owner_job (owner_username, job_id),
  FOREIGN KEY (job_id) REFERENCES batch_factory_v11_merge_jobs(id) ON DELETE RESTRICT
) ENGINE=InnoDB`,
	}
}

func V11MergePollerStatements() []string {
	return []string{
		`ALTER TABLE batch_factory_v11_merge_jobs ADD COLUMN IF NOT EXISTS provider_task_id VARCHAR(255) NULL AFTER request_id`,
	}
}

// V11ExternalStatements stores only encrypted provider credentials, immutable
// submission intents, and bounded redacted audit rows. No provider secret is
// represented in a JSON response or in cleartext columns.
func V11ExternalStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_external_credentials (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  provider VARCHAR(16) NOT NULL,
  credential_name VARCHAR(191) NOT NULL,
  key_id VARCHAR(32) NOT NULL,
  nonce VARBINARY(32) NOT NULL,
  ciphertext BLOB NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_bfv11_external_credential_owner_provider (owner_username, provider),
  KEY idx_bfv11_external_credential_owner (owner_username)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_external_intents (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  provider VARCHAR(16) NOT NULL,
  batch_id VARCHAR(64) NOT NULL,
  book_id VARCHAR(64) NULL,
  payload_digest CHAR(64) NOT NULL,
  payload_json JSON NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  confirmed_at DATETIME(6) NULL,
  submitted_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  KEY idx_bfv11_external_intent_owner (owner_username, created_at),
  KEY idx_bfv11_external_intent_owner_provider (owner_username, provider, created_at),
  FOREIGN KEY (batch_id) REFERENCES batch_factory_v11_batches(id) ON DELETE RESTRICT
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_external_audits (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  provider VARCHAR(16) NOT NULL,
  intent_id VARCHAR(64) NOT NULL,
  action VARCHAR(32) NOT NULL,
  outcome VARCHAR(32) NOT NULL,
  reference_value VARCHAR(255) NULL,
  message VARCHAR(255) NULL,
  created_at DATETIME(6) NOT NULL,
  KEY idx_bfv11_external_audit_owner_created (owner_username, created_at),
  KEY idx_bfv11_external_audit_intent (intent_id),
  FOREIGN KEY (intent_id) REFERENCES batch_factory_v11_external_intents(id) ON DELETE RESTRICT
) ENGINE=InnoDB`,
	}
}

func V11Migrations() []Migration {
	return []Migration{
		{Version: 1100001, SQL: V11FoundationStatements(), CallbackChecksum: "batch-factory-v11-foundation-v1"},
		{Version: 1100002, SQL: V11SliceOneStatements(), CallbackChecksum: "batch-factory-v11-slice1-v1"},
		{Version: 1100003, SQL: V11ConfigVersionOwnershipStatements(), CallbackChecksum: "batch-factory-v11-slice1-config-version-ownership-v1"},
		{Version: 1100004, SQL: V11DirectorStatements(), CallbackChecksum: "batch-factory-v11-director-v1"},
		{Version: 1100005, SQL: V11ProductionStatements(), CallbackChecksum: "batch-factory-v11-production-v1"},
		{Version: 1100006, SQL: V11MergeStatements(), CallbackChecksum: "batch-factory-v11-merge-v1"},
		{Version: 1100007, SQL: V11MergePollerStatements(), CallbackChecksum: "batch-factory-v11-merge-poller-v1"},
		{Version: 1100008, SQL: V11ExternalStatements(), CallbackChecksum: "batch-factory-v11-external-publish-v1"},
	}
}
