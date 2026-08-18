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

CREATE TABLE IF NOT EXISTS shuihuo_user_configs (
  user_id BIGINT PRIMARY KEY,
  character_prefix MEDIUMTEXT NOT NULL,
  image_prefix MEDIUMTEXT NOT NULL,
  image_suffix MEDIUMTEXT NOT NULL,
  video_prefix MEDIUMTEXT NOT NULL,
  video_suffix MEDIUMTEXT NOT NULL,
  text_model_id BIGINT NULL,
  image_model_id BIGINT NULL,
  video_model_id BIGINT NULL,
  audio_model_id BIGINT NULL,
  jianying_draft_directory VARCHAR(1024) NOT NULL DEFAULT '',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_shuihuo_user_configs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
  negative_prompt MEDIUMTEXT NOT NULL,
  image_prompt_locked BOOLEAN NOT NULL DEFAULT FALSE,
  video_prompt_locked BOOLEAN NOT NULL DEFAULT FALSE,
  negative_prompt_locked BOOLEAN NOT NULL DEFAULT FALSE,
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
	category VARCHAR(32) NOT NULL DEFAULT 'character',
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
	{version: 9, apply: addShuihuoAssetCategory},
	{version: 10, sql: shuihuoAnalysisSnapshotsMigrationSQL, apply: seedShuihuoAnalysisPrompts},
	{version: 11, apply: addShuihuoTaskPolling},
	{version: 15, sql: shuihuoSourceUnitMigrationSQL, apply: applyShuihuoSourceUnitSchema},
	{version: 16, apply: ensureShuihuoSourceUnitOrderUnique},
	{version: 17, apply: addShuihuoSourceUnitSegmentationVersions},
	{version: 18, sql: shuihuoObjectCleanupMigrationSQL},
	{version: 19, sql: shuihuoImportCompensationMigrationSQL, apply: addShuihuoImportCompensationRecovery},
	{version: 20, sql: shuihuoAssetGenerationConfigMigrationSQL},
	{version: 21, sql: shuihuoAccountAPITextModelMigrationSQL, apply: applyShuihuoAccountAPITextModelMigration},
	{version: 22, apply: addShuihuoNegativePromptColumns},
	{version: 23, sql: shuihuoUserConfigDefaultsMigrationSQL, apply: addShuihuoUserConfigAudioModel},
	{version: 24, sql: shuihuoAssetPromptSelectionMigrationSQL, apply: addShuihuoAssetPromptSelectionColumns},
	{version: 25, sql: shuihuoAssetPresetImageMigrationSQL, apply: addShuihuoAssetPresetImageColumns},
	{version: 26, sql: shuihuoAssetHistoryMigrationSQL, apply: addShuihuoAssetHistoryColumns},
	{version: 27, apply: addModelCenterCatalogColumns},
}

const shuihuoSourceUnitMigrationSQL = `
CREATE TABLE IF NOT EXISTS shuihuo_source_units (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  text MEDIUMTEXT NOT NULL,
  source_kind VARCHAR(32) NOT NULL,
  source_order INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE KEY uniq_shuihuo_source_units_project_order (project_id, source_order),
	KEY idx_shuihuo_source_units_project_order_id (project_id, source_order, id),
  CONSTRAINT fk_shuihuo_source_units_project FOREIGN KEY (project_id) REFERENCES shuihuo_projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shuihuo_segment_source_units (
  segment_id BIGINT NOT NULL,
  source_unit_id BIGINT NOT NULL,
  position_index INT NOT NULL,
  PRIMARY KEY (segment_id, source_unit_id),
  UNIQUE KEY uniq_shuihuo_segment_source_units_position (segment_id, position_index),
  KEY idx_shuihuo_segment_source_units_source (source_unit_id),
  CONSTRAINT fk_shuihuo_segment_source_units_segment FOREIGN KEY (segment_id) REFERENCES shuihuo_segments(id) ON DELETE CASCADE,
  CONSTRAINT fk_shuihuo_segment_source_units_source FOREIGN KEY (source_unit_id) REFERENCES shuihuo_source_units(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`

