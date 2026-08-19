package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

const OpenAICompatibleImageProvider = "openai_compatible"

type ImageAPIConfig struct {
	Provider         string
	DisplayName      string
	BaseURL          string
	Model            string
	APIKeyCiphertext string
}

func (cfg ImageAPIConfig) Configured() bool {
	return cfg.Provider == OpenAICompatibleImageProvider &&
		strings.TrimSpace(cfg.BaseURL) != "" &&
		strings.TrimSpace(cfg.Model) != "" &&
		strings.TrimSpace(cfg.APIKeyCiphertext) != ""
}

type ImageConfigs struct {
	db *sql.DB
}

func NewImageConfigs(db *sql.DB) *ImageConfigs {
	return &ImageConfigs{db: db}
}

func (s *ImageConfigs) Get(ctx context.Context, userID int64) (ImageAPIConfig, error) {
	var cfg ImageAPIConfig
	err := s.db.QueryRowContext(ctx, `
SELECT provider, display_name, base_url, model, api_key_ciphertext
FROM image_api_configs
WHERE user_id = ?
`, userID).Scan(&cfg.Provider, &cfg.DisplayName, &cfg.BaseURL, &cfg.Model, &cfg.APIKeyCiphertext)
	if errors.Is(err, sql.ErrNoRows) {
		return ImageAPIConfig{}, nil
	}
	return cfg, err
}

func (s *ImageConfigs) Save(ctx context.Context, userID int64, cfg ImageAPIConfig) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO image_api_configs(user_id, provider, display_name, base_url, model, api_key_ciphertext)
VALUES(?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  provider = VALUES(provider),
  display_name = VALUES(display_name),
  base_url = VALUES(base_url),
  model = VALUES(model),
  api_key_ciphertext = VALUES(api_key_ciphertext)
`, userID, cfg.Provider, cfg.DisplayName, cfg.BaseURL, cfg.Model, cfg.APIKeyCiphertext)
	return err
}
