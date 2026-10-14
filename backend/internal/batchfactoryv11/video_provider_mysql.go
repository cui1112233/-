package batchfactoryv11

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

// MySQLVideoProviderRegistry stores provider configuration by owner and
// provider. API keys are encrypted before they leave this process.
type MySQLVideoProviderRegistry struct {
	db  *sql.DB
	key []byte
}

func NewMySQLVideoProviderRegistry(db *sql.DB, key []byte) *MySQLVideoProviderRegistry {
	return &MySQLVideoProviderRegistry{db: db, key: append([]byte(nil), key...)}
}

// DeriveVideoProviderEncryptionKey keeps provider credentials separate from
// bridge signatures while relying on the already-required bridge secret.
func DeriveVideoProviderEncryptionKey(bridgeSecret string) []byte {
	sum := sha256.Sum256([]byte("batch-factory-v11-video-provider-config:v1\x00" + strings.TrimSpace(bridgeSecret)))
	return append([]byte(nil), sum[:]...)
}

func (r *MySQLVideoProviderRegistry) Put(ctx context.Context, owner string, cfg VideoProviderConfig) error {
	if r == nil || r.db == nil || len(r.key) != 32 {
		return ErrUnavailable
	}
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return fmt.Errorf("%w: owner is required", ErrInvalid)
	}
	var err error
	cfg, err = normalizeVideoProviderConfig(cfg)
	if err != nil {
		return err
	}
	keyID, nonce, ciphertext, err := encryptVideoProviderAPIKey(r.key, []byte(cfg.APIKey))
	if err != nil {
		return err
	}
	_, err = r.db.ExecContext(ctx, `INSERT INTO batch_factory_v11_video_provider_configs (owner_username,provider,model,create_url,tasks_url,result_url,workflow_id,key_id,api_key_nonce,api_key_ciphertext,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE model=VALUES(model),create_url=VALUES(create_url),tasks_url=VALUES(tasks_url),result_url=VALUES(result_url),workflow_id=VALUES(workflow_id),key_id=VALUES(key_id),api_key_nonce=VALUES(api_key_nonce),api_key_ciphertext=VALUES(api_key_ciphertext),updated_at=VALUES(updated_at)`, owner, cfg.Provider, cfg.Model, cfg.CreateURL, cfg.TasksURL, cfg.ResultURL, cfg.WorkflowID, keyID, nonce, ciphertext, time.Now().UTC(), time.Now().UTC())
	return err
}

func (r *MySQLVideoProviderRegistry) Resolve(ctx context.Context, owner, provider string) (VideoProviderConfig, error) {
	if r == nil || r.db == nil || len(r.key) != 32 {
		return VideoProviderConfig{}, ErrUnavailable
	}
	owner = strings.TrimSpace(owner)
	provider = normalizeVideoProvider(provider)
	if owner == "" {
		return VideoProviderConfig{}, fmt.Errorf("%w: owner is required", ErrInvalid)
	}
	var cfg VideoProviderConfig
	var keyID string
	var nonce, ciphertext []byte
	err := r.db.QueryRowContext(ctx, `SELECT provider,model,create_url,tasks_url,result_url,workflow_id,key_id,api_key_nonce,api_key_ciphertext FROM batch_factory_v11_video_provider_configs WHERE owner_username=? AND provider=?`, owner, provider).Scan(&cfg.Provider, &cfg.Model, &cfg.CreateURL, &cfg.TasksURL, &cfg.ResultURL, &cfg.WorkflowID, &keyID, &nonce, &ciphertext)
	if errors.Is(err, sql.ErrNoRows) {
		return VideoProviderConfig{}, fmt.Errorf("%w: video provider is not configured", ErrUnavailable)
	}
	if err != nil {
		return VideoProviderConfig{}, err
	}
	key, err := decryptVideoProviderAPIKey(r.key, nonce, ciphertext)
	if err != nil {
		return VideoProviderConfig{}, fmt.Errorf("%w: decrypt video provider API key: %v", ErrUnavailable, err)
	}
	cfg.APIKey = string(key)
	return cfg, nil
}

func (r *MySQLVideoProviderRegistry) View(ctx context.Context, owner, provider string) (VideoProviderConfigView, error) {
	cfg, err := r.Resolve(ctx, owner, provider)
	if err != nil {
		return VideoProviderConfigView{Provider: normalizeVideoProvider(provider)}, err
	}
	return VideoProviderConfigView{Provider: cfg.Provider, Model: cfg.Model, Configured: strings.TrimSpace(cfg.APIKey) != "" || cfg.Provider == VideoProviderDoubaoLocal}, nil
}

func encryptVideoProviderAPIKey(key, plaintext []byte) (string, []byte, []byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", nil, nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", nil, nil, err
	}
	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)
	sum := sha256.Sum256(key)
	return hex.EncodeToString(sum[:8]), nonce, ciphertext, nil
}

func decryptVideoProviderAPIKey(key, nonce, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(nonce) != gcm.NonceSize() {
		return nil, fmt.Errorf("invalid credential nonce")
	}
	return gcm.Open(nil, nonce, ciphertext, nil)
}
