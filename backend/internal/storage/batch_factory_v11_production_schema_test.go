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
		if !strings.Contains(joined, table) { t.Fatalf("missing production table %s", table) }
	}
	if !strings.Contains(joined, "final_prompt_hash") || !strings.Contains(joined, "unique key") {
		t.Fatalf("production migration must persist prompt hashes and idempotency: %s", joined)
	}
}

func TestV11MigrationsRegisterProductionAfterDirector(t *testing.T) {
	migrations := V11Migrations()
	if len(migrations) < 5 || migrations[len(migrations)-1].Version != 1100005 {
		t.Fatalf("production migration missing: %+v", migrations)
	}
}
