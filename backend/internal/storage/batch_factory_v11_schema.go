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

func V11Migrations() []Migration {
	return []Migration{
		{Version: 1100001, SQL: V11FoundationStatements(), CallbackChecksum: "batch-factory-v11-foundation-v1"},
		{Version: 1100002, SQL: V11SliceOneStatements(), CallbackChecksum: "batch-factory-v11-slice1-v1"},
	}
}
