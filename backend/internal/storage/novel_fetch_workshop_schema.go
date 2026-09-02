package storage

func NovelFetchWorkshopStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS novel_fetch_workshop_documents (
  owner_username VARCHAR(191) NOT NULL,
  book_id VARCHAR(191) NOT NULL,
  document_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (owner_username, book_id),
  KEY idx_nfw_documents_owner_updated (owner_username, updated_at)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS novel_fetch_workshop_configs (
  owner_username VARCHAR(191) NOT NULL PRIMARY KEY,
  settings_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB`,
	}
}

func NovelFetchWorkshopBodyStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS novel_fetch_workshop_bodies (
  owner_username VARCHAR(191) NOT NULL,
  book_id VARCHAR(191) NOT NULL,
  version_id VARCHAR(64) NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  content_encoding VARCHAR(16) NOT NULL DEFAULT 'gzip',
  content_blob LONGBLOB NOT NULL,
  content_hash CHAR(64) NOT NULL,
  char_count BIGINT UNSIGNED NOT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'ready',
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  last_needed_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NULL,
  PRIMARY KEY (owner_username, book_id, version_id),
  KEY idx_nfw_bodies_owner_updated (owner_username, updated_at),
  KEY idx_nfw_bodies_owner_expiry (owner_username, expires_at)
) ENGINE=InnoDB`,
	}
}

func NovelFetchWorkshopMigrations() []Migration {
	return []Migration{
		{Version: 1200001, SQL: NovelFetchWorkshopStatements(), CallbackChecksum: "novel-fetch-workshop-v1"},
		{Version: 1200002, SQL: NovelFetchWorkshopBodyStatements(), CallbackChecksum: "novel-fetch-workshop-v2-bodies"},
	}
}
