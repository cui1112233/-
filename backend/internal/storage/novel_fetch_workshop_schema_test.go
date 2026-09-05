package storage

import (
	"strings"
	"testing"
)

func TestAppMigrationsIncludeNovelFetchWorkshopPersistence(t *testing.T) {
	var found *Migration
	for index := range AppMigrations() {
		migration := AppMigrations()[index]
		if migration.Version == 1200001 {
			found = &migration
			break
		}
	}
	if found == nil {
		t.Fatal("Novel Fetch workshop migration is not registered")
	}
	joined := strings.Join(found.SQL, "\n")
	for _, table := range []string{"novel_fetch_workshop_documents", "novel_fetch_workshop_configs"} {
		if !strings.Contains(joined, table) {
			t.Fatalf("migration %d does not create %s", found.Version, table)
		}
	}
}
