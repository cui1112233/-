package storage

func V11FoundationStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_bridge_users (
  username VARCHAR(191) NOT NULL PRIMARY KEY,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_batches (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  KEY idx_bfv11_batches_owner (owner_username)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_books (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  owner_username VARCHAR(191) NOT NULL,
  ordinal INT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_bfv11_book_ordinal (batch_id, ordinal),
  KEY idx_bfv11_books_owner_batch (owner_username, batch_id)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_videos (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  book_id VARCHAR(64) NOT NULL,
  owner_username VARCHAR(191) NOT NULL,
  ordinal INT NOT NULL,
  compatibility_state VARCHAR(32) NOT NULL DEFAULT 'active',
  revision BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  KEY idx_bfv11_videos_owner_book (owner_username, book_id)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_migration_audits (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  migration_version BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  expected_checksum CHAR(64) NULL,
  recorded_checksum CHAR(64) NULL,
  detail TEXT NULL,
  created_at DATETIME(6) NOT NULL
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS batch_factory_v11_capability_settings (
  capability_key VARCHAR(96) NOT NULL PRIMARY KEY,
  available BOOLEAN NOT NULL DEFAULT FALSE,
  reason VARCHAR(255) NULL,
  updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB`,
	}
}

func V11FoundationMigrations() []Migration {
	return []Migration{{Version: 1100001, SQL: V11FoundationStatements(), CallbackChecksum: "batch-factory-v11-foundation-v1"}}
}
