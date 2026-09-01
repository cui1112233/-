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

func NovelFetchWorkshopMigrations() []Migration {
	return []Migration{{Version: 1200001, SQL: NovelFetchWorkshopStatements(), CallbackChecksum: "novel-fetch-workshop-v1"}}
}
