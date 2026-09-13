package storage

import (
	"strings"
	"testing"
)

func TestV11BookAssetImageMigrationKeepsVersionHistory(t *testing.T) {
	migrations := V11Migrations()
	if len(migrations) < 13 {
		t.Fatalf("migrations=%d", len(migrations))
	}
	imageMigration := migrations[12]
	if imageMigration.Version != 1100013 || imageMigration.CallbackChecksum != "batch-factory-v11-book-asset-images-v1" {
		t.Fatalf("image migration=%+v", imageMigration)
	}
	sql := strings.ToLower(strings.Join(V11BookAssetImagesStatements(), "\n"))
	for _, required := range []string{"batch_factory_v11_book_asset_images", "asset_id", "storage_ref", "media_type", "is_primary", "revision", "foreign key (asset_id)"} {
		if !strings.Contains(sql, required) {
			t.Fatalf("asset image migration misses %q: %s", required, sql)
		}
	}
}
