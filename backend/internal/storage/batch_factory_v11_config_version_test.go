package storage

import (
	"strings"
	"testing"
)

func TestV11ConfigVersionOwnershipUsesAdditiveSliceOneMigration(t *testing.T) {
	migrations := V11Migrations()
	if len(migrations) < 4 || migrations[0].Version != 1100001 || migrations[1].Version != 1100002 || migrations[2].Version != 1100003 || migrations[3].Version != 1100004 {
		t.Fatalf("migrations=%+v", migrations)
	}
	joined := strings.ToLower(strings.Join(V11ConfigVersionOwnershipStatements(), "\n"))
	for _, want := range []string{
		"alter table batch_factory_v11_config_versions",
		"owner_username",
		"idx_bfv11_config_versions_owner_created",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %s", want, joined)
		}
	}
}

func TestV11ConfigVersionOwnershipDoesNotRewriteSliceOneMigration(t *testing.T) {
	base := Migration{Version: 1100002, SQL: V11SliceOneStatements(), CallbackChecksum: "batch-factory-v11-slice1-v1"}
	migrations := V11Migrations()
	if len(migrations) < 2 || ChecksumFor(base) != ChecksumFor(migrations[1]) {
		t.Fatal("config version ownership change rewrote Slice 1 migration 1100002")
	}
}
