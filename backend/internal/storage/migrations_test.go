package storage

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"
)

func TestOwnerMigrationsPreserveLegacyAccountDefaults(t *testing.T) {
	ownerMigration := migrationForVersion(t, 5)
	if ownerMigration.apply == nil {
		t.Fatal("owner migration needs a recoverable custom apply function")
	}
	marker := migrationSQL(t, 6)
	if !strings.Contains(marker, "CREATE TABLE IF NOT EXISTS app_initializations") {
		t.Fatalf("seed initialization marker migration missing: %s", marker)
	}
}

func TestMigrationsUseExclusiveDatabaseLock(t *testing.T) {
	if migrationLockName == "" {
		t.Fatal("migration lock name is required")
	}
}

func migrationSQL(t *testing.T, version int) string {
	return migrationForVersion(t, version).sql
}

func migrationForVersion(t *testing.T, version int) migration {
	t.Helper()
	for _, migration := range migrations {
		if migration.version == version {
			return migration
		}
	}
	t.Fatalf("migration %d not found", version)
	return migration{}
}

func TestShuihuoAssetPromptSelectionMigrationAddsNullablePresetIDs(t *testing.T) {
	migration := migrationForVersion(t, 24)
	if migration.apply == nil {
		t.Fatal("asset prompt selection migration must repair existing tables idempotently")
	}
	for _, required := range []string{
		"ALTER TABLE shuihuo_asset_generation_configs ADD COLUMN character_preset_id VARCHAR(64) NULL",
		"ALTER TABLE shuihuo_asset_generation_configs ADD COLUMN scene_preset_id VARCHAR(64) NULL",
	} {
		if !strings.Contains(migration.sql, required) {
			t.Fatalf("migration missing %q", required)
		}
	}
}

func TestShuihuoAssetPromptSelectionMigrationIsRepeatable(t *testing.T) {
	executor := &assetPromptSelectionMigrationTestExecutor{columns: map[string]bool{}}
	columnExists := func(_ context.Context, column string) (bool, error) { return executor.columns[column], nil }

	if err := applyShuihuoAssetPromptSelectionMigrationWithExecutor(context.Background(), executor, columnExists); err != nil {
		t.Fatalf("first asset prompt selection migration apply: %v", err)
	}
	if err := applyShuihuoAssetPromptSelectionMigrationWithExecutor(context.Background(), executor, columnExists); err != nil {
		t.Fatalf("repeat asset prompt selection migration apply: %v", err)
	}
	for _, column := range []string{"character_preset_id", "scene_preset_id"} {
		if !executor.columns[column] || executor.columnAdds[column] != 1 {
			t.Fatalf("column %q migration state = columns:%v adds:%v", column, executor.columns, executor.columnAdds)
		}
	}
}

type assetPromptSelectionMigrationTestExecutor struct {
	columns    map[string]bool
	columnAdds map[string]int
}

func (e *assetPromptSelectionMigrationTestExecutor) ExecContext(_ context.Context, query string, _ ...any) (sql.Result, error) {
	command := strings.TrimSpace(query)
	if e.columnAdds == nil {
		e.columnAdds = make(map[string]int)
	}
	for _, column := range []string{"character_preset_id", "scene_preset_id"} {
		if strings.Contains(command, "ADD COLUMN "+column+" VARCHAR(64) NULL") {
			e.columns[column] = true
			e.columnAdds[column]++
			return assetPromptSelectionMigrationTestResult{}, nil
		}
	}
	return nil, fmt.Errorf("unexpected asset prompt selection migration command: %s", command)
}

type assetPromptSelectionMigrationTestResult struct{}
func (assetPromptSelectionMigrationTestResult) LastInsertId() (int64, error) { return 0, nil }
func (assetPromptSelectionMigrationTestResult) RowsAffected() (int64, error) { return 0, nil }
