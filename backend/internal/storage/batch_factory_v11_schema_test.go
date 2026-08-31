package storage

import (
	"strings"
	"testing"
)

func TestV11SliceOneSchemaRegistersSettingsSnapshotPromptAndIntakeTables(t *testing.T) {
	joined := strings.ToLower(strings.Join(V11SliceOneStatements(), "\n"))
	for _, table := range []string{
		"batch_factory_v11_intakes",
		"batch_factory_v11_settings_patches",
		"batch_factory_v11_config_versions",
		"batch_factory_v11_config_snapshots",
		"batch_factory_v11_prompt_definitions",
		"batch_factory_v11_prompt_versions",
		"batch_factory_v11_drafts",
	} {
		if !strings.Contains(joined, table) {
			t.Fatalf("missing %s", table)
		}
	}
}

func TestV11MigrationsAreOrderedFoundationThenSliceOneClosures(t *testing.T) {
	got := V11Migrations()
	if len(got) != 3 || got[0].Version != 1100001 || got[1].Version != 1100002 || got[2].Version != 1100003 {
		t.Fatalf("migrations=%+v", got)
	}
}

func TestV11SliceOneSchemaHasNoTextDefault(t *testing.T) {
	for _, stmt := range V11SliceOneStatements() {
		u := strings.ToUpper(stmt)
		if strings.Contains(u, "TEXT NOT NULL DEFAULT") || strings.Contains(u, "MEDIUMTEXT NOT NULL DEFAULT") {
			t.Fatal(stmt)
		}
	}
}

func TestV11SliceOneSchemaLinksAggregateParents(t *testing.T) {
	joined := strings.ToLower(strings.Join(V11SliceOneStatements(), "\n"))
	for _, clause := range []string{
		"foreign key (batch_id) references batch_factory_v11_batches(id)",
		"foreign key (book_id) references batch_factory_v11_books(id)",
		"foreign key (video_id) references batch_factory_v11_videos(id)",
		"foreign key (prompt_id) references batch_factory_v11_prompt_definitions(id)",
	} {
		if !strings.Contains(joined, clause) {
			t.Fatalf("missing %s", clause)
		}
	}
}

func TestV11SliceOneKeepsFoundationChecksumStable(t *testing.T) {
	foundation := V11FoundationMigrations()
	all := V11Migrations()
	if len(foundation) != 1 || len(all) < 2 {
		t.Fatalf("foundation=%d all=%d", len(foundation), len(all))
	}
	if ChecksumFor(foundation[0]) != ChecksumFor(all[0]) {
		t.Fatal("Slice 1 rewrote the Foundation migration checksum")
	}
	if got := len(ChecksumFor(all[1])); got != 64 {
		t.Fatalf("Slice 1 checksum length=%d", got)
	}
}
