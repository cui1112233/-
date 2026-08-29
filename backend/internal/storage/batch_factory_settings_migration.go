package storage

const batchFactorySettingsMigrationSQL = `
CREATE TABLE IF NOT EXISTS shuihuo_batch_factory_settings (
  user_id BIGINT NOT NULL,
  batch_id VARCHAR(96) NOT NULL,
  scope VARCHAR(16) NOT NULL,
  item_id VARCHAR(96) NOT NULL DEFAULT '',
  video_id VARCHAR(96) NOT NULL DEFAULT '',
  settings_json JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, batch_id, scope, item_id, video_id),
  KEY idx_shuihuo_batch_factory_settings_batch (user_id, batch_id),
  CONSTRAINT chk_shuihuo_batch_factory_settings_scope CHECK (scope IN ('batch', 'item', 'video')),
  CONSTRAINT fk_shuihuo_batch_factory_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`

func init() {
	migrations = append(migrations, migration{version: 28, sql: batchFactorySettingsMigrationSQL})
}
