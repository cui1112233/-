package storage

// V11ShotProductionStatements upgrades durable video production from VIDEO
// granularity to Shot granularity without invalidating historical rows.
// Historical tasks keep shot_id NULL and remain readable as legacy VIDEO tasks.
func V11ShotProductionStatements() []string {
	return []string{
		`ALTER TABLE batch_factory_v11_production_tasks
  ADD COLUMN shot_id VARCHAR(128) NULL AFTER video_id,
  ADD KEY idx_bfv11_production_tasks_shot (job_id, shot_id, attempt)`,
	}
}

func V11ShotProductionMigrations() []Migration {
	return []Migration{{
		Version:          1100011,
		SQL:              V11ShotProductionStatements(),
		CallbackChecksum: "batch-factory-v11-shot-production-v1",
	}}
}
