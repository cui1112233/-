package storage

// V11MergeHierarchyStatements upgrades the existing merge tables without
// rewriting historical rows. Legacy batch-level merge records keep all new
// hierarchy/timing columns NULL and remain readable.
func V11MergeHierarchyStatements() []string {
	return []string{
		`ALTER TABLE batch_factory_v11_merge_jobs
  ADD COLUMN root_request_id VARCHAR(128) NULL AFTER request_id,
  ADD COLUMN book_id VARCHAR(64) NULL AFTER root_request_id,
  ADD COLUMN video_id VARCHAR(64) NULL AFTER book_id,
  ADD COLUMN stage VARCHAR(32) NULL AFTER video_id,
  ADD COLUMN timing_mode VARCHAR(32) NULL AFTER stage,
  ADD COLUMN speed DOUBLE NULL AFTER timing_mode,
  ADD COLUMN tts_speed DOUBLE NULL AFTER speed,
  ADD COLUMN audio_duration_seconds DOUBLE NULL AFTER tts_speed,
  ADD KEY idx_bfv11_merge_jobs_hierarchy (owner_username, batch_id, book_id, root_request_id, stage)`,
		`ALTER TABLE batch_factory_v11_merge_sources
  ADD COLUMN production_job_id VARCHAR(64) NULL AFTER owner_username,
  ADD COLUMN book_id VARCHAR(64) NULL AFTER production_job_id,
  ADD COLUMN shot_id VARCHAR(128) NULL AFTER video_id`,
	}
}

func V11MergeHierarchyMigrations() []Migration {
	return []Migration{{
		Version:          1100012,
		SQL:              V11MergeHierarchyStatements(),
		CallbackChecksum: "batch-factory-v11-merge-hierarchy-v1",
	}}
}
