package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"qiantie/backend/internal/credentials"
	"qiantie/backend/internal/store"
)

type videoConfigTestStore struct {
	configs map[int64]store.VideoAPIConfig
	userIDs []int64
}

func (s *videoConfigTestStore) Get(_ context.Context, userID int64) (store.VideoAPIConfig, error) {
	s.userIDs = append(s.userIDs, userID)
	return s.configs[userID], nil
}

func (s *videoConfigTestStore) Save(_ context.Context, userID int64, cfg store.VideoAPIConfig) error {
	s.userIDs = append(s.userIDs, userID)
	s.configs[userID] = cfg
	return nil
}

func (s *videoConfigTestStore) resetCalls() { s.userIDs = nil }

func newConfigHandlerTestAPI(t *testing.T, video *videoConfigTestStore, cipher *credentials.Cipher) (*API, store.User, string) {
	t.Helper()
	user := store.User{ID: 42, Username: "video-user", IsActive: true}
	api := New(Dependencies{
		TokenSecret:      "config-test-secret",
		Users:            &memoryUserStore{users: map[int64]store.User{user.ID: user}},
		Configs:          &recordingConfigStore{},
		VideoConfigs:     video,
		CredentialCipher: cipher,
	})
	return api, user, "config-test-secret"
}

func testCredentialCipher(t *testing.T) *credentials.Cipher {
	t.Helper()
	cipher, err := credentials.NewFromBase64("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatalf("NewFromBase64() error = %v", err)
	}
	return cipher
}

func TestConfigHandlerEncryptsAndRedactsVideoAPIKey(t *testing.T) {
	video := &videoConfigTestStore{configs: map[int64]store.VideoAPIConfig{}}
	api, user, secret := newConfigHandlerTestAPI(t, video, testCredentialCipher(t))
	plaintext := "yd-secret-value"
	req := authorizedRequest(t, secret, user, http.MethodPost, "/api/config")
	req.Body = io.NopCloser(bytes.NewBufferString(`{"video":{"apiKey":"` + plaintext + `"}}`))
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, req)

	if response.Code != http.StatusOK {
		t.Fatalf("POST /api/config status = %d", response.Code)
	}
	saved := video.configs[user.ID]
	if saved.Provider != store.YDVideoProvider || saved.APIKeyCiphertext == plaintext || saved.APIKeyCiphertext == "" {
		t.Fatalf("saved video config = %#v", saved)
	}
	decrypted, err := api.deps.CredentialCipher.Decrypt(saved.APIKeyCiphertext)
	if err != nil || decrypted != plaintext {
		t.Fatalf("saved ciphertext decrypt = %q, %v", decrypted, err)
	}
	if strings.Contains(response.Body.String(), plaintext) || strings.Contains(response.Body.String(), saved.APIKeyCiphertext) {
		t.Fatalf("response leaked video credential: %s", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"video":{"displayName":"中转亚迪","hasApiKey":true,"provider":"yd_video"}`) {
		t.Fatalf("response omitted redacted video state: %s", response.Body.String())
	}
}

func TestConfigHandlerPreservesVideoAPIKeyWhenEmptyOrOmitted(t *testing.T) {
	cipher := testCredentialCipher(t)
	oldCiphertext, err := cipher.Encrypt("existing-secret")
	if err != nil {
		t.Fatal(err)
	}
	video := &videoConfigTestStore{configs: map[int64]store.VideoAPIConfig{42: {Provider: store.YDVideoProvider, APIKeyCiphertext: oldCiphertext}}}
	api, user, secret := newConfigHandlerTestAPI(t, video, cipher)
	for _, body := range []string{`{"video":{"apiKey":""}}`, `{}`} {
		t.Run(body, func(t *testing.T) {
			video.resetCalls()
			req := authorizedRequest(t, secret, user, http.MethodPost, "/api/config")
			req.Body = io.NopCloser(bytes.NewBufferString(body))
			response := httptest.NewRecorder()
			api.Router().ServeHTTP(response, req)
			if response.Code != http.StatusOK {
				t.Fatalf("POST /api/config status = %d", response.Code)
			}
			if video.configs[user.ID].APIKeyCiphertext != oldCiphertext {
				t.Fatalf("empty video apiKey replaced existing ciphertext: %#v", video.configs[user.ID])
			}
		})
	}
}

func TestConfigHandlerRejectsVideoAPIKeyWithoutCipherWithoutLeakingSecret(t *testing.T) {
	video := &videoConfigTestStore{configs: map[int64]store.VideoAPIConfig{}}
	api, user, secret := newConfigHandlerTestAPI(t, video, nil)
	plaintext := "must-not-appear"
	req := authorizedRequest(t, secret, user, http.MethodPost, "/api/config")
	req.Body = io.NopCloser(bytes.NewBufferString(`{"video":{"apiKey":"` + plaintext + `"}}`))
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, req)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("POST /api/config without cipher status = %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), "视频配置服务暂不可用") {
		t.Fatal("missing cipher error was not a clear generic Chinese message")
	}
	if strings.Contains(response.Body.String(), plaintext) || strings.Contains(response.Body.String(), "cipher") {
		t.Fatal("error leaked credential or implementation detail")
	}
}

func TestConfigHandlerScopesVideoConfigByAuthenticatedUser(t *testing.T) {
	video := &videoConfigTestStore{configs: map[int64]store.VideoAPIConfig{}}
	api, user, secret := newConfigHandlerTestAPI(t, video, testCredentialCipher(t))
	req := authorizedRequest(t, secret, user, http.MethodGet, "/api/config")
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, req)

	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(video.userIDs) == 0 || video.userIDs[0] != user.ID {
		t.Fatalf("video config user IDs = %v, want [%d]", video.userIDs, user.ID)
	}
	videoState, ok := payload["video"].(map[string]any)
	if !ok || videoState["provider"] != store.YDVideoProvider || videoState["hasApiKey"] != false {
		t.Fatalf("public video config = %#v", payload["video"])
	}
}
