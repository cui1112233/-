package store

import (
	"context"
	"database/sql"
	"errors"
)

type APIConfig struct {
	Provider         string
	BaseURL          string
	Model            string
	APIKeyCiphertext string
}

type Configs struct {
	db *sql.DB
}

func NewConfigs(db *sql.DB) *Configs {
	return &Configs{db: db}
}

func (s *Configs) Get(ctx context.Context, userID int64) (APIConfig, error) {
	var cfg APIConfig
	err := s.db.QueryRowContext(ctx, `
SELECT provider, base_url, model, api_key_ciphertext
FROM api_configs
WHERE user_id = ?
`, userID).Scan(&cfg.Provider, &cfg.BaseURL, &cfg.Model, &cfg.APIKeyCiphertext)
	if errors.Is(err, sql.ErrNoRows) {
		return APIConfig{
			Provider: "openai",
			BaseURL:  "https://api.openai.com/v1",
			Model:    "gpt-4o-mini",
		}, nil
	}
	return cfg, err
}

func (s *Configs) Save(ctx context.Context, userID int64, cfg APIConfig) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO api_configs(user_id, provider, base_url, model, api_key_ciphertext)
VALUES(?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  provider = VALUES(provider),
  base_url = VALUES(base_url),
  model = VALUES(model),
  api_key_ciphertext = VALUES(api_key_ciphertext)
`, userID, cfg.Provider, cfg.BaseURL, cfg.Model, cfg.APIKeyCiphertext)
	return err
}
