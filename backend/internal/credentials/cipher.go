// Package credentials provides encryption for account-scoped provider credentials.
package credentials

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"strings"
)

const ciphertextVersion = "v1:"

var (
	errInvalidKey        = errors.New("credential encryption key is invalid")
	errInvalidCiphertext = errors.New("credential ciphertext is invalid")
	errCipherUnavailable = errors.New("credential cipher is unavailable")
)

// Cipher encrypts account-scoped credentials with AES-256-GCM.
type Cipher struct {
	aead cipher.AEAD
}

// NewFromBase64 constructs a Cipher from a base64-encoded 32-byte AES key.
func NewFromBase64(encodedKey string) (*Cipher, error) {
	key, err := base64.StdEncoding.DecodeString(encodedKey)
	if err != nil || len(key) != 32 {
		return nil, errInvalidKey
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, errInvalidKey
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, errInvalidKey
	}
	return &Cipher{aead: aead}, nil
}

// Encrypt returns a versioned ciphertext containing a random nonce and GCM payload.
func (c *Cipher) Encrypt(plaintext string) (string, error) {
	if c == nil || c.aead == nil {
		return "", errCipherUnavailable
	}

	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", errors.New("credential encryption failed")
	}
	payload := c.aead.Seal(nonce, nonce, []byte(plaintext), nil)
	return ciphertextVersion + base64.StdEncoding.EncodeToString(payload), nil
}

// Decrypt validates and decrypts a versioned ciphertext.
func (c *Cipher) Decrypt(ciphertext string) (string, error) {
	if c == nil || c.aead == nil {
		return "", errCipherUnavailable
	}
	if !strings.HasPrefix(ciphertext, ciphertextVersion) {
		return "", errInvalidCiphertext
	}

	payload, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(ciphertext, ciphertextVersion))
	if err != nil || len(payload) < c.aead.NonceSize()+c.aead.Overhead() {
		return "", errInvalidCiphertext
	}
	nonce := payload[:c.aead.NonceSize()]
	plaintext, err := c.aead.Open(nil, nonce, payload[c.aead.NonceSize():], nil)
	if err != nil {
		return "", errInvalidCiphertext
	}
	return string(plaintext), nil
}