const shuihuoSourceUnitHistoryMigrationSQL = `
CREATE TABLE IF NOT EXISTS shuihuo_segment_source_unit_history (
  project_id BIGINT NOT NULL,
  segmentation_version INT NOT NULL,
  segment_id BIGINT NOT NULL,
  segment_order_index INT NOT NULL,
  source_unit_id BIGINT NOT NULL,
  position_index INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, segmentation_version, segment_id, source_unit_id),
  UNIQUE KEY uniq_shuihuo_source_unit_history_position (project_id, segmentation_version, segment_id, position_index),
  KEY idx_shuihuo_source_unit_history_project_version (project_id, segmentation_version, segment_order_index),
  CONSTRAINT fk_shuihuo_source_unit_history_project FOREIGN KEY (project_id) REFERENCES shuihuo_projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_shuihuo_source_unit_history_source FOREIGN KEY (source_unit_id) REFERENCES shuihuo_source_units(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`

const shuihuoObjectCleanupMigrationSQL = `
CREATE TABLE IF NOT EXISTS shuihuo_object_cleanup_queue (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  object_key VARCHAR(768) NOT NULL,
  reason VARCHAR(128) NOT NULL,
  last_error VARCHAR(2048) NOT NULL DEFAULT '',
  attempt_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempt_at DATETIME NULL,
  UNIQUE KEY uniq_shuihuo_object_cleanup_key (object_key),
  KEY idx_shuihuo_object_cleanup_created (created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`

const shuihuoImportCompensationMigrationSQL = `
CREATE TABLE IF NOT EXISTS shuihuo_import_compensation_queue (
  project_id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  object_key VARCHAR(1024) NOT NULL DEFAULT '',
  reason VARCHAR(128) NOT NULL,
  last_error VARCHAR(2048) NOT NULL DEFAULT '',
  attempt_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempt_at DATETIME NULL,
  KEY idx_shuihuo_import_compensation_created (created_at, project_id),
  CONSTRAINT fk_shuihuo_import_compensation_project FOREIGN KEY (project_id) REFERENCES shuihuo_projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_shuihuo_import_compensation_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`

const shuihuoAssetGenerationConfigMigrationSQL = `
CREATE TABLE IF NOT EXISTS shuihuo_asset_generation_configs (
  project_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  text_model_id BIGINT NULL,
  image_model_id BIGINT NULL,
  audio_model_id BIGINT NULL,
  prompt_template_id BIGINT NULL,
  aspect_ratio VARCHAR(8) NOT NULL DEFAULT '16:9',
  style_reference_media_id BIGINT NULL,
  three_view BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_shuihuo_asset_generation_configs_project_user (project_id, user_id),
  KEY idx_shuihuo_asset_generation_configs_user_project (user_id, project_id),
  CONSTRAINT chk_shuihuo_asset_generation_configs_aspect_ratio CHECK (aspect_ratio IN ('16:9', '9:16', '1:1')),
  CONSTRAINT fk_shuihuo_asset_generation_configs_project FOREIGN KEY (project_id) REFERENCES shuihuo_projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_shuihuo_asset_generation_configs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`

const shuihuoAssetPromptSelectionMigrationSQL = `
ALTER TABLE shuihuo_asset_generation_configs ADD COLUMN character_preset_id VARCHAR(64) NULL;
ALTER TABLE shuihuo_asset_generation_configs ADD COLUMN scene_preset_id VARCHAR(64) NULL;
`

const shuihuoAssetPresetImageMigrationSQL = `
CREATE TABLE IF NOT EXISTS shuihuo_asset_styles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  prompt MEDIUMTEXT NOT NULL,
  reference_media_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_shuihuo_asset_styles_project_name (project_id, name),
  KEY idx_shuihuo_asset_styles_user_project (user_id, project_id),
  CONSTRAINT fk_shuihuo_asset_styles_project FOREIGN KEY (project_id) REFERENCES shuihuo_projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_shuihuo_asset_styles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shuihuo_asset_images (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  asset_id BIGINT NOT NULL,
  task_id BIGINT NULL,
  object_key VARCHAR(1024) NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_shuihuo_asset_images_asset_created (asset_id, created_at),
  KEY idx_shuihuo_asset_images_project_created (project_id, created_at),
  KEY idx_shuihuo_asset_images_task (task_id),
  CONSTRAINT fk_shuihuo_asset_images_project FOREIGN KEY (project_id) REFERENCES shuihuo_projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_shuihuo_asset_images_asset FOREIGN KEY (asset_id) REFERENCES shuihuo_assets(id) ON DELETE CASCADE,
  CONSTRAINT fk_shuihuo_asset_images_task FOREIGN KEY (task_id) REFERENCES shuihuo_tasks(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`

