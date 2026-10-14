package batchfactoryv11

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"database/sql/driver"
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

type notSecretArgument struct{ secret string }

func (value notSecretArgument) Match(actual driver.Value) bool {
	switch typed := actual.(type) {
	case []byte:
		return string(typed) != value.secret
	case string:
		return typed != value.secret
	default:
		return true
	}
}

func encryptedVideoProviderAPIKeyForTest(t *testing.T, key, nonce []byte, secret string) []byte {
	t.Helper()
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	return gcm.Seal(nil, nonce, []byte(secret), nil)
}

func TestMemoryVideoProviderRegistryKeepsAPIKeyOutOfView(t *testing.T) {
	registry := NewMemoryVideoProviderRegistry()
	if err := registry.Put(context.Background(), "alice", VideoProviderConfig{
		Provider: VideoProviderPersonalAPI,
		APIKey:   "secret-video-key",
	}); err != nil {
		t.Fatal(err)
	}
	view, err := registry.View(context.Background(), "alice", VideoProviderPersonalAPI)
	if err != nil {
		t.Fatal(err)
	}
	if !view.Configured || view.Model != DefaultPersonalVideoModel || view.Provider != VideoProviderPersonalAPI {
		t.Fatalf("view=%+v", view)
	}
	encoded, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "secret-video-key") {
		t.Fatalf("provider view leaked key: %s", encoded)
	}
}

func TestNormalizeVideoProviderForHTTP(t *testing.T) {
	if got := NormalizeVideoProviderForHTTP("doubao"); got != VideoProviderDoubaoLocal {
		t.Fatalf("got %q", got)
	}
	if got := NormalizeVideoProviderForHTTP(""); got != VideoProviderPersonalAPI {
		t.Fatalf("got %q", got)
	}
}

func TestMySQLVideoProviderRegistryStoresEncryptedAPIKeyAndResolvesAfterRestart(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	key := bytes.Repeat([]byte{7}, 32)
	registry := NewMySQLVideoProviderRegistry(db, key)
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO batch_factory_v11_video_provider_configs`)).
		WithArgs("alice", VideoProviderYFAISeedance, "seedance-2-0-official", "https://yf.example.test", "", "", "", sqlmock.AnyArg(), sqlmock.AnyArg(), notSecretArgument{secret: "secret-video-key"}, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	if err := registry.Put(context.Background(), "alice", VideoProviderConfig{
		Provider: VideoProviderYFAISeedance, APIKey: "secret-video-key", Model: "seedance-2-0-official", CreateURL: "https://yf.example.test",
	}); err != nil {
		t.Fatal(err)
	}

	nonce := bytes.Repeat([]byte{3}, 12)
	ciphertext := encryptedVideoProviderAPIKeyForTest(t, key, nonce, "secret-video-key")
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT provider,model,create_url,tasks_url,result_url,workflow_id,key_id,api_key_nonce,api_key_ciphertext FROM batch_factory_v11_video_provider_configs WHERE owner_username=? AND provider=?`)).
		WithArgs("alice", VideoProviderYFAISeedance).
		WillReturnRows(sqlmock.NewRows([]string{"provider", "model", "create_url", "tasks_url", "result_url", "workflow_id", "key_id", "api_key_nonce", "api_key_ciphertext"}).
			AddRow(VideoProviderYFAISeedance, "seedance-2-0-official", "https://yf.example.test", "", "", "", "key-id", nonce, ciphertext))

	restarted := NewMySQLVideoProviderRegistry(db, key)
	resolved, err := restarted.Resolve(context.Background(), "alice", VideoProviderYFAISeedance)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.APIKey != "secret-video-key" || resolved.Model != "seedance-2-0-official" || resolved.CreateURL != "https://yf.example.test" {
		t.Fatalf("resolved=%+v", resolved)
	}
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT provider,model,create_url,tasks_url,result_url,workflow_id,key_id,api_key_nonce,api_key_ciphertext FROM batch_factory_v11_video_provider_configs WHERE owner_username=? AND provider=?`)).
		WithArgs("alice", VideoProviderYFAISeedance).
		WillReturnRows(sqlmock.NewRows([]string{"provider", "model", "create_url", "tasks_url", "result_url", "workflow_id", "key_id", "api_key_nonce", "api_key_ciphertext"}).
			AddRow(VideoProviderYFAISeedance, "seedance-2-0-official", "https://yf.example.test", "", "", "", "key-id", nonce, ciphertext))
	view, err := restarted.View(context.Background(), "alice", VideoProviderYFAISeedance)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "secret-video-key") {
		t.Fatalf("provider view leaked key: %s", encoded)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
