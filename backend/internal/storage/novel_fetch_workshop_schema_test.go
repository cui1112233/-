package storage

import (
	"strings"
	"testing"
)

func TestNovelFetchWorkshopSchemaIsOwnerScopedAndJSONBacked(t *testing.T) {
	joined := strings.Join(NovelFetchWorkshopStatements(), "\n")
	for _, expected := range []string{
		"novel_fetch_workshop_documents",
		"PRIMARY KEY (owner_username, book_id)",
		"document_json JSON NOT NULL",
		"novel_fetch_workshop_configs",
		"settings_json JSON NOT NULL",
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("schema missing %q", expected)
		}
	}
	migrations := NovelFetchWorkshopMigrations()
	wantVersions := []int{1200001, 1200002, 1200003}
	if len(migrations) != len(wantVersions) {
		t.Fatalf("unexpected migrations: %#v", migrations)
	}
	for index, want := range wantVersions {
		if migrations[index].Version != want {
			t.Fatalf("migration %d version = %d, want %d", index, migrations[index].Version, want)
		}
	}
}