const shuihuoAssetHistoryMigrationSQL = `
ALTER TABLE shuihuo_assets ADD COLUMN is_current BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE shuihuo_asset_images ADD COLUMN asset_name_snapshot VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE shuihuo_asset_images ADD COLUMN asset_category_snapshot VARCHAR(32) NOT NULL DEFAULT '';
ALTER TABLE shuihuo_asset_images ADD COLUMN asset_prompt_snapshot MEDIUMTEXT NOT NULL;
`

const shuihuoAccountAPITextModelMigrationSQL = `
INSERT INTO model_definitions(name, kind, adapter_kind, enabled, allowed_roles_json, parameter_schema_json)
VALUES('当前账号 API 文本模型', 'text', 'text_completion', TRUE, JSON_ARRAY(), JSON_OBJECT())
ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id);

INSERT INTO model_versions(model_definition_id, version_number, credential_ref, endpoint, request_template, response_mapping, created_by)
SELECT d.id, 1, 'account_api_config', '', NULL, NULL, NULL
FROM model_definitions d
WHERE d.name = '当前账号 API 文本模型'
  AND NOT EXISTS (
    SELECT 1 FROM model_versions v
    WHERE v.model_definition_id = d.id AND v.version_number = 1
  );
`

const shuihuoUserConfigDefaultsMigrationSQL = `
CREATE TABLE IF NOT EXISTS shuihuo_user_configs (
  user_id BIGINT PRIMARY KEY,
  character_prefix MEDIUMTEXT NOT NULL,
  image_prefix MEDIUMTEXT NOT NULL,
  image_suffix MEDIUMTEXT NOT NULL,
  video_prefix MEDIUMTEXT NOT NULL,
  video_suffix MEDIUMTEXT NOT NULL,
  text_model_id BIGINT NULL,
  image_model_id BIGINT NULL,
  video_model_id BIGINT NULL,
  audio_model_id BIGINT NULL,
  jianying_draft_directory VARCHAR(1024) NOT NULL DEFAULT '',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_shuihuo_user_configs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`

const shuihuoAnalysisSnapshotsMigrationSQL = `
CREATE TABLE IF NOT EXISTS shuihuo_prompt_snapshots (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  model_id BIGINT NOT NULL,
  model_version_id BIGINT NOT NULL,
  purpose VARCHAR(64) NOT NULL,
  base_prompt_version_id BIGINT NOT NULL,
  addon_prompt_version_ids JSON NULL,
  rendered_prompt MEDIUMTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_shuihuo_prompt_snapshots_project_created (project_id, created_at),
  CONSTRAINT fk_shuihuo_prompt_snapshots_project FOREIGN KEY (project_id) REFERENCES shuihuo_projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_shuihuo_prompt_snapshots_model FOREIGN KEY (model_id) REFERENCES model_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_shuihuo_prompt_snapshots_model_version FOREIGN KEY (model_version_id) REFERENCES model_versions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_shuihuo_prompt_snapshots_base_prompt FOREIGN KEY (base_prompt_version_id) REFERENCES prompt_versions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`

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

func addShuihuoNegativePromptColumns(ctx context.Context, conn *sql.Conn) error {
	negativeExists, err := mysqlColumnExists(ctx, conn, "shuihuo_segments", "negative_prompt")
	if err != nil {
		return err
	}
	if !negativeExists {
		if _, err := conn.ExecContext(ctx, "ALTER TABLE shuihuo_segments ADD COLUMN negative_prompt MEDIUMTEXT NULL AFTER video_prompt"); err != nil {
			return err
		}
		if _, err := conn.ExecContext(ctx, "UPDATE shuihuo_segments SET negative_prompt = '' WHERE negative_prompt IS NULL"); err != nil {
			return err
		}
		if _, err := conn.ExecContext(ctx, "ALTER TABLE shuihuo_segments MODIFY COLUMN negative_prompt MEDIUMTEXT NOT NULL"); err != nil {
			return err
		}
	}
	lockedExists, err := mysqlColumnExists(ctx, conn, "shuihuo_segments", "negative_prompt_locked")
	if err != nil {
		return err
	}
	if !lockedExists {
		if _, err := conn.ExecContext(ctx, "ALTER TABLE shuihuo_segments ADD COLUMN negative_prompt_locked BOOLEAN NOT NULL DEFAULT FALSE AFTER video_prompt_locked"); err != nil {
			return err
		}
	}
	return nil
}

