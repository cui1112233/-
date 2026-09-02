package storage

import (
	"strings"
	"testing"
)

func TestNovelFetchWorkshopCleanupMigrationAddsReleasableLifecycle(t *testing.T) {
	migrations := NovelFetchWorkshopMigrations()
	if len(migrations) < 3 {
		t.Fatalf("expected cleanup migration, got %#v", migrations)
	}
	migration := migrations[2]
	if migration.Version != 1200003 {
		t.Fatalf("version=%d", migration.Version)
	}
	joined := strings.Join(migration.SQL, "\n")
	for _, want := range []string{
		"ALTER TABLE novel_fetch_workshop_bodies",
		"ADD COLUMN releasable_at DATETIME(6) NULL AFTER last_needed_at",
		"idx_nfw_bodies_owner_releasable",
		"(owner_username, state, releasable_at)",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("cleanup schema missing %q in %s", want, joined)
		}
	}
}
