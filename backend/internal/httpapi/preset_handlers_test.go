package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"qiantie/backend/internal/store"
)

func TestCreatePresetDraftRequiresPersistentRepository(t *testing.T) {
	owner := store.User{ID: 1, Username: "owner", IsOwner: true, IsActive: true}
	const secret = "test-secret"
	presets := &recordingPresetStore{}
	api := New(Dependencies{TokenSecret: secret, Users: &memoryUserStore{users: map[int64]store.User{owner.ID: owner}}, Presets: presets})
	req := authorizedRequest(t, secret, owner, http.MethodPost, "/api/admin/presets/draft")
	req.Body = ioNopCloser(strings.NewReader(`{"module":"batch-factory","name":"导演规则","body":"只输出分镜"}`))
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, req)

	if response.Code != http.StatusCreated {
		t.Fatalf("POST draft status = %d, want %d", response.Code, http.StatusCreated)
	}
	if presets.input.Module != "batch-factory" || presets.input.Body != "只输出分镜" || presets.userID != owner.ID {
		t.Fatalf("draft persistence input = %#v, user = %d", presets.input, presets.userID)
	}
}

func TestPublishPresetDelegatesSelectedDraftVersion(t *testing.T) {
	owner := store.User{ID: 1, Username: "owner", IsOwner: true, IsActive: true}
	const secret = "test-secret"
	presets := &recordingPresetStore{}
	api := New(Dependencies{TokenSecret: secret, Users: &memoryUserStore{users: map[int64]store.User{owner.ID: owner}}, Presets: presets})
	req := authorizedRequest(t, secret, owner, http.MethodPost, "/api/admin/presets/7/publish")
	req.Body = ioNopCloser(strings.NewReader(`{"version":3}`))
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, req)

	if response.Code != http.StatusOK {
		t.Fatalf("POST publish status = %d, want %d", response.Code, http.StatusOK)
	}
	if presets.publishedID != "7" || presets.publishedVersion != 3 || presets.userID != owner.ID {
		t.Fatalf("publish persistence call = id %q version %d user %d", presets.publishedID, presets.publishedVersion, presets.userID)
	}
}

func TestRollbackPresetDelegatesHistoricalVersion(t *testing.T) {
	owner := store.User{ID: 1, Username: "owner", IsOwner: true, IsActive: true}
	const secret = "test-secret"
	presets := &recordingPresetStore{}
	api := New(Dependencies{TokenSecret: secret, Users: &memoryUserStore{users: map[int64]store.User{owner.ID: owner}}, Presets: presets})
	req := authorizedRequest(t, secret, owner, http.MethodPost, "/api/admin/presets/7/rollback")
	req.Body = ioNopCloser(strings.NewReader(`{"version":2}`))
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("POST rollback status = %d, want %d", response.Code, http.StatusOK)
	}
	if presets.rollbackID != "7" || presets.rollbackVersion != 2 {
		t.Fatalf("rollback call = %q/%d", presets.rollbackID, presets.rollbackVersion)
	}
}

type recordingPresetStore struct {
	userID           int64
	input            PresetDraftInput
	publishedID      string
	publishedVersion int
	rollbackID       string
	rollbackVersion  int
}

func (s *recordingPresetStore) List(_ context.Context, _ string) ([]PresetVersion, error) {
	return nil, nil
}
func (s *recordingPresetStore) SeedPublished(_ context.Context, _ PresetDraftInput) error { return nil }

func (s *recordingPresetStore) Publish(_ context.Context, userID int64, id string, version int) (PresetVersion, error) {
	s.userID, s.publishedID, s.publishedVersion = userID, id, version
	return PresetVersion{ID: id, Version: version, Status: "published"}, nil
}

func (s *recordingPresetStore) Rollback(_ context.Context, userID int64, id string, version int) (PresetVersion, error) {
	s.userID, s.rollbackID, s.rollbackVersion = userID, id, version
	return PresetVersion{ID: id, Version: version + 1, Status: "published"}, nil
}

func (s *recordingPresetStore) CreateDraft(_ context.Context, userID int64, input PresetDraftInput) (PresetVersion, error) {
	s.userID, s.input = userID, input
	return PresetVersion{ID: "batch-factory-导演规则", Module: input.Module, Name: input.Name, Body: input.Body, Version: 2, Status: "draft"}, nil
}

type presetReadCloser struct{ *strings.Reader }

func (presetReadCloser) Close() error { return nil }

func ioNopCloser(reader *strings.Reader) presetReadCloser { return presetReadCloser{reader} }
