package storage

import (
	"strings"
	"testing"
)

func TestV11ProductionMigrationAddsDurableJobTaskAndEventTables(t *testing.T) {
	joined := strings.ToLower(strings.Join(V11ProductionStatements(), "\n"))
	for _, table := range []string{
		"batch_factory_v11_production_jobs",
		"batch_factory_v11_production_tasks",
		"batch_factory_v11_production_events",
	} {
		if !strings.Contains(joined, table) {
			t.Fatalf("missing production table %s", table)
		}
	}
	if !strings.Contains(joined, "final_prompt_hash") || !strings.Contains(joined, "unique key") {
		t.Fatalf("production migration must persist prompt hashes and idempotency: %s", joined)
	}
}

func TestV11MigrationsRegisterProductionAfterDirector(t *testing.T) {
	migrations := V11Migrations()
	if len(migrations) < 6 || migrations[4].Version != 1100005 {
		t.Fatalf("production migration missing: %+v", migrations)
	}
}

func TestV11BookStageRunsMigrationIsAdditiveAndDurable(t *testing.T) {
	migrations := V11Migrations()
	last := migrations[len(migrations)-1]
	if last.Version != 1100015 || last.CallbackChecksum != "batch-factory-v11-book-stage-runs-v1" {
		t.Fatalf("stage migration=%+v", last)
	}
	joined := strings.ToLower(strings.Join(V11BookStageRunsStatements(), "\n"))
	for _, required := range []string{"batch_factory_v11_book_stage_runs", "book_id", "stage", "attempt", "error_message", "idx_bfv11_stage_owner_book_updated"} {
		if !strings.Contains(joined, required) {
			t.Fatalf("stage migration misses %q", required)
		}
	}
}
