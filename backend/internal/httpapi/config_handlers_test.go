package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"qiantie/backend/internal/store"
)

type petConfigTestStore struct {
	cfg   store.APIConfig
	saved store.APIConfig
}

func (s *petConfigTestStore) Get(context.Context, int64) (store.APIConfig, error) {
	return s.cfg, nil
}

func (s *petConfigTestStore) Save(_ context.Context, _ int64, cfg store.APIConfig) error {
	s.saved = cfg
	return nil
}

type petPreferenceTestStore struct {
	petID string
	saved string
}

func (s *petPreferenceTestStore) GetPet(context.Context, int64) (string, error) {
	return s.petID, nil
}

func (s *petPreferenceTestStore) SavePet(_ context.Context, _ int64, petID string) error {
	s.saved = petID
	s.petID = petID
	return nil
}

func petConfigRequest(t *testing.T, method string, body []byte) *httpRequestWrapper {
	t.Helper()
	return &httpRequestWrapper{method: method, body: body}
}

type httpRequestWrapper struct {
	method string
	body   []byte
}

func (w *httpRequestWrapper) request(t *testing.T) *httptest.ResponseRecorder {
	t.Helper()
	return httptest.NewRecorder()
}

func withPetTestUser(reqContext context.Context) context.Context {
	return context.WithValue(reqContext, userContextKey, store.User{ID: 42})
}

func TestConfigGetReturnsSelectedPet(t *testing.T) {
	configs := &petConfigTestStore{cfg: store.APIConfig{Provider: "openai", BaseURL: "https://api.openai.com/v1", Model: "gpt-4o-mini"}}
	preferences := &petPreferenceTestStore{petID: "pixiu"}
	api := New(Dependencies{Configs: configs, Preferences: preferences})

	req := httptest.NewRequest("GET", "/api/config", nil)
	req = req.WithContext(withPetTestUser(req.Context()))
	res := httptest.NewRecorder()
	api.handleGetConfig(res, req)

	if res.Code != 200 {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got := payload["pet"]; got != "pixiu" {
		t.Fatalf("pet = %#v, want pixiu", got)
	}
}

func TestConfigSavePersistsPixiuWithoutDroppingConnectionConfig(t *testing.T) {
	old := store.APIConfig{Provider: "openai", BaseURL: "https://api.openai.com/v1", Model: "gpt-4.1", APIKeyCiphertext: "secret"}
	configs := &petConfigTestStore{cfg: old}
	preferences := &petPreferenceTestStore{petID: "stacky"}
	api := New(Dependencies{Configs: configs, Preferences: preferences})

	req := httptest.NewRequest("POST", "/api/config", bytes.NewBufferString(`{"pet":"pixiu"}`))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(withPetTestUser(req.Context()))
	res := httptest.NewRecorder()
	api.handleSaveConfig(res, req)

	if res.Code != 200 {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
	if preferences.saved != "pixiu" {
		t.Fatalf("saved pet = %q, want pixiu", preferences.saved)
	}
	if configs.saved != old {
		t.Fatalf("connection config changed: %#v, want %#v", configs.saved, old)
	}
	var payload map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got := payload["pet"]; got != "pixiu" {
		t.Fatalf("pet = %#v, want pixiu", got)
	}
}

func TestConfigSaveUnknownPetPreservesPreviousSupportedPet(t *testing.T) {
	configs := &petConfigTestStore{cfg: store.APIConfig{Provider: "openai", BaseURL: "https://api.openai.com/v1", Model: "gpt-4o-mini"}}
	preferences := &petPreferenceTestStore{petID: "pixiu"}
	api := New(Dependencies{Configs: configs, Preferences: preferences})

	req := httptest.NewRequest("POST", "/api/config", bytes.NewBufferString(`{"pet":"dragon"}`))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(withPetTestUser(req.Context()))
	res := httptest.NewRecorder()
	api.handleSaveConfig(res, req)

	if res.Code != 200 {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
	if preferences.saved != "pixiu" {
		t.Fatalf("saved pet = %q, want previous pixiu", preferences.saved)
	}
}
