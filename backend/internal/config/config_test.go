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
		t.Fatal("Load() failed")
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
		t.Fatal("Load() failed")
	}
	if cfg.CredentialCipher == nil {
		t.Fatal("Load() left CredentialCipher nil for valid encryption key")
	}
	ciphertext, err := cfg.CredentialCipher.Encrypt("sk-yadi-secret")
	if err != nil {
		t.Fatal("CredentialCipher.Encrypt() failed")
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
			t.Fatal("Load() did not return the expected encryption-key validation error")
		}
		if value != "" && strings.Contains(err.Error(), value) {
			t.Fatal("Load() leaked the supplied encryption key")
		}
	}
}

func TestLoadRejectsCredentialEncryptionKeyLongerThan32BytesWithoutLeakage(t *testing.T) {
	setRequiredConfigEnv(t)
	value := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("x", 33)))
	t.Setenv("QIANTIE_CREDENTIAL_ENCRYPTION_KEY", value)

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "QIANTIE_CREDENTIAL_ENCRYPTION_KEY") {
		t.Fatal("Load() did not return the expected encryption-key validation error")
	}
	if strings.Contains(err.Error(), value) {
		t.Fatal("Load() leaked the supplied encryption key")
	}
}

func TestLoadPreservesModelCredentialsBehavior(t *testing.T) {
	setRequiredConfigEnv(t)
	unsetEnv(t, "QIANTIE_CREDENTIAL_ENCRYPTION_KEY")
	t.Setenv("QIANTIE_MODEL_CREDENTIALS", " text = text-secret , image=image-secret, invalid, =ignored ")

	cfg, err := Load()
	if err != nil {
		t.Fatal("Load() failed")
	}
	if len(cfg.ModelCredentials) != 2 {
		t.Fatal("ModelCredentials did not preserve the expected entry count")
	}
	if value, ok := cfg.ModelCredentials["text"]; !ok || value != "text-secret" {
		t.Fatal("ModelCredentials did not preserve the text credential")
	}
	if value, ok := cfg.ModelCredentials["image"]; !ok || value != "image-secret" {
		t.Fatal("ModelCredentials did not preserve the image credential")
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
		t.Fatal("Unsetenv() failed")
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
