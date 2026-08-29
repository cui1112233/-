package storage

import (
	"strings"
	"testing"
)

func TestUserPreferenceMigrationPersistsPetSelection(t *testing.T) {
	migration := migrationForVersion(t, 45)
	for _, required := range []string{
		"CREATE TABLE IF NOT EXISTS user_preferences",
		"user_id BIGINT PRIMARY KEY",
		"pet_id VARCHAR(32) NOT NULL DEFAULT 'stacky'",
		"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
	} {
		if !strings.Contains(migration.sql, required) {
			t.Fatalf("user preference migration missing %q", required)
		}
	}
}
