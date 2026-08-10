package legacy

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type indexFile struct {
	Entries []entry `json:"entries"`
}

type entry struct {
	ID         string `json:"id"`
	Filename   string `json:"filename"`
	Format     string `json:"format"`
	FormatName string `json:"formatName"`
	Mode       string `json:"mode"`
	Duration   string `json:"duration"`
	Preview    string `json:"preview"`
	Output     string `json:"output"`
	CreatedAt  string `json:"createdAt"`
}

func Import(ctx context.Context, db *sql.DB, sourceDir string, defaultPasswordHash string) error {
	userDirs, err := os.ReadDir(sourceDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, userDir := range userDirs {
		if !userDir.IsDir() {
			continue
		}
		username := userDir.Name()
		userID, err := ensureUser(ctx, db, username, defaultPasswordHash)
		if err != nil {
			return err
		}
		if err := importConfig(ctx, db, userID, filepath.Join(sourceDir, username, "api-config.json")); err != nil {
			return err
		}
		if err := importHistory(ctx, db, userID, filepath.Join(sourceDir, username, "outputs")); err != nil {
			return err
		}
	}
	return nil
}

func ensureUser(ctx context.Context, db *sql.DB, username string, defaultPasswordHash string) (int64, error) {
	_, err := db.ExecContext(ctx, `
INSERT INTO users(username, password_hash)
VALUES(?, ?)
ON DUPLICATE KEY UPDATE password_hash = IF(password_hash = '', VALUES(password_hash), password_hash)
`, username, defaultPasswordHash)
	if err != nil {
		return 0, err
	}
	var userID int64
	err = db.QueryRowContext(ctx, "SELECT id FROM users WHERE username = ?", username).Scan(&userID)
	return userID, err
}

func importConfig(ctx context.Context, db *sql.DB, userID int64, configPath string) error {
	raw, err := os.ReadFile(configPath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var cfg struct {
		Provider string `json:"provider"`
		BaseURL  string `json:"baseUrl"`
		Model    string `json:"model"`
		APIKey   string `json:"apiKey"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `
INSERT INTO api_configs(user_id, provider, base_url, model, api_key_ciphertext)
VALUES(?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  provider = VALUES(provider),
  base_url = VALUES(base_url),
  model = VALUES(model),
  api_key_ciphertext = VALUES(api_key_ciphertext)
`, userID, first(cfg.Provider, "openai"), first(cfg.BaseURL, "https://api.openai.com/v1"), first(cfg.Model, "gpt-4o-mini"), cfg.APIKey)
	return err
}

func importHistory(ctx context.Context, db *sql.DB, userID int64, outputsDir string) error {
	raw, err := os.ReadFile(filepath.Join(outputsDir, "index.json"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var idx indexFile
	if err := json.Unmarshal(raw, &idx); err != nil {
		return err
	}
	for _, item := range idx.Entries {
		output := item.Output
		if output == "" && item.Filename != "" {
			body, err := os.ReadFile(filepath.Join(outputsDir, filepath.Base(item.Filename)))
			if err == nil {
				output = stripHeader(string(body))
			}
		}
		createdAt := time.Now()
		if item.CreatedAt != "" {
			if parsed, err := time.Parse(time.RFC3339, item.CreatedAt); err == nil {
				createdAt = parsed
			}
		}
		_, err := db.ExecContext(ctx, `
INSERT INTO generation_histories(user_id, external_id, mode, format, format_name, duration, preview, output, created_at)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE output = VALUES(output), preview = VALUES(preview)
`, userID, item.ID, first(item.Mode, "continuous"), item.Format, item.FormatName, first(item.Duration, "10s"), first(item.Preview, makePreview(output)), output, createdAt)
		if err != nil {
			return err
		}
	}
	return nil
}

func stripHeader(content string) string {
	separator := "\n" + strings.Repeat("=", 40) + "\n\n"
	parts := strings.SplitN(content, separator, 2)
	if len(parts) == 2 {
		return parts[1]
	}
	return content
}

func makePreview(output string) string {
	clean := strings.ReplaceAll(output, "\n", " ")
	runes := []rune(clean)
	if len(runes) > 40 {
		return string(runes[:40])
	}
	return clean
}

func first(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
