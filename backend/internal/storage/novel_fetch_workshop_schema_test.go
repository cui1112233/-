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
	if len(migrations) != 1 || migrations[0].Version != 1200001 {
		t.Fatalf("unexpected migrations: %#v", migrations)
	}
}