func addShuihuoUserConfigAudioModel(ctx context.Context, conn *sql.Conn) error {
	if err := applySQLStatements(ctx, conn, shuihuoUserConfigDefaultsMigrationSQL); err != nil {
		return err
	}
	exists, err := mysqlColumnExists(ctx, conn, "shuihuo_user_configs", "audio_model_id")
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	_, err = conn.ExecContext(ctx, "ALTER TABLE shuihuo_user_configs ADD COLUMN audio_model_id BIGINT NULL AFTER video_model_id")
	return err
}

func applyShuihuoProductionSchema(ctx context.Context, conn *sql.Conn) error {
	return applySQLStatements(ctx, conn, shuihuoProductionMigrationSQL)
}

func applyShuihuoGovernanceSchema(ctx context.Context, conn *sql.Conn) error {
	return applySQLStatements(ctx, conn, shuihuoGovernanceMigrationSQL)
}

func applyShuihuoSourceUnitSchema(ctx context.Context, conn *sql.Conn) error {
	return applyShuihuoSourceUnitMigration(ctx, conn)
}

type migrationExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func applyShuihuoSourceUnitMigration(ctx context.Context, executor migrationExecutor) error {
	if err := applySQLStatementsWithExecutor(ctx, executor, shuihuoSourceUnitMigrationSQL); err != nil {
		return err
	}
	return backfillLegacyShuihuoSourceUnits(ctx, executor)
}

func backfillLegacyShuihuoSourceUnits(ctx context.Context, executor migrationExecutor) error {
	// A migration may be retried after DDL succeeds but before the migration marker
	// is recorded. The legacy identity (project/order/source kind) makes this backfill
	// repeatable without creating another source unit or mapping.
	if _, err := executor.ExecContext(ctx, `
INSERT INTO shuihuo_source_units(project_id, text, source_kind, source_order)
SELECT s.project_id, s.source_text, 'legacy_segment', s.order_index
FROM shuihuo_segments s
LEFT JOIN shuihuo_segment_source_units m ON m.segment_id = s.id
LEFT JOIN shuihuo_source_units u
  ON u.project_id = s.project_id
 AND u.source_kind = 'legacy_segment'
 AND u.source_order = s.order_index
WHERE m.segment_id IS NULL AND u.id IS NULL`); err != nil {
		return err
	}
	_, err := executor.ExecContext(ctx, `
INSERT IGNORE INTO shuihuo_segment_source_units(segment_id, source_unit_id, position_index)
SELECT s.id, u.id, 1
FROM shuihuo_segments s
JOIN shuihuo_source_units u
  ON u.project_id = s.project_id
 AND u.source_kind = 'legacy_segment'
 AND u.source_order = s.order_index
LEFT JOIN shuihuo_segment_source_units m ON m.segment_id = s.id
WHERE m.segment_id IS NULL`)
	return err
}

func ensureShuihuoSourceUnitOrderUnique(ctx context.Context, conn *sql.Conn) error {
	return ensureShuihuoSourceUnitOrderUniqueWithExecutor(
		ctx,
		sourceUnitOrderSQLExecutor{conn: conn},
		func(ctx context.Context) (bool, error) {
			return mysqlIndexExists(ctx, conn, "shuihuo_source_units", "uniq_shuihuo_source_units_project_order")
		},
	)
}

func addShuihuoSourceUnitSegmentationVersions(ctx context.Context, conn *sql.Conn) error {
	exists, err := mysqlColumnExists(ctx, conn, "shuihuo_source_units", "segmentation_version")
	if err != nil {
		return err
	}
	if !exists {
		if _, err := conn.ExecContext(ctx, `ALTER TABLE shuihuo_source_units ADD COLUMN segmentation_version INT NOT NULL DEFAULT 0 AFTER source_kind`); err != nil {
			return err
		}
		if _, err := conn.ExecContext(ctx, `
UPDATE shuihuo_source_units u
JOIN shuihuo_projects p ON p.id = u.project_id
SET u.segmentation_version = p.segmentation_version`); err != nil {
			return err
		}
	}
	oldIndexExists, err := mysqlIndexExists(ctx, conn, "shuihuo_source_units", "uniq_shuihuo_source_units_project_order")
	if err != nil {
		return err
	}
	if oldIndexExists {
		if _, err := conn.ExecContext(ctx, `ALTER TABLE shuihuo_source_units DROP INDEX uniq_shuihuo_source_units_project_order`); err != nil {
			return err
		}
	}
	versionIndexExists, err := mysqlIndexExists(ctx, conn, "shuihuo_source_units", "uniq_shuihuo_source_units_project_version_order")
	if err != nil {
		return err
	}
	if !versionIndexExists {
		if _, err := conn.ExecContext(ctx, `ALTER TABLE shuihuo_source_units ADD UNIQUE KEY uniq_shuihuo_source_units_project_version_order (project_id, segmentation_version, source_order)`); err != nil {
			return err
		}
	}
	return applySQLStatements(ctx, conn, shuihuoSourceUnitHistoryMigrationSQL)
}

