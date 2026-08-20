package app

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"qiantie/backend/internal/config"
	"qiantie/backend/internal/credentials"
	"qiantie/backend/internal/httpapi"
	"qiantie/backend/internal/shuihuo/models"
	"qiantie/backend/internal/store"
)

type appVideoConfigStore struct {
	configs map[int64]store.VideoAPIConfig
	ownerID int64
}

func (s *appVideoConfigStore) Get(_ context.Context, ownerID int64) (store.VideoAPIConfig, error) {
	s.ownerID = ownerID
	return s.configs[ownerID], nil
}

func (s *appVideoConfigStore) Save(_ context.Context, ownerID int64, config store.VideoAPIConfig) error {
	s.ownerID = ownerID
	s.configs[ownerID] = config
	return nil
}

type appRoundTripFunc func(*http.Request) (*http.Response, error)

func (fn appRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func appTestCipher(t *testing.T) *credentials.Cipher {
	t.Helper()
	cipher, err := credentials.NewFromBase64("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatal(err)
	}
	return cipher
}

func TestAccountVideoWiringInjectsConfigStoreAndCipher(t *testing.T) {
	cipher := appTestCipher(t)
	configs := &appVideoConfigStore{configs: map[int64]store.VideoAPIConfig{}}
	deps := newHTTPAPIDependencies(config.Config{CredentialCipher: cipher}, httpapi.Dependencies{}, configs)
	if deps.VideoConfigs != configs || deps.CredentialCipher != cipher {
		t.Fatal("app did not inject account video dependencies into the HTTP API")
	}
}

func TestAccountYDProviderWiringUsesOwnerVideoConfigAndCipher(t *testing.T) {
	const accountKey = "test-app-wiring-account-key"
	cipher := appTestCipher(t)
	ciphertext, err := cipher.Encrypt(accountKey)
	if err != nil {
		t.Fatal(err)
	}
	configs := &appVideoConfigStore{configs: map[int64]store.VideoAPIConfig{
		91: {Provider: store.YDVideoProvider, APIKeyCiphertext: ciphertext},
	}}
	provider := newAccountYDProvider(&http.Client{Transport: appRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Header.Get("Authorization") != "Bearer "+accountKey {
			t.Fatal("app-wired YD provider did not use the account credential")
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"task_id":"yd-app"}`))}, nil
	})}, configs, cipher)

	_, err = provider.Submit(context.Background(), models.Definition{Kind: models.KindVideo, AdapterKind: models.AdapterYDVideo}, models.Request{
		OwnerID: 91, Prompt: "镜头推进", ImageURL: "https://example.com/scene.png", AspectRatio: "9:16",
	})
	if err != nil {
		t.Fatal(err)
	}
	if configs.ownerID != 91 {
		t.Fatal("app-wired YD provider did not resolve the task owner configuration")
	}
}
