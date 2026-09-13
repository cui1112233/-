package storage

import (
	"strings"
	"testing"
)

func TestV11BookAssetsMigrationIsAdditiveAndDurable(t *testing.T) {
	migrations := V11Migrations()
	if len(migrations) < 12 {
		t.Fatalf("migrations=%d", len(migrations))
	}
	last := migrations[len(migrations)-1]
	if last.Version != 1100012 || last.CallbackChecksum != "batch-factory-v11-book-assets-v1" {
		t.Fatalf("last migration=%+v", last)
	}
	sql := strings.ToLower(strings.Join(V11BookAssetsStatements(), "\n"))
	for _, required := range []string{"batch_factory_v11_book_assets", "owner_username", "book_id", "kind", "prompt", "source", "revision"} {
		if !strings.Contains(sql, required) { t.Fatalf("asset migration misses %q: %s", required, sql) }
	}
}
