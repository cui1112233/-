package storage

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

const migrationLockName = "qiantie_schema_migrations"

type migration struct {
	version int
	sql     string
	apply   func(context.Context, *sql.Conn) error
}

const shuihuoProductionMigrationSQL = `
CREATE TABLE IF NOT EXISTS shuihuo_projects (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  source_text MEDIUMTEXT NULL,
  source_object_key VARCHAR(1024) NOT NULL DEFAULT '',
  segmentation_status VARCHAR(32) NOT NULL DEFAULT 'draft',
  segmentation_version INT NOT NULL DEFAULT 0,
  selected_text_model_id BIGINT NULL,
  selected_image_model_id BIGINT NULL,
  selected_video_model_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_shuihuo_projects_user_created (user_id, created_at),
  CONSTRAINT fk_shuihuo_projects_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shuihuo_segments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  source_text MEDIUMTEXT NOT NULL,
  subtitle_text MEDIUMTEXT NULL,
  order_index INT NOT NULL,
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  manually_edited BOOLEAN NOT NULL DEFAULT FALSE,
  image_prompt MEDIUMTEXT NOT NULL,
  video_prompt MEDIUMTEXT NOT NULL,
  image_prompt_locked BOOLEAN NOT NULL DEFAULT FALSE,
  video_prompt_locked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_shuihuo_segments_project_order (project_id, order_index),
  KEY idx_shuihuo_segments_project_confirmed (project_id, confirmed),
  CONSTRAINT fk_shuihuo_segments_project FOREIGN KEY (project_id) REFERENCES shuihuo_projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shuihuo_asset_types (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NULL,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_shuihuo_asset_types_owner_name (user_id, name),
  CONSTRAINT fk_shuihuo_asset_types_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shuihuo_asset_templates (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NULL,
  asset_type_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  prompt MEDIUMTEXT NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'manual',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_shuihuo_asset_templates_type (asset_type_id),
  KEY idx_shuihuo_asset_templates_user_created (user_id, created_at),
  CONSTRAINT fk_shuihuo_asset_templates_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_shuihuo_asset_templates_type FOREIGN KEY (asset_type_id) REFERENCES shuihuo_asset_types(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shuihuo_assets (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  asset_type_id BIGINT NULL,
  name VARCHAR(255) NOT NULL,
  prompt MEDIUMTEXT NOT NULL,
  reference_object_key VARCHAR(1024) NOT NULL DEFAULT '',
  source VARCHAR(32) NOT NULL DEFAULT 'manual',
  manually_edited BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_shuihuo_assets_project_created (project_id, created_at),
  KEY idx_shuihuo_assets_type (asset_type_id),
  CONSTRAINT fk_shuihuo_assets_project FOREIGN KEY (project_id) REFERENCES shuihuo_projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_shuihuo_assets_type FOREIGN KEY (asset_type_id) REFERENCES shuihuo_asset_types(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shuihuo_segment_assets (
  segment_id BIGINT NOT NULL,
  asset_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (segment_id, asset_id),
  KEY idx_shuihuo_segment_assets_asset (asset_id),
  CONSTRAINT fk_shuihuo_segment_assets_segment FOREIGN KEY (segment_id) REFERENCES shuihuo_segments(id) ON DELETE CASCADE,
  CONSTRAINT fk_shuihuo_segment_assets_asset FOREIGN KEY (asset_id) REFERENCES shuihuo_assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shuihuo_tasks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  segment_id BIGINT NULL,
  kind VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  provider VARCHAR(64) NOT NULL DEFAULT '',
  provider_task_id VARCHAR(255) NULL,
  model_id BIGINT NULL,
  model_version_id BIGINT NULL,
  prompt_version_id BIGINT NULL,
  input_snapshot MEDIUMTEXT NULL,
  output_snapshot MEDIUMTEXT NULL,
  error_code VARCHAR(128) NOT NULL DEFAULT '',
  error_message MEDIUMTEXT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_shuihuo_tasks_project_status (project_id, status),
  KEY idx_shuihuo_tasks_segment_status (segment_id, status),
  UNIQUE KEY uniq_shuihuo_tasks_provider_task (provider, provider_task_id),
  CONSTRAINT fk_shuihuo_tasks_project FOREIGN KEY (project_id) REFERENCES shuihuo_projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_shuihuo_tasks_segment FOREIGN KEY (segment_id) REFERENCES shuihuo_segments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shuihuo_media (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  segment_id BIGINT NULL,
  task_id BIGINT NULL,
  kind VARCHAR(32) NOT NULL,
  object_key VARCHAR(1024) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'manual',
  manually_edited BOOLEAN NOT NULL DEFAULT FALSE,
  width INT NULL,
  height INT NULL,
  duration_ms BIGINT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_shuihuo_media_project_created (project_id, created_at),
  KEY idx_shuihuo_media_segment_kind (segment_id, kind),
  KEY idx_shuihuo_media_task (task_id),
  CONSTRAINT fk_shuihuo_media_project FOREIGN KEY (project_id) REFERENCES shuihuo_projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_shuihuo_media_segment FOREIGN KEY (segment_id) REFERENCES shuihuo_segments(id) ON DELETE SET NULL,
  CONSTRAINT fk_shuihuo_media_task FOREIGN KEY (task_id) REFERENCES shuihuo_tasks(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shuihuo_task_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  task_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  message MEDIUMTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_shuihuo_task_events_task_created (task_id, created_at),
  CONSTRAINT fk_shuihuo_task_events_task FOREIGN KEY (task_id) REFERENCES shuihuo_tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`

