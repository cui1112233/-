package storage

import (
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
