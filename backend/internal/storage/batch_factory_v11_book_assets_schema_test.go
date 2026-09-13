package storage

import (
	"strings"
	"testing"
)

func TestV11BookAssetsMigrationIsAdditiveAndDurable(t *testing.T) {
	migrations := V11Migrations()
	if len(migrations) < 13 {
		t.Fatalf("migrations=%d", len(migrations))
	}
	assetMigration := migrations[11]
	if assetMigration.Version != 1100012 || assetMigration.CallbackChecksum != "batch-factory-v11-book-assets-v1" {
		t.Fatalf("asset migration=%+v", assetMigration)
	}
	sql := strings.ToLower(strings.Join(V11BookAssetsStatements(), "\n"))
	for _, required := range []string{"batch_factory_v11_book_assets", "owner_username", "book_id", "kind", "prompt", "source", "revision"} {
		if !strings.Contains(sql, required) {
			t.Fatalf("asset migration misses %q: %s", required, sql)
		}
	}
}
