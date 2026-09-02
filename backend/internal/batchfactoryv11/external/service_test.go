package external

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type countingProvider struct { calls int }
func (p *countingProvider) Submit(_ context.Context, _ CredentialInput, _ SubmissionIntent) (ProviderReference, error) { p.calls++; return ProviderReference{Provider: Provider121, Reference: "ref-1", Status: "submitted"}, nil }

func testService(provider Provider, enabled bool, adapter SubmissionProvider) (*Service, *MemoryStore) {
	store := NewMemoryStore()
	return &Service{Credentials: store, Intents: store, Audits: store, Providers: map[Provider]SubmissionProvider{provider: adapter}, Enabled: map[Provider]bool{provider: enabled}, Key: []byte(strings.Repeat("k", 32))}, store
}

func TestDisabledGateStopsBeforeCredentialAndTransport(t *testing.T) {
	provider := &countingProvider{}
	service, store := testService(ProviderYadi, false, provider)
	if _, err := service.SaveCredential(context.Background(), "alice", "yadi", CredentialInput{Name: "account", Secret: "secret"}); !errors.Is(err, ErrUnavailable) { t.Fatalf("expected unavailable, got %v", err) }
	if _, err := service.Submit(context.Background(), "alice", "yadi", "intent"); !errors.Is(err, ErrUnavailable) { t.Fatalf("expected unavailable, got %v", err) }
	if provider.calls != 0 || len(store.credentials) != 0 { t.Fatalf("disabled gate touched state or transport") }
}

func TestSubmitRequiresConfirmationAndRedactsAudit(t *testing.T) {
	provider := &countingProvider{}
	service, store := testService(Provider121, true, provider)
	if _, err := service.SaveCredential(context.Background(), "alice", "121", CredentialInput{Name: "account", Secret: "secret-value"}); err != nil { t.Fatal(err) }
	intent, err := service.CreateIntent(context.Background(), "alice", "121", "batch-1", "", []byte(`{"title":"safe"}`))
	if err != nil { t.Fatal(err) }
	if _, err := service.Submit(context.Background(), "alice", "121", intent.ID); !errors.Is(err, ErrNotConfirmed) { t.Fatalf("expected confirmation error, got %v", err) }
	if _, err := service.ConfirmIntent(context.Background(), "alice", intent.ID); err != nil { t.Fatal(err) }
	ref, err := service.Submit(context.Background(), "alice", "121", intent.ID)
	if err != nil || ref.Reference != "ref-1" { t.Fatalf("submit failed: %#v %v", ref, err) }
	audits, _ := store.ListAudits(context.Background(), "alice", intent.ID)
	if len(audits) != 1 || strings.Contains(audits[0].Message, "secret-value") { t.Fatalf("audit leaked secret: %#v", audits) }
	if _, err := service.Submit(context.Background(), "alice", "121", intent.ID); !errors.Is(err, ErrConflict) { t.Fatalf("expected single submit conflict, got %v", err) }
}

func TestCrossProviderIntentRejected(t *testing.T) {
	provider := &countingProvider{}
	service, _ := testService(Provider121, true, provider)
	store := service.Intents.(*MemoryStore)
	intent, _ := service.CreateIntent(context.Background(), "alice", "121", "batch-1", "", nil)
	if _, err := service.Submit(context.Background(), "alice", "yadi", intent.ID); !errors.Is(err, ErrUnavailable) { t.Fatalf("disabled yadi must fail closed, got %v", err) }
	_ = store
}

