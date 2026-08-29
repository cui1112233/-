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

type recordingPresetStore struct {
	userID int64
	input  PresetDraftInput
}

func (s *recordingPresetStore) CreateDraft(_ context.Context, userID int64, input PresetDraftInput) (PresetVersion, error) {
	s.userID, s.input = userID, input
	return PresetVersion{ID: "batch-factory-导演规则", Module: input.Module, Name: input.Name, Body: input.Body, Version: 2, Status: "draft"}, nil
}

type presetReadCloser struct{ *strings.Reader }

func (presetReadCloser) Close() error { return nil }

func ioNopCloser(reader *strings.Reader) presetReadCloser { return presetReadCloser{reader} }
