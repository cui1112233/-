package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"qiantie/backend/internal/auth"
	"qiantie/backend/internal/store"
)

type memoryUserStore struct {
	users map[int64]store.User
}

func (s *memoryUserStore) FindByUsername(_ context.Context, username string) (store.User, error) {
	for _, user := range s.users {
		if user.Username == username {
			return user, nil
		}
	}
	return store.User{}, sql.ErrNoRows
}

func (s *memoryUserStore) FindByID(_ context.Context, id int64) (store.User, error) {
	user, ok := s.users[id]
	if !ok {
		return store.User{}, sql.ErrNoRows
	}
	return user, nil
}

func newShuihuoTestAPI(t *testing.T, users map[int64]store.User) (*API, string) {
	t.Helper()
	const secret = "test-secret"
	return New(Dependencies{
		TokenSecret: secret,
		Users:       &memoryUserStore{users: users},
	}), secret
}

func authorizedRequest(t *testing.T, secret string, user store.User, method, path string) *http.Request {
	t.Helper()
	token, err := auth.NewToken(secret, user.ID, user.Username)
	if err != nil {
		t.Fatalf("NewToken() error = %v", err)
	}
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	return req
}

func TestShuihuoProjectsRequiresAuthentication(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, nil)
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/shuihuo-production/projects", nil))

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("GET projects status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestAdminModelsRejectsActiveNonOwner(t *testing.T) {
	user := store.User{ID: 7, Username: "member", IsActive: true}
	api, secret := newShuihuoTestAPI(t, map[int64]store.User{user.ID: user})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, authorizedRequest(t, secret, user, http.MethodGet, "/api/admin/models"))

	if response.Code != http.StatusForbidden {
		t.Fatalf("GET admin models status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestAdminModelsReturnsEmptyArrayForOwner(t *testing.T) {
	user := store.User{ID: 8, Username: "owner", IsOwner: true, IsActive: true}
	api, secret := newShuihuoTestAPI(t, map[int64]store.User{user.ID: user})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, authorizedRequest(t, secret, user, http.MethodGet, "/api/admin/models"))

	if response.Code != http.StatusOK {
		t.Fatalf("GET admin models status = %d, want %d", response.Code, http.StatusOK)
	}
	var payload struct {
		Models []json.RawMessage `json:"models"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Models == nil || len(payload.Models) != 0 {
		t.Fatalf("models = %#v, want empty array", payload.Models)
	}
}

func TestShuihuoProjectsReturnsEmptyArrayForCurrentUser(t *testing.T) {
	user := store.User{ID: 9, Username: "producer", IsActive: true}
	api, secret := newShuihuoTestAPI(t, map[int64]store.User{user.ID: user})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, authorizedRequest(t, secret, user, http.MethodGet, "/api/shuihuo-production/projects"))

	if response.Code != http.StatusOK {
		t.Fatalf("GET projects status = %d, want %d", response.Code, http.StatusOK)
	}
	var payload struct {
		Projects []json.RawMessage `json:"projects"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Projects == nil || len(payload.Projects) != 0 {
		t.Fatalf("projects = %#v, want empty array", payload.Projects)
	}
}

func TestRequireAuthRejectsInactiveAccount(t *testing.T) {
	user := store.User{ID: 11, Username: "inactive", IsActive: false}
	api, secret := newShuihuoTestAPI(t, map[int64]store.User{user.ID: user})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, authorizedRequest(t, secret, user, http.MethodGet, "/api/shuihuo-production/projects"))

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("GET projects for inactive user status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestLoginRejectsInactiveAccountBeforeIssuingToken(t *testing.T) {
	password := "correct-password"
	user := store.User{
		ID:           12,
		Username:     "disabled-user",
		PasswordHash: auth.HashPassword(password),
		IsActive:     false,
	}
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{user.ID: user})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, httptest.NewRequest(
		http.MethodPost,
		"/api/login",
		bytes.NewBufferString(`{"username":"disabled-user","password":"correct-password"}`),
	))

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("POST login for inactive user status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, ok := payload["token"]; ok {
		t.Fatalf("inactive login response unexpectedly includes token: %#v", payload)
	}
}
