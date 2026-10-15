package storage

func WechatMiniProgramMigrations() []Migration {
	return []Migration{{Version: 7801003, CallbackChecksum: "wechat-miniprogram-auth-v1", SQL: []string{
		`CREATE TABLE IF NOT EXISTS wechat_miniprogram_identities (
  identity_hash CHAR(64) NOT NULL PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  KEY idx_wechat_miniprogram_identities_username (username)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS wechat_miniprogram_binding_tickets (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  identity_hash CHAR(64) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY idx_wechat_miniprogram_tickets_expiry (expires_at)
) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS wechat_miniprogram_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY idx_wechat_miniprogram_sessions_username (username),
  KEY idx_wechat_miniprogram_sessions_expiry (expires_at)
) ENGINE=InnoDB`,
	}}}
}
