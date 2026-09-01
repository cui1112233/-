package storage

func LocalExecutorStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS local_executor_pairings (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  code_hash BINARY(32) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  consumed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_local_executor_pairings_code_hash (code_hash),
  KEY idx_local_executor_pairings_owner_created (owner_username, created_at)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS local_executors (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  token_hash BINARY(32) NOT NULL,
  device_name VARCHAR(191) NOT NULL DEFAULT '',
  os VARCHAR(32) NOT NULL DEFAULT '',
  app_version VARCHAR(64) NOT NULL DEFAULT '',
  accounts_total INT NOT NULL DEFAULT 0,
  accounts_available INT NOT NULL DEFAULT 0,
  accounts_busy INT NOT NULL DEFAULT 0,
  accounts_quota_exhausted INT NOT NULL DEFAULT 0,
  accounts_login_error INT NOT NULL DEFAULT 0,
  accounts_human_verification INT NOT NULL DEFAULT 0,
  last_seen_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_local_executors_token_hash (token_hash),
  KEY idx_local_executors_owner_updated (owner_username, updated_at)
) ENGINE=InnoDB`,
	}
}

func LocalExecutorMigrations() []Migration {
	return []Migration{{Version: 7801001, SQL: LocalExecutorStatements(), CallbackChecksum: "v78-local-executor-control-plane-v1"}}
}

func AppMigrations() []Migration {
	out := append([]Migration(nil), V11Migrations()...)
	out = append(out, LocalExecutorMigrations()...)
	return out
}
