package storage

func GiantMaterialExecutorStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS giant_executor_pairings (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  code_hash BINARY(32) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  consumed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_giant_executor_pairings_code_hash (code_hash),
  KEY idx_giant_executor_pairings_owner_created (owner_username, created_at)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS giant_executors (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  token_hash BINARY(32) NOT NULL,
  device_name VARCHAR(191) NOT NULL DEFAULT '',
  os VARCHAR(32) NOT NULL DEFAULT '',
  app_version VARCHAR(64) NOT NULL DEFAULT '',
  last_seen_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_giant_executors_token_hash (token_hash),
  KEY idx_giant_executors_owner_updated (owner_username, updated_at)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS giant_executor_jobs (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  material_id VARCHAR(191) NOT NULL,
  platform_book_id VARCHAR(191) NOT NULL,
  title VARCHAR(191) NOT NULL,
  video_url VARCHAR(512) NOT NULL,
  video_expires_at DATETIME(6) NULL,
  duration_seconds DOUBLE NOT NULL DEFAULT 0,
  model_version VARCHAR(64) NOT NULL,
  content_range_lines VARCHAR(64) NOT NULL DEFAULT '',
  state VARCHAR(32) NOT NULL,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  progress_completed INT NOT NULL DEFAULT 0,
  progress_total INT NOT NULL DEFAULT 0,
  progress_percent INT NOT NULL DEFAULT 0,
  lease_executor_id VARCHAR(64) NULL,
  lease_token_hash BINARY(32) NULL,
  lease_generation BIGINT NOT NULL DEFAULT 0,
  lease_expires_at DATETIME(6) NULL,
  error_code VARCHAR(96) NULL,
  error_message VARCHAR(512) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_giant_executor_job_key (owner_username, material_id, platform_book_id, model_version),
  KEY idx_giant_executor_jobs_claim (owner_username, platform, state, cancel_requested, lease_expires_at, created_at),
  KEY idx_giant_executor_jobs_executor (lease_executor_id, updated_at)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS giant_executor_job_events (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(64) NOT NULL,
  executor_id VARCHAR(64) NULL,
  event_type VARCHAR(64) NOT NULL,
  state VARCHAR(32) NOT NULL,
  detail VARCHAR(512) NULL,
  created_at DATETIME(6) NOT NULL,
  KEY idx_giant_executor_job_events_job (job_id, id)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS giant_executor_results (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(64) NOT NULL,
  text_body MEDIUMTEXT NOT NULL,
  word_count INT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_giant_executor_result_job (job_id)
) ENGINE=InnoDB`,
	}
}

func GiantMaterialExecutorMigrations() []Migration {
	return []Migration{
		{Version: 7802001, SQL: GiantMaterialExecutorStatements(), CallbackChecksum: "v78-giant-material-executor-control-plane-v1"},
		{Version: 7802002, SQL: []string{`ALTER TABLE giant_executor_jobs ADD COLUMN target_executor_id VARCHAR(64) NULL AFTER content_range_lines, ADD KEY idx_giant_executor_jobs_target (target_executor_id, state, created_at)`}, CallbackChecksum: "v88-giant-material-executor-targeted-dispatch-v1"},
	}
}
