package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qiantie/backend/internal/batchfactoryv11/external"
)

type fakeExternalProvider struct { calls int }
func (p *fakeExternalProvider) Submit(_ context.Context, _ external.CredentialInput, _ external.SubmissionIntent) (external.ProviderReference, error) { p.calls++; return external.ProviderReference{Provider: external.Provider121, Reference: "remote-1", Status: "submitted"}, nil }

func TestExternalPublishRequiresExplicitConfirmationAndIsOwnerScoped(t *testing.T) {
	store := external.NewMemoryStore(); provider := &fakeExternalProvider{}
	service := &external.Service{Credentials: store, Intents: store, Audits: store, Providers: map[external.Provider]external.SubmissionProvider{external.Provider121: provider}, Enabled: map[external.Provider]bool{external.Provider121: true}, Key: bytes.Repeat([]byte{4}, 32)}
	server := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return time.Unix(1700000000, 0) }, Slice: 6, External: service})
	post := func(owner, path string, body any) *httptest.ResponseRecorder { raw, _ := json.Marshal(body); req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw)); SignBridgeRequest(req, owner, false, time.Unix(1700000000, 0), "secret"); rec := httptest.NewRecorder(); server.ServeHTTP(rec, req); return rec }
	put := func(owner, path string, body any) *httptest.ResponseRecorder { raw, _ := json.Marshal(body); req := httptest.NewRequest(http.MethodPut, path, bytes.NewReader(raw)); SignBridgeRequest(req, owner, false, time.Unix(1700000000, 0), "secret"); rec := httptest.NewRecorder(); server.ServeHTTP(rec, req); return rec }
	if rec := put("alice", "/api/batch-factory/v11/publish/121/credential", map[string]string{"name":"test","secret":"secret-value"}); rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "secret-value") { t.Fatalf("credential response=%d %s", rec.Code, rec.Body.String()) }
	intentRec := post("alice", "/api/batch-factory/v11/publish/121/intents", map[string]any{"batchId":"batch-1","payload":map[string]string{"title":"demo"}}); if intentRec.Code != http.StatusCreated { t.Fatalf("intent=%d %s", intentRec.Code, intentRec.Body.String()) }
	var parsed struct { Intent external.SubmissionIntent `json:"intent"` }; _ = json.Unmarshal(intentRec.Body.Bytes(), &parsed)
	if rec := post("bob", "/api/batch-factory/v11/publish/121/intents/"+parsed.Intent.ID+"/confirm", nil); rec.Code != http.StatusNotFound { t.Fatalf("cross-owner confirm=%d", rec.Code) }
	if rec := post("alice", "/api/batch-factory/v11/publish/121/intents/"+parsed.Intent.ID+"/submit", nil); rec.Code != http.StatusConflict || provider.calls != 0 { t.Fatalf("unconfirmed submit=%d calls=%d", rec.Code, provider.calls) }
	if rec := post("alice", "/api/batch-factory/v11/publish/121/intents/"+parsed.Intent.ID+"/confirm", nil); rec.Code != http.StatusOK { t.Fatalf("confirm=%d %s", rec.Code, rec.Body.String()) }
	if rec := post("alice", "/api/batch-factory/v11/publish/121/intents/"+parsed.Intent.ID+"/submit", nil); rec.Code != http.StatusOK || provider.calls != 1 { t.Fatalf("submit=%d calls=%d %s", rec.Code, provider.calls, rec.Body.String()) }
}