type sourceUnitOrderRows interface {
	Close() error
	Err() error
	Next() bool
	Scan(...any) error
}

type sourceUnitOrderMigrationExecutor interface {
	migrationExecutor
	QueryContext(context.Context, string, ...any) (sourceUnitOrderRows, error)
}

type sourceUnitOrderSQLExecutor struct {
	conn *sql.Conn
}

func (e sourceUnitOrderSQLExecutor) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return e.conn.ExecContext(ctx, query, args...)
}

func (e sourceUnitOrderSQLExecutor) QueryContext(ctx context.Context, query string, args ...any) (sourceUnitOrderRows, error) {
	return e.conn.QueryContext(ctx, query, args...)
}

func ensureShuihuoSourceUnitOrderUniqueWithExecutor(
	ctx context.Context,
	executor sourceUnitOrderMigrationExecutor,
	indexExists func(context.Context) (bool, error),
) error {
	exists, err := indexExists(ctx)
	if err != nil || exists {
		return err
	}
	rows, err := executor.QueryContext(ctx, `
SELECT id, project_id
FROM shuihuo_source_units
ORDER BY project_id ASC, source_order ASC, id ASC`)
	if err != nil {
		return err
	}
	defer rows.Close()
	ordered := make([]sourceUnitOrder, 0)
	for rows.Next() {
		var item sourceUnitOrder
		if err := rows.Scan(&item.id, &item.projectID); err != nil {
			return err
		}
		ordered = append(ordered, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, item := range normalizedSourceUnitOrders(ordered) {
		if _, err := executor.ExecContext(ctx, `UPDATE shuihuo_source_units SET source_order = ? WHERE id = ?`, item.sourceOrder, item.id); err != nil {
			return err
		}
	}
	_, err = executor.ExecContext(ctx, `ALTER TABLE shuihuo_source_units ADD UNIQUE KEY uniq_shuihuo_source_units_project_order (project_id, source_order)`)
	return err
}

type sourceUnitOrder struct {
	id, projectID int64
	sourceOrder   int
}

// input must already be ordered by project_id, source_order, id, matching the
// migration query. Assigning fresh positions makes duplicate legacy values safe.
func normalizedSourceUnitOrders(ordered []sourceUnitOrder) []sourceUnitOrder {
	result := append([]sourceUnitOrder(nil), ordered...)
	positions := make(map[int64]int)
	for index := range result {
		positions[result[index].projectID]++
		result[index].sourceOrder = positions[result[index].projectID]
	}
	return result
}

func addShuihuoAssetCategory(ctx context.Context, conn *sql.Conn) error {
	exists, err := mysqlColumnExists(ctx, conn, "shuihuo_assets", "category")
	if err != nil || exists {
		return err
	}
	_, err = conn.ExecContext(ctx, "ALTER TABLE shuihuo_assets ADD COLUMN category VARCHAR(32) NOT NULL DEFAULT 'character' AFTER asset_type_id")
	return err
}

func addShuihuoTaskPolling(ctx context.Context, conn *sql.Conn) error {
	exists, err := mysqlColumnExists(ctx, conn, "shuihuo_tasks", "next_poll_at")
	if err != nil {
		return err
	}
	if !exists {
		if _, err := conn.ExecContext(ctx, "ALTER TABLE shuihuo_tasks ADD COLUMN next_poll_at DATETIME NULL AFTER provider_task_id"); err != nil {
			return err
		}
	}
	indexExists, err := mysqlIndexExists(ctx, conn, "shuihuo_tasks", "idx_shuihuo_tasks_provider_status_poll")
	if err != nil {
		return err
	}
	if !indexExists {
		_, err = conn.ExecContext(ctx, "CREATE INDEX idx_shuihuo_tasks_provider_status_poll ON shuihuo_tasks(provider, status, next_poll_at)")
	}
	return err
}

func addShuihuoImportCompensationRecovery(ctx context.Context, conn *sql.Conn) error {
	return applyShuihuoImportCompensationMigrationWithExecutor(
		ctx,
		migrationSQLExecutor{conn: conn},
		func(ctx context.Context, column string) (bool, error) {
			return mysqlColumnExists(ctx, conn, "shuihuo_object_cleanup_queue", column)
		},
		func(ctx context.Context, index string) (bool, error) {
			return mysqlIndexExists(ctx, conn, "shuihuo_object_cleanup_queue", index)
		},
	)
}

func addShuihuoAssetPromptSelectionColumns(ctx context.Context, conn *sql.Conn) error {
	return applyShuihuoAssetPromptSelectionMigrationWithExecutor(
		ctx,
		migrationSQLExecutor{conn: conn},
		func(ctx context.Context, column string) (bool, error) {
			return mysqlColumnExists(ctx, conn, "shuihuo_asset_generation_configs", column)
		},
	)
}

func addShuihuoAssetPresetImageColumns(ctx context.Context, conn *sql.Conn) error {
	if err := applySQLStatements(ctx, conn, shuihuoAssetPresetImageMigrationSQL); err != nil {
		return err
	}
	return applyShuihuoAssetPresetImageColumnsWithExecutor(ctx, migrationSQLExecutor{conn: conn}, func(ctx context.Context, column string) (bool, error) {
		return mysqlColumnExists(ctx, conn, "shuihuo_asset_generation_configs", column)
	})
}

func addShuihuoAssetHistoryColumns(ctx context.Context, conn *sql.Conn) error {
	columns := []struct {
		table, name, definition string
	}{
		{"shuihuo_assets", "is_current", "BOOLEAN NOT NULL DEFAULT TRUE"},
		{"shuihuo_asset_images", "asset_name_snapshot", "VARCHAR(255) NOT NULL DEFAULT ''"},
		{"shuihuo_asset_images", "asset_category_snapshot", "VARCHAR(32) NOT NULL DEFAULT ''"},
		{"shuihuo_asset_images", "asset_prompt_snapshot", "MEDIUMTEXT NOT NULL"},
	}
	for _, column := range columns {
		exists, err := mysqlColumnExists(ctx, conn, column.table, column.name)
		if err != nil {
			return err
		}
		if !exists {
			if _, err := conn.ExecContext(ctx, "ALTER TABLE "+column.table+" ADD COLUMN "+column.name+" "+column.definition); err != nil {
				return err
			}
		}
	}
	_, err := conn.ExecContext(ctx, `UPDATE shuihuo_asset_images i JOIN shuihuo_assets a ON a.id = i.asset_id
SET i.asset_name_snapshot = a.name, i.asset_category_snapshot = a.category, i.asset_prompt_snapshot = a.prompt
WHERE i.asset_name_snapshot = '' AND i.asset_category_snapshot = '' AND i.asset_prompt_snapshot = ''`)
	return err
}

type modelCenterCatalogColumn struct {
	table      string
	name       string
	definition string
}

var modelCenterCatalogColumns = []modelCenterCatalogColumn{
	{table: "model_definitions", name: "model_key", definition: "VARCHAR(128) NOT NULL DEFAULT ''"},
	{table: "model_definitions", name: "hidden", definition: "BOOLEAN NOT NULL DEFAULT FALSE"},
	{table: "model_definitions", name: "sort_order", definition: "INT NOT NULL DEFAULT 0"},
	{table: "model_definitions", name: "admin_note", definition: "MEDIUMTEXT NOT NULL DEFAULT ''"},
	{table: "model_versions", name: "base_domain", definition: "VARCHAR(512) NOT NULL DEFAULT ''"},
	{table: "model_versions", name: "base_path", definition: "VARCHAR(1024) NOT NULL DEFAULT ''"},
	{table: "model_versions", name: "polling_template", definition: "MEDIUMTEXT NULL"},
	{table: "model_versions", name: "image_input_format", definition: "VARCHAR(16) NOT NULL DEFAULT 'url'"},
	{table: "model_versions", name: "image_request_mode", definition: "VARCHAR(16) NOT NULL DEFAULT 'json'"},
	{table: "model_versions", name: "runtime_policy_json", definition: "JSON NULL"},
}

const modelCenterCatalogBackfillSQL = `UPDATE model_definitions
SET model_key = CONCAT('legacy-', LOWER(kind), '-', id)
WHERE model_key = ''`

const modelCenterCatalogUniqueIndexSQL = "ALTER TABLE model_definitions ADD UNIQUE KEY uniq_model_definition_key (model_key)"

func modelCenterCatalogAddColumnSQL(column modelCenterCatalogColumn) string {
	return "ALTER TABLE " + column.table + " ADD COLUMN " + column.name + " " + column.definition
}

func addModelCenterCatalogColumns(ctx context.Context, conn *sql.Conn) error {
	return applyModelCenterCatalogMigrationWithExecutor(
		ctx,
		migrationSQLExecutor{conn: conn},
		func(ctx context.Context, table, column string) (bool, error) {
			return mysqlColumnExists(ctx, conn, table, column)
		},
		func(ctx context.Context, table, index string) (bool, error) {
			return mysqlIndexExists(ctx, conn, table, index)
		},
		func(ctx context.Context) (string, error) {
			return findModelCenterCatalogKeyCollision(ctx, conn)
		},
	)
}

func applyModelCenterCatalogMigrationWithExecutor(
	ctx context.Context,
	executor migrationExecutor,
	columnExists func(context.Context, string, string) (bool, error),
	indexExists func(context.Context, string, string) (bool, error),
	findCollision func(context.Context) (string, error),
) error {
	for _, column := range modelCenterCatalogColumns {
		exists, err := columnExists(ctx, column.table, column.name)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		if _, err := executor.ExecContext(ctx, modelCenterCatalogAddColumnSQL(column)); err != nil {
			return err
		}
	}

	collision, err := findCollision(ctx)
	if err != nil {
		return err
	}
	if collision != "" {
		return fmt.Errorf("model key collision: %q", collision)
	}
	if _, err := executor.ExecContext(ctx, modelCenterCatalogBackfillSQL); err != nil {
		return err
	}

	hasIndex, err := indexExists(ctx, "model_definitions", "uniq_model_definition_key")
	if err != nil {
		return err
	}
	if hasIndex {
		return nil
	}
	_, err = executor.ExecContext(ctx, modelCenterCatalogUniqueIndexSQL)
	return err
}

func findModelCenterCatalogKeyCollision(ctx context.Context, conn *sql.Conn) (string, error) {
	var key string
	err := conn.QueryRowContext(ctx, `
SELECT candidate_key
FROM (
  SELECT model_key AS candidate_key
  FROM model_definitions
  WHERE model_key <> ''
  UNION ALL
  SELECT CONCAT('legacy-', LOWER(kind), '-', id) AS candidate_key
  FROM model_definitions
  WHERE model_key = ''
) AS model_keys
GROUP BY candidate_key
HAVING COUNT(*) > 1
LIMIT 1`).Scan(&key)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return key, err
}

func applyShuihuoAssetPresetImageColumnsWithExecutor(ctx context.Context, executor assetPromptSelectionMigrationExecutor, columnExists func(context.Context, string) (bool, error)) error {
	for _, column := range []struct {
		name       string
		definition string
	}{
		{name: "style_id", definition: "BIGINT NULL"},
		{name: "character_sheet_preset_id", definition: "VARCHAR(64) NULL"},
	} {
		exists, err := columnExists(ctx, column.name)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		if _, err := executor.ExecContext(ctx, "ALTER TABLE shuihuo_asset_generation_configs ADD COLUMN "+column.name+" "+column.definition); err != nil {
			return err
		}
	}
	return nil
}

func applyShuihuoAccountAPITextModelMigration(ctx context.Context, conn *sql.Conn) error {
	return applySQLStatements(ctx, conn, shuihuoAccountAPITextModelMigrationSQL)
}

type migrationSQLExecutor struct{ conn *sql.Conn }

func (e migrationSQLExecutor) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return e.conn.ExecContext(ctx, query, args...)
}

func applyShuihuoAssetPromptSelectionMigrationWithExecutor(
	ctx context.Context,
	executor assetPromptSelectionMigrationExecutor,
	columnExists func(context.Context, string) (bool, error),
) error {
	for _, column := range []struct {
		name       string
		definition string
	}{
		{name: "character_preset_id", definition: "VARCHAR(64) NULL"},
		{name: "scene_preset_id", definition: "VARCHAR(64) NULL"},
	} {
		exists, err := columnExists(ctx, column.name)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		if _, err := executor.ExecContext(ctx, "ALTER TABLE shuihuo_asset_generation_configs ADD COLUMN "+column.name+" "+column.definition); err != nil {
			return err
		}
	}
	return nil
}

type assetPromptSelectionMigrationExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func applyShuihuoImportCompensationMigrationWithExecutor(
	ctx context.Context,
	executor migrationExecutor,
	columnExists func(context.Context, string) (bool, error),
	indexExists func(context.Context, string) (bool, error),
) error {
	columns := []struct {
		name       string
		definition string
	}{
		{name: "lease_token", definition: "VARCHAR(64) NOT NULL DEFAULT ''"},
		{name: "lease_expires_at", definition: "DATETIME NULL"},
	}
	for _, column := range columns {
		exists, err := columnExists(ctx, column.name)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		if _, err := executor.ExecContext(ctx, "ALTER TABLE shuihuo_object_cleanup_queue ADD COLUMN "+column.name+" "+column.definition); err != nil {
			return err
		}
	}
	hasIndex, err := indexExists(ctx, "idx_shuihuo_object_cleanup_lease")
	if err != nil {
		return err
	}
	if !hasIndex {
		if _, err := executor.ExecContext(ctx, "ALTER TABLE shuihuo_object_cleanup_queue ADD KEY idx_shuihuo_object_cleanup_lease (lease_expires_at, created_at, id)"); err != nil {
			return err
		}
	}
	return applySQLStatementsWithExecutor(ctx, executor, shuihuoImportCompensationMigrationSQL)
}

func seedShuihuoAnalysisPrompts(ctx context.Context, conn *sql.Conn) error {
	if err := applySQLStatements(ctx, conn, shuihuoAnalysisSnapshotsMigrationSQL); err != nil {
		return err
	}
	for _, preset := range []struct{ purpose, name, body string }{
		{"segmentation", "智能分段", "你是小说视频生产的分段分析服务。只依据输入原文，不得编造人物、情节、因果或结局。只返回 JSON 数组，不要 Markdown 或代码围栏。数组每项必须是 {\\\"text\\\":\\\"原文分段\\\"}。\\n\\n原文：{{novel_text}}"},
		{"assets", "资产候选", "你是小说视频生产的资产分析服务。只依据输入原文，不得编造人物、场景、道具、关系或剧情。只返回 JSON 数组，不要 Markdown 或代码围栏。数组每项必须为 {\\\"category\\\":\\\"character|scene|prop\\\",\\\"name\\\":\\\"名称\\\",\\\"prompt\\\":\\\"可拍摄的视觉提示词\\\"}。\\n\\n原文：{{novel_text}}"},
	} {
		result, err := conn.ExecContext(ctx, `INSERT INTO prompt_definitions(module, purpose, name, enabled) VALUES('shuihuo-production', ?, ?, TRUE) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`, preset.purpose, preset.name)
		if err != nil {
			return err
		}
		definitionID, err := result.LastInsertId()
		if err != nil {
			return err
		}
		var count int
		if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM prompt_versions WHERE prompt_definition_id = ?`, definitionID).Scan(&count); err != nil {
			return err
		}
		if count == 0 {
			if _, err := conn.ExecContext(ctx, `INSERT INTO prompt_versions(prompt_definition_id, version_number, parameters_json, body) VALUES(?, 1, JSON_ARRAY('novel_text'), ?)`, definitionID, preset.body); err != nil {
				return err
			}
		}
	}
	return nil
}

func applySQLStatements(ctx context.Context, conn *sql.Conn, script string) error {
	return applySQLStatementsWithExecutor(ctx, conn, script)
}

func applySQLStatementsWithExecutor(ctx context.Context, executor migrationExecutor, script string) error {
	for _, statement := range strings.Split(script, ";") {
		statement = strings.TrimSpace(statement)
		if statement == "" {
			continue
		}
		if _, err := executor.ExecContext(ctx, statement); err != nil {
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

func mysqlIndexExists(ctx context.Context, conn *sql.Conn, table, index string) (bool, error) {
	var count int
	err := conn.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
`, table, index).Scan(&count)
	return count > 0, err
}
