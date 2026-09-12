package storage

import (
	"strings"
	"testing"
)

func TestV11ShotProductionMigrationAddsNullableShotIdentity(t *testing.T) {
	joined := strings.ToLower(strings.Join(V11ShotProductionStatements(), "\n"))
	if !strings.Contains(joined, "add column shot_id") || !strings.Contains(joined, "shot_id varchar(128) null") {
		t.Fatalf("shot migration must preserve legacy rows with nullable shot_id: %s", joined)
	}
	if !strings.Contains(joined, "drop index uq_bfv11_production_task_attempt") {
		t.Fatalf("video-level uniqueness must be retired: %s", joined)
	}
	if !strings.Contains(joined, "unique key uq_bfv11_production_shot_attempt (job_id, video_id, shot_id, attempt)") {
		t.Fatalf("shot-level uniqueness is required: %s", joined)
	}
	if !strings.Contains(joined, "idx_bfv11_production_tasks_shot") {
		t.Fatalf("shot migration must index job/shot attempts: %s", joined)
	}
}

func TestV11ShotProductionMigrationVersionFollowsCurrentV11Plan(t *testing.T) {
	migrations := V11ShotProductionMigrations()
	if len(migrations) != 1 || migrations[0].Version != 1100011 {
		t.Fatalf("unexpected shot migration: %+v", migrations)
	}
}
