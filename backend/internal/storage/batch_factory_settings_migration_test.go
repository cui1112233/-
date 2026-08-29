package storage

import (
	"strings"
	"testing"
)

func TestBatchFactorySettingsMigrationCreatesScopedSettingsTable(t *testing.T) {
	if !strings.Contains(batchFactorySettingsMigrationSQL, "CREATE TABLE IF NOT EXISTS shuihuo_batch_factory_settings") {
		t.Fatalf("batch factory settings table missing from migration SQL")
	}
	for _, token := range []string{
		"user_id BIGINT NOT NULL",
		"batch_id VARCHAR(96) NOT NULL",
		"scope VARCHAR(16) NOT NULL",
		"item_id VARCHAR(96) NOT NULL DEFAULT ''",
		"video_id VARCHAR(96) NOT NULL DEFAULT ''",
		"settings_json JSON NOT NULL",
		"PRIMARY KEY (user_id, batch_id, scope, item_id, video_id)",
		"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
	} {
		if !strings.Contains(batchFactorySettingsMigrationSQL, token) {
			t.Fatalf("migration SQL missing %q", token)
		}
	}

	found := false
	for _, migration := range migrations {
		if migration.version == 28 {
			found = migration.sql == batchFactorySettingsMigrationSQL
			break
		}
	}
	if !found {
		t.Fatalf("migration version 28 must install batch factory settings storage")
	}
}
