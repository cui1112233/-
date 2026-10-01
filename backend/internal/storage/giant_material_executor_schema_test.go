package storage

import (
	"strings"
	"testing"
)

func TestGiantMaterialExecutorMigrationIsSeparateFromDoubaoExecutor(t *testing.T) {
	migrations := GiantMaterialExecutorMigrations()
	if len(migrations) != 2 || migrations[0].Version != 7802001 || migrations[1].Version != 7802002 {
		t.Fatalf("migrations=%+v", migrations)
	}
	joined := strings.Join(migrations[0].SQL, "\n")
	for _, table := range []string{"giant_executor_pairings", "giant_executors", "giant_executor_jobs", "giant_executor_job_events", "giant_executor_results"} {
		if !strings.Contains(joined, "CREATE TABLE IF NOT EXISTS "+table) {
			t.Fatalf("migration missing %s: %s", table, joined)
		}
	}
	if strings.Contains(joined, "local_executor_") {
		t.Fatal("giant executor migration must not reuse local executor tables")
	}
}
