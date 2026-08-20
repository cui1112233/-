package config

import (
	"encoding/base64"
	"os"
	"strings"
	"testing"
)

func TestLoadLeavesCredentialCipherNilWhenEncryptionKeyIsAbsent(t *testing.T) {
	setRequiredConfigEnv(t)
	unsetEnv(t, "QIANTIE_CREDENTIAL_ENCRYPTION_KEY")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.CredentialCipher != nil {
		t.Fatal("Load() configured CredentialCipher without encryption key")
	}
}

func TestLoadConfiguresCredentialCipherFromValidEncryptionKey(t *testing.T) {
	setRequiredConfigEnv(t)
	t.Setenv("QIANTIE_CREDENTIAL_ENCRYPTION_KEY", testCredentialEncryptionKey())

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.CredentialCipher == nil {
		t.Fatal("Load() left CredentialCipher nil for valid encryption key")
	}
	ciphertext, err := cfg.CredentialCipher.Encrypt("sk-yadi-secret")
	if err != nil {
		t.Fatalf("CredentialCipher.Encrypt() error = %v", err)
	}
	if strings.Contains(ciphertext, "sk-yadi-secret") {
		t.Fatal("CredentialCipher.Encrypt() leaked plaintext")
	}
}

func TestLoadRejectsInvalidCredentialEncryptionKey(t *testing.T) {
	setRequiredConfigEnv(t)
	for _, value := range []string{"", "not-base64", base64.StdEncoding.EncodeToString([]byte("too-short"))} {
		t.Setenv("QIANTIE_CREDENTIAL_ENCRYPTION_KEY", value)
		_, err := Load()
		if err == nil || !strings.Contains(err.Error(), "QIANTIE_CREDENTIAL_ENCRYPTION_KEY") {
			t.Fatalf("Load() error = %v, want encryption-key validation error", err)
		}
		if value != "" && strings.Contains(err.Error(), value) {
			t.Fatalf("Load() leaked supplied encryption key in error %q", err)
		}
	}
}

func TestLoadPreservesModelCredentialsBehavior(t *testing.T) {
	setRequiredConfigEnv(t)
	unsetEnv(t, "QIANTIE_CREDENTIAL_ENCRYPTION_KEY")
	t.Setenv("QIANTIE_MODEL_CREDENTIALS", " text = text-secret , image=image-secret, invalid, =ignored ")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got, want := cfg.ModelCredentials, map[string]string{"text": "text-secret", "image": "image-secret"}; len(got) != len(want) || got["text"] != want["text"] || got["image"] != want["image"] {
		t.Fatalf("ModelCredentials = %#v, want %#v", got, want)
	}
}

func setRequiredConfigEnv(t *testing.T) {
	t.Helper()
	t.Setenv("QIANTIE_MYSQL_DSN", "test-dsn")
	t.Setenv("QIANTIE_TOKEN_SECRET", "test-token-secret")
	t.Setenv("QIANTIE_BRIDGE_SECRET", "test-bridge-secret")
	t.Setenv("QIANTIE_STORAGE_DRIVER", "local")
	t.Setenv("QIANTIE_STORAGE_LOCAL_DIR", "test-storage")
}

func unsetEnv(t *testing.T, key string) {
	t.Helper()
	value, wasSet := os.LookupEnv(key)
	if err := os.Unsetenv(key); err != nil {
		t.Fatalf("Unsetenv(%q) error = %v", key, err)
	}
	t.Cleanup(func() {
		if wasSet {
			_ = os.Setenv(key, value)
			return
		}
		_ = os.Unsetenv(key)
	})
}

func testCredentialEncryptionKey() string {
	return base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
}