const shuihuoGovernanceMigrationSQL = `
CREATE TABLE IF NOT EXISTS prompt_definitions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  module VARCHAR(64) NOT NULL,
  purpose VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_prompt_definition (module, purpose, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prompt_versions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  prompt_definition_id BIGINT NOT NULL,
  version_number INT NOT NULL,
  parameters_json JSON NULL,
  body MEDIUMTEXT NOT NULL,
  created_by BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_prompt_version (prompt_definition_id, version_number),
  CONSTRAINT fk_prompt_versions_definition FOREIGN KEY (prompt_definition_id) REFERENCES prompt_definitions(id) ON DELETE CASCADE,
  CONSTRAINT fk_prompt_versions_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS model_definitions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  adapter_kind VARCHAR(64) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_roles_json JSON NULL,
  parameter_schema_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_model_definition_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS model_versions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  model_definition_id BIGINT NOT NULL,
  version_number INT NOT NULL,
  credential_ref VARCHAR(255) NOT NULL DEFAULT '',
  endpoint VARCHAR(1024) NOT NULL DEFAULT '',
  request_template MEDIUMTEXT NULL,
  response_mapping MEDIUMTEXT NULL,
  created_by BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_model_version (model_definition_id, version_number),
  CONSTRAINT fk_model_versions_definition FOREIGN KEY (model_definition_id) REFERENCES model_definitions(id) ON DELETE CASCADE,
  CONSTRAINT fk_model_versions_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`

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
	{version: 7, sql: shuihuoProductionMigrationSQL, apply: applyShuihuoProductionSchema},
	{version: 8, sql: shuihuoGovernanceMigrationSQL, apply: applyShuihuoGovernanceSchema},
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

func applyShuihuoProductionSchema(ctx context.Context, conn *sql.Conn) error {
	return applySQLStatements(ctx, conn, shuihuoProductionMigrationSQL)
}

func applyShuihuoGovernanceSchema(ctx context.Context, conn *sql.Conn) error {
	return applySQLStatements(ctx, conn, shuihuoGovernanceMigrationSQL)
}

func applySQLStatements(ctx context.Context, conn *sql.Conn, script string) error {
	for _, statement := range strings.Split(script, ";") {
		statement = strings.TrimSpace(statement)
		if statement == "" {
			continue
		}
		if _, err := conn.ExecContext(ctx, statement); err != nil {
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
