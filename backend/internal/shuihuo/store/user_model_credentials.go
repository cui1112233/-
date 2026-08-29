package store

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
)

const userCredentialCipherPrefix = "v1:"

type UserModelCredentials struct {
	db  *sql.DB
	key [32]byte
}

func NewUserModelCredentials(db *sql.DB, encryptionSecret string) *UserModelCredentials {
	return &UserModelCredentials{
		db:  db,
		key: sha256.Sum256([]byte("qiantie:user-model-credential:v1:" + encryptionSecret)),
	}
}

func (s *UserModelCredentials) Configured(ctx context.Context, userID int64, reference string) (bool, error) {
	if s == nil || s.db == nil || userID < 1 || strings.TrimSpace(reference) == "" {
		return false, nil
	}
	var count int
	err := s.db.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM shuihuo_user_model_credentials
WHERE user_id = ? AND credential_ref = ? AND secret_ciphertext <> ''
`, userID, strings.TrimSpace(reference)).Scan(&count)
	return count > 0, err
}

func (s *UserModelCredentials) Get(ctx context.Context, userID int64, reference string) (string, error) {
	if s == nil || s.db == nil || userID < 1 || strings.TrimSpace(reference) == "" {
		return "", sql.ErrNoRows
	}
	var ciphertext string
	err := s.db.QueryRowContext(ctx, `
SELECT secret_ciphertext
FROM shuihuo_user_model_credentials
WHERE user_id = ? AND credential_ref = ?
`, userID, strings.TrimSpace(reference)).Scan(&ciphertext)
	if err != nil {
		return "", err
	}
	secret, err := decryptUserCredential(s.key, ciphertext)
	if err != nil {
		return "", fmt.Errorf("decrypt user model credential: %w", err)
	}
	if strings.TrimSpace(secret) == "" {
		return "", sql.ErrNoRows
	}
	return secret, nil
}

func (s *UserModelCredentials) Save(ctx context.Context, userID int64, reference, secret string) error {
	reference = strings.TrimSpace(reference)
	secret = strings.TrimSpace(secret)
	if s == nil || s.db == nil || userID < 1 || reference == "" || secret == "" {
		return errors.New("user model credential is required")
	}
	ciphertext, err := encryptUserCredential(s.key, secret)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
INSERT INTO shuihuo_user_model_credentials(user_id, credential_ref, secret_ciphertext)
VALUES(?, ?, ?)
ON DUPLICATE KEY UPDATE
  secret_ciphertext = VALUES(secret_ciphertext),
  updated_at = CURRENT_TIMESTAMP
`, userID, reference, ciphertext)
	return err
}

func (s *UserModelCredentials) Delete(ctx context.Context, userID int64, reference string) error {
	if s == nil || s.db == nil || userID < 1 {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM shuihuo_user_model_credentials WHERE user_id = ? AND credential_ref = ?`, userID, strings.TrimSpace(reference))
	return err
}

func encryptUserCredential(key [32]byte, plaintext string) (string, error) {
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	payload := append(nonce, sealed...)
	return userCredentialCipherPrefix + base64.RawStdEncoding.EncodeToString(payload), nil
}

func decryptUserCredential(key [32]byte, value string) (string, error) {
	if !strings.HasPrefix(value, userCredentialCipherPrefix) {
		return "", errors.New("unsupported credential ciphertext")
	}
	payload, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(value, userCredentialCipherPrefix))
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(payload) <= gcm.NonceSize() {
		return "", errors.New("invalid credential ciphertext")
	}
	plaintext, err := gcm.Open(nil, payload[:gcm.NonceSize()], payload[gcm.NonceSize():], nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}
