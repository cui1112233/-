package storage

import (
	"context"
	"database/sql"
	"fmt"
)

const migrationLockName = "qiantie_schema_migrations"

type migration struct {
	version int
	sql     string
	apply   func(context.Context, *sql.Conn) error
}

var migrations = []migration{
	{version: 1, sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`},
	{version: 2, sql: `
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`},
	{version: 3, sql: `
CREATE TABLE IF NOT EXISTS api_configs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  provider VARCHAR(64) NOT NULL,
  base_url VARCHAR(512) NOT NULL,
  model VARCHAR(128) NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_config (user_id),
  CONSTRAINT fk_api_configs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`},
	{version: 4, sql: `
CREATE TABLE IF NOT EXISTS generation_histories (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  external_id VARCHAR(64) NOT NULL,
  mode VARCHAR(32) NOT NULL,
  format VARCHAR(32) NOT NULL,
  format_name VARCHAR(64) NOT NULL,
  duration VARCHAR(16) NOT NULL,
  preview VARCHAR(255) NOT NULL,
  output MEDIUMTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_external_id (user_id, external_id),
  KEY idx_user_created_at (user_id, created_at),
  CONSTRAINT fk_generation_histories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`},
	{version: 5, apply: addUserGovernanceColumns},
	{version: 6, sql: `
CREATE TABLE IF NOT EXISTS app_initializations (
  initialization_key VARCHAR(128) PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`},
}

func RunMigrations(ctx context.Context, db *sql.DB) error {
	conn, err := db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("open migration connection: %w", err)
	}
	defer conn.Close()

	var locked int
	if err := conn.QueryRowContext(ctx, "SELECT GET_LOCK(?, 30)", migrationLockName).Scan(&locked); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	if locked != 1 {
		return fmt.Errorf("acquire migration lock: timed out")
	}
	defer conn.ExecContext(context.Background(), "SELECT RELEASE_LOCK(?)", migrationLockName)

	if _, err := conn.ExecContext(ctx, migrations[0].sql); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}
	for _, m := range migrations[1:] {
		var exists int
		err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM schema_migrations WHERE version = ?", m.version).Scan(&exists)
		if err != nil {
			return fmt.Errorf("check migration %d: %w", m.version, err)
		}
		if exists > 0 {
			continue
		}
		if err := applyMigration(ctx, conn, m); err != nil {
			return fmt.Errorf("run migration %d: %w", m.version, err)
		}
		if _, err := conn.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES(?)", m.version); err != nil {
			return fmt.Errorf("record migration %d: %w", m.version, err)
		}
	}
	return nil
}

func applyMigration(ctx context.Context, conn *sql.Conn, m migration) error {
	if m.apply != nil {
		return m.apply(ctx, conn)
	}
	_, err := conn.ExecContext(ctx, m.sql)
	return err
}

func addUserGovernanceColumns(ctx context.Context, conn *sql.Conn) error {
	columns := []struct {
		name       string
		definition string
	}{
		{name: "is_owner", definition: "BOOLEAN NOT NULL DEFAULT FALSE"},
		{name: "is_active", definition: "BOOLEAN NOT NULL DEFAULT TRUE"},
	}
	for _, column := range columns {
		exists, err := mysqlColumnExists(ctx, conn, "users", column.name)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		if _, err := conn.ExecContext(ctx, "ALTER TABLE users ADD COLUMN "+column.name+" "+column.definition); err != nil {
			return err
		}
	}
	return nil
}

func mysqlColumnExists(ctx context.Context, conn *sql.Conn, table, column string) (bool, error) {
	var count int
	err := conn.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
`, table, column).Scan(&count)
	return count > 0, err
}
