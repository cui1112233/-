package storage

// V12 keeps its upgrade lineage outside V11 tables. The immutable snapshot is
// the audit anchor for a legacy batch opened by the V12 workbench; source V11
// rows are never rewritten as part of that transition.
func V12UpgradeAuditStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS batch_factory_v12_upgrade_audits (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  source_v11_batch_id VARCHAR(64) NOT NULL,
  target_v12_batch_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL,
  snapshot_json JSON NOT NULL,
  detail TEXT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_bfv12_upgrade_source (owner_username, source_v11_batch_id),
  KEY idx_bfv12_upgrade_target (owner_username, target_v12_batch_id, updated_at)
) ENGINE=InnoDB`,
	}
}

func V12H3AggregateStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS batch_factory_v12_audio_measurements (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  batch_id VARCHAR(64) NOT NULL,
  book_id VARCHAR(64) NOT NULL,
  audio_asset_id VARCHAR(64) NOT NULL,
  audio_content_hash VARCHAR(128) NOT NULL,
  audio_duration_ms BIGINT NOT NULL,
  video_source_revision VARCHAR(128) NOT NULL,
  video_source_hash VARCHAR(128) NOT NULL,
  probe_key VARCHAR(64) NOT NULL,
  probe_version VARCHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_bfv12_audio_content (owner_username, book_id, audio_asset_id, audio_content_hash),
  KEY idx_bfv12_audio_latest (owner_username, batch_id, book_id, audio_asset_id, created_at),
  CONSTRAINT fk_bfv12_audio_batch FOREIGN KEY (batch_id) REFERENCES batch_factory_v11_batches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bfv12_audio_book FOREIGN KEY (book_id) REFERENCES batch_factory_v11_books(id) ON DELETE RESTRICT
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v12_canonical_timelines (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  batch_id VARCHAR(64) NOT NULL,
  book_id VARCHAR(64) NOT NULL,
  director_revision_id VARCHAR(64) NOT NULL,
  audio_asset_id VARCHAR(64) NOT NULL,
  audio_content_hash VARCHAR(128) NOT NULL,
  audio_duration_ms BIGINT NOT NULL,
  allocator_version VARCHAR(64) NOT NULL,
  timeline_json JSON NOT NULL,
  input_hash CHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_bfv12_timeline_input (owner_username, book_id, input_hash),
  KEY idx_bfv12_timeline_owner_book (owner_username, batch_id, book_id, created_at),
  CONSTRAINT fk_bfv12_timeline_batch FOREIGN KEY (batch_id) REFERENCES batch_factory_v11_batches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bfv12_timeline_book FOREIGN KEY (book_id) REFERENCES batch_factory_v11_books(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bfv12_timeline_director FOREIGN KEY (director_revision_id) REFERENCES batch_factory_v11_director_revisions(id) ON DELETE RESTRICT
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v12_video_compilations (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  batch_id VARCHAR(64) NOT NULL,
  book_id VARCHAR(64) NOT NULL,
  director_revision_id VARCHAR(64) NOT NULL,
  canonical_timeline_id VARCHAR(64) NOT NULL,
  video_preset_key VARCHAR(128) NOT NULL,
  video_preset_revision BIGINT NOT NULL,
  video_preset_snapshot JSON NOT NULL,
  compiler_key VARCHAR(64) NOT NULL,
  compiler_version VARCHAR(64) NOT NULL,
  max_segment_ms BIGINT NOT NULL,
  compilation_json JSON NOT NULL,
  input_hash CHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_bfv12_compilation_input (owner_username, book_id, input_hash),
  KEY idx_bfv12_compilation_owner_book (owner_username, batch_id, book_id, created_at),
  CONSTRAINT fk_bfv12_compilation_batch FOREIGN KEY (batch_id) REFERENCES batch_factory_v11_batches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bfv12_compilation_book FOREIGN KEY (book_id) REFERENCES batch_factory_v11_books(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bfv12_compilation_director FOREIGN KEY (director_revision_id) REFERENCES batch_factory_v11_director_revisions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bfv12_compilation_timeline FOREIGN KEY (canonical_timeline_id) REFERENCES batch_factory_v12_canonical_timelines(id) ON DELETE RESTRICT
) ENGINE=InnoDB`,
	}
}

func V12H3ProductionTraceStatements() []string {
	return []string{
		`ALTER TABLE batch_factory_v11_production_tasks ADD COLUMN compilation_id VARCHAR(64) NULL AFTER video_id`,
		`ALTER TABLE batch_factory_v11_production_tasks ADD COLUMN compilation_segment_key VARCHAR(64) NULL AFTER compilation_id`,
		`ALTER TABLE batch_factory_v11_production_tasks ADD COLUMN compile_trace_json JSON NULL AFTER compiled_prompt`,
		`ALTER TABLE batch_factory_v11_production_tasks ADD KEY idx_bfv11_production_compilation (owner_username, compilation_id, compilation_segment_key)`,
		`ALTER TABLE batch_factory_v11_production_tasks ADD CONSTRAINT fk_bfv11_production_compilation FOREIGN KEY (compilation_id) REFERENCES batch_factory_v12_video_compilations(id) ON DELETE RESTRICT`,
	}
}

func V12H3KernelStatements() []string {
	statements := append([]string(nil), V12H3AggregateStatements()...)
	return append(statements, V12H3ProductionTraceStatements()...)
}

func V12Migrations() []Migration {
	// 1200001-1200003 belong to Novel Fetch Workshop in the shared migration
	// ledger. V12 must have its own unused number or a Batch Factory startup
	// would reject that unrelated, already-applied migration by checksum.
	return []Migration{
		{Version: 1200101, SQL: V12UpgradeAuditStatements(), CallbackChecksum: "batch-factory-v12-upgrade-audit-v1"},
		{Version: 1200102, SQL: V12H3AggregateStatements(), CallbackChecksum: "batch-factory-v12-h3-aggregates-v1"},
		{Version: 1200103, SQL: V12H3ProductionTraceStatements(), CallbackChecksum: "batch-factory-v12-h3-production-trace-v1"},
		{Version: 1200104, SQL: []string{`ALTER TABLE batch_factory_v12_audio_measurements ADD COLUMN measurement_json JSON NULL`}, CallbackChecksum: "batch-factory-v12-line-audio-v1"},
	}
}
