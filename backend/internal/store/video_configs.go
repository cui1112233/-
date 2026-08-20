package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

const YDVideoProvider = "yd_video"

type VideoAPIConfig struct {
	Provider         string
	APIKeyCiphertext string
}

func (cfg VideoAPIConfig) Configured() bool {
	return cfg.Provider == YDVideoProvider && strings.TrimSpace(cfg.APIKeyCiphertext) != ""
}

type VideoConfigs struct {
	db *sql.DB
}

func NewVideoConfigs(db *sql.DB) *VideoConfigs {
	return &VideoConfigs{db: db}
}

func (s *VideoConfigs) Get(ctx context.Context, userID int64) (VideoAPIConfig, error) {
	var cfg VideoAPIConfig
	err := s.db.QueryRowContext(ctx, `
SELECT provider, api_key_ciphertext
FROM video_api_configs
WHERE user_id = ?
`, userID).Scan(&cfg.Provider, &cfg.APIKeyCiphertext)
	if errors.Is(err, sql.ErrNoRows) {
		return VideoAPIConfig{Provider: YDVideoProvider}, nil
	}
	return cfg, err
}

func (s *VideoConfigs) Save(ctx context.Context, userID int64, cfg VideoAPIConfig) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO video_api_configs(user_id, provider, api_key_ciphertext)
VALUES(?, ?, ?)
ON DUPLICATE KEY UPDATE
  provider = VALUES(provider),
  api_key_ciphertext = VALUES(api_key_ciphertext)
`, userID, cfg.Provider, cfg.APIKeyCiphertext)
	return err
}
