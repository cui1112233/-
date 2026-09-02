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
	if len(migrations) == 0 || migrations[0].Version != 1200001 {
		t.Fatalf("unexpected base migration: %#v", migrations)
	}
}

func TestNovelFetchWorkshopBodyMigration(t *testing.T) {
	migrations := NovelFetchWorkshopMigrations()
	if len(migrations) < 2 {
		t.Fatalf("expected v2 migration, got %#v", migrations)
	}
	if migrations[1].Version != 1200002 {
		t.Fatalf("version=%d", migrations[1].Version)
	}
	joined := strings.Join(migrations[1].SQL, "\n")
	for _, want := range []string{
		"CREATE TABLE IF NOT EXISTS novel_fetch_workshop_bodies",
		"owner_username VARCHAR(191) NOT NULL",
		"book_id VARCHAR(191) NOT NULL",
		"version_id VARCHAR(64) NOT NULL",
		"content_blob LONGBLOB NOT NULL",
		"content_hash CHAR(64) NOT NULL",
		"char_count BIGINT UNSIGNED NOT NULL",
		"PRIMARY KEY (owner_username, book_id, version_id)",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("body schema missing %q", want)
		}
	}
}
