package external

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
)

var (
	ErrUnavailable   = errors.New("external publish capability unavailable")
	ErrNotFound      = errors.New("external publish resource not found")
	ErrConflict      = errors.New("external publish resource conflict")
	ErrInvalid       = errors.New("invalid external publish input")
	ErrNotConfirmed  = errors.New("submission intent requires explicit confirmation")
	ErrIntentExpired = errors.New("submission intent expired")
)

type Provider string

const (
	Provider121 Provider = "121"
	ProviderYadi Provider = "yadi"
)

func normalizeProvider(value string) (Provider, error) {
	switch Provider(strings.ToLower(strings.TrimSpace(value))) {
	case Provider121:
		return Provider121, nil
	case ProviderYadi:
		return ProviderYadi, nil
	default:
		return "", fmt.Errorf("%w: unsupported provider", ErrInvalid)
	}
}

type CredentialInput struct {
	Name   string `json:"name"`
	Secret string `json:"secret"`
}

type CredentialRef struct {
	ID        string    `json:"id"`
	Provider  Provider  `json:"provider"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type encryptedCredential struct {
	CredentialRef
	Owner     string
	KeyID     string
	Nonce     []byte
	Ciphertext []byte
}

type SubmissionIntent struct {
	ID            string     `json:"id"`
	Owner         string     `json:"-"`
	Provider      Provider   `json:"provider"`
	BatchID       string     `json:"batchId"`
	BookID        string     `json:"bookId,omitempty"`
	PayloadDigest string     `json:"payloadDigest"`
	Payload       json.RawMessage `json:"-"`
	ExpiresAt     time.Time  `json:"expiresAt"`
	ConfirmedAt   *time.Time `json:"confirmedAt,omitempty"`
	SubmittedAt   *time.Time `json:"submittedAt,omitempty"`
}

type ProviderReference struct {
	Provider   Provider `json:"provider"`
	Reference  string   `json:"reference"`
	Status     string   `json:"status"`
}

type AuditRecord struct {
	ID        string    `json:"id"`
	Owner     string    `json:"-"`
	Provider  Provider  `json:"provider"`
	IntentID  string    `json:"intentId"`
	Action    string    `json:"action"`
	Outcome   string    `json:"outcome"`
	Reference string    `json:"reference,omitempty"`
	Message   string    `json:"message,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type CredentialStore interface {
	SaveCredential(context.Context, string, Provider, encryptedCredential) (CredentialRef, error)
	GetCredential(context.Context, string, Provider) (encryptedCredential, error)
}

type IntentStore interface {
	CreateIntent(context.Context, SubmissionIntent) (SubmissionIntent, error)
	GetIntent(context.Context, string, string) (SubmissionIntent, error)
	ConfirmIntent(context.Context, string, string) (SubmissionIntent, error)
	MarkSubmitted(context.Context, string, string, time.Time) (SubmissionIntent, error)
}

type AuditStore interface {
	AppendAudit(context.Context, AuditRecord) (AuditRecord, error)
	ListAudits(context.Context, string, string) ([]AuditRecord, error)
}

type SubmissionProvider interface {
	Submit(context.Context, CredentialInput, SubmissionIntent) (ProviderReference, error)
}

type BatchReader interface {
	GetBatch(context.Context, string, string) (batchfactoryv11.Batch, error)
}

// ProductionReader and MergeReader expose read-only, owner-scoped status used
// to build an authoritative publish payload.  The browser may request a
// publish intent, but it must not be able to substitute an arbitrary media URL.
type ProductionReader interface {
	GetBatchStatus(context.Context, string, string) (batchfactoryv11.BatchStatus, error)
}

type MergeReader interface {
	GetBatchStatus(context.Context, string, string) ([]batchfactoryv11.MergeJob, error)
}

type Service struct {
	Credentials      CredentialStore
	Intents          IntentStore
	Audits           AuditStore
	Providers        map[Provider]SubmissionProvider
	Enabled          map[Provider]bool
	Key              []byte
	Now              func() time.Time
	BatchReader      BatchReader
	ProductionReader ProductionReader
	MergeReader      MergeReader
}

func (s *Service) CredentialStatus(ctx context.Context, owner, provider string) (CredentialRef, error) {
	p, err := normalizeProvider(provider)
	if err != nil { return CredentialRef{}, err }
	if !s.enabled(p) || s.Credentials == nil { return CredentialRef{}, ErrUnavailable }
	value, err := s.Credentials.GetCredential(ctx, owner, p)
	if err != nil { return CredentialRef{}, err }
	return value.CredentialRef, nil
}

func (s *Service) now() time.Time {
	if s.Now != nil { return s.Now().UTC() }
	return time.Now().UTC()
}

func (s *Service) enabled(provider Provider) bool {
	return s != nil && s.Enabled != nil && s.Enabled[provider]
}

func (s *Service) SaveCredential(ctx context.Context, owner, provider string, input CredentialInput) (CredentialRef, error) {
	p, err := normalizeProvider(provider)
	if err != nil { return CredentialRef{}, err }
	if !s.enabled(p) { return CredentialRef{}, ErrUnavailable }
	if s.Credentials == nil || len(s.Key) != 32 { return CredentialRef{}, fmt.Errorf("%w: credential encryption key is required", ErrUnavailable) }
	if strings.TrimSpace(owner) == "" || strings.TrimSpace(input.Name) == "" || input.Secret == "" { return CredentialRef{}, ErrInvalid }
	plaintext := []byte(input.Secret)
	defer func() { for i := range plaintext { plaintext[i] = 0 } }()
	keyID, nonce, ciphertext, err := EncryptCredential(s.Key, plaintext)
	if err != nil { return CredentialRef{}, err }
	// Keep the caller's plaintext only in this stack frame; the store receives ciphertext.
	id := fmt.Sprintf("credential-%d", s.now().UnixNano())
	return s.Credentials.SaveCredential(ctx, owner, p, encryptedCredential{CredentialRef: CredentialRef{ID: id, Provider: p, Name: input.Name}, Owner: owner, KeyID: keyID, Nonce: nonce, Ciphertext: ciphertext})
}

func (s *Service) CreateIntent(ctx context.Context, owner, provider, batchID, bookID string, payload json.RawMessage) (SubmissionIntent, error) {
	p, err := normalizeProvider(provider)
	if err != nil { return SubmissionIntent{}, err }
	if !s.enabled(p) { return SubmissionIntent{}, ErrUnavailable }
	if s.Intents == nil || strings.TrimSpace(owner) == "" || strings.TrimSpace(batchID) == "" { return SubmissionIntent{}, ErrInvalid }

	var batch batchfactoryv11.Batch
	if s.BatchReader != nil {
		batch, err = s.BatchReader.GetBatch(ctx, owner, batchID)
		if err != nil { return SubmissionIntent{}, err }
		if bookID != "" {
			if _, found := bookFromBatch(batch, bookID); found != nil {
				return SubmissionIntent{}, ErrNotFound
			}
		}
	}
	if len(payload) == 0 { payload = json.RawMessage(`{}`) }
	if s.BatchReader != nil && (s.ProductionReader != nil || s.MergeReader != nil) {
		payload, err = s.normalizePublishPayload(ctx, owner, batchID, strings.TrimSpace(bookID), batch, payload)
		if err != nil { return SubmissionIntent{}, err }
	}
	digest := digestPayload(payload)
	now := s.now()
	intent := SubmissionIntent{ID: fmt.Sprintf("intent-%d", now.UnixNano()), Owner: owner, Provider: p, BatchID: batchID, BookID: strings.TrimSpace(bookID), PayloadDigest: digest, Payload: append(json.RawMessage(nil), payload...), ExpiresAt: now.Add(15 * time.Minute)}
	return s.Intents.CreateIntent(ctx, intent)
}

// normalizePublishPayload replaces browser-supplied media with URLs from the
// current owner's successful production/merge jobs.  This keeps the intent
// confirmation digest bound to server-owned artifacts and prevents publishing
// another user's URL or an empty placeholder.
func (s *Service) normalizePublishPayload(ctx context.Context, owner, batchID, bookID string, batch batchfactoryv11.Batch, payload json.RawMessage) (json.RawMessage, error) {
	var document map[string]any
	if err := json.Unmarshal(payload, &document); err != nil || document == nil {
		return nil, fmt.Errorf("%w: publish payload must be a JSON object", ErrInvalid)
	}
	rawBooks, ok := document["books"].([]any)
	if !ok || len(rawBooks) == 0 {
		return nil, fmt.Errorf("%w: publish payload must contain books", ErrConflict)
	}

	expected := map[string]batchfactoryv11.Book{}
	for _, book := range batch.Books {
		if bookID == "" || book.ID == bookID { expected[book.ID] = book }
	}
	if len(expected) == 0 { return nil, ErrNotFound }

	mediaByVideo := map[string]string{}
	if s.ProductionReader != nil {
		status, err := s.ProductionReader.GetBatchStatus(ctx, owner, batchID)
		if err != nil { return nil, err }
		activeRevision := map[string]string{}
		for id, book := range expected {
			if book.DirectorRevision != nil { activeRevision[id] = book.DirectorRevision.ID }
		}
		for _, job := range status.Jobs {
			if _, wanted := expected[job.BookID]; !wanted || job.DirectorRevisionID != activeRevision[job.BookID] { continue }
			for _, task := range job.Tasks {
				if task.Status == batchfactoryv11.ProductionSucceeded && strings.TrimSpace(task.MediaURL) != "" {
					mediaByVideo[task.VideoID] = strings.TrimSpace(task.MediaURL)
				}
			}
		}
	}

	seenBooks := map[string]bool{}
	for _, rawBook := range rawBooks {
		bookMap, ok := rawBook.(map[string]any)
		if !ok { return nil, fmt.Errorf("%w: invalid book in publish payload", ErrInvalid) }
		id, _ := bookMap["id"].(string)
		id = strings.TrimSpace(id)
		book, wanted := expected[id]
		if !wanted || seenBooks[id] { return nil, fmt.Errorf("%w: publish payload contains an unexpected or duplicate book", ErrConflict) }
		seenBooks[id] = true
		rawVideos, ok := bookMap["videos"].([]any)
		if !ok || len(rawVideos) == 0 { return nil, fmt.Errorf("%w: book %s has no videos", ErrConflict, id) }
		videoByID := map[string]map[string]any{}
		for _, rawVideo := range rawVideos {
			videoMap, ok := rawVideo.(map[string]any)
			if !ok { return nil, fmt.Errorf("%w: invalid video in publish payload", ErrInvalid) }
			videoID, _ := videoMap["id"].(string)
			videoID = strings.TrimSpace(videoID)
			if videoID == "" || videoByID[videoID] != nil { return nil, fmt.Errorf("%w: duplicate or empty video id", ErrConflict) }
			videoByID[videoID] = videoMap
		}
		for _, video := range book.Videos {
			videoMap := videoByID[video.ID]
			if videoMap == nil { return nil, fmt.Errorf("%w: book %s is missing VIDEO %s", ErrConflict, id, video.ID) }
			if s.ProductionReader != nil {
				mediaURL := mediaByVideo[video.ID]
				if mediaURL == "" { return nil, fmt.Errorf("%w: VIDEO %s has no completed media", ErrConflict, video.ID) }
				videoMap["url"] = mediaURL
			}
		}
		if len(videoByID) != len(book.Videos) { return nil, fmt.Errorf("%w: book %s contains an unknown VIDEO", ErrConflict, id) }
	}

	if len(seenBooks) != len(expected) { return nil, fmt.Errorf("%w: publish payload is missing a batch book", ErrConflict) }
	if s.MergeReader != nil {
		mergeJobs, err := s.MergeReader.GetBatchStatus(ctx, owner, batchID)
		if err != nil { return nil, err }
		mergedURL := ""
		var latest time.Time
		for _, job := range mergeJobs {
			if job.Status != batchfactoryv11.MergeSucceeded || strings.TrimSpace(job.OutputURL) == "" { continue }
			stamp := job.UpdatedAt
			if stamp.IsZero() { stamp = job.CreatedAt }
			if mergedURL == "" || stamp.After(latest) { mergedURL, latest = strings.TrimSpace(job.OutputURL), stamp }
		}
		if mergedURL == "" { return nil, fmt.Errorf("%w: batch has no completed merged media", ErrConflict) }
		for _, rawBook := range rawBooks {
			bookMap := rawBook.(map[string]any)
			bookMap["mergedUrl"] = mergedURL
		}
	} else {
		for _, rawBook := range rawBooks {
			bookMap := rawBook.(map[string]any)
			if strings.TrimSpace(fmt.Sprint(bookMap["mergedUrl"])) == "" {
				return nil, fmt.Errorf("%w: mergedUrl is required before publishing", ErrConflict)
			}
		}
	}
	return json.Marshal(document)
}

func (s *Service) ConfirmIntent(ctx context.Context, owner, intentID string) (SubmissionIntent, error) {
	if s.Intents == nil { return SubmissionIntent{}, ErrUnavailable }
	intent, err := s.Intents.GetIntent(ctx, owner, intentID)
	if err != nil { return SubmissionIntent{}, err }
	if !s.enabled(intent.Provider) { return SubmissionIntent{}, ErrUnavailable }
	if !intent.ExpiresAt.After(s.now()) { return SubmissionIntent{}, ErrIntentExpired }
	return s.Intents.ConfirmIntent(ctx, owner, intentID)
}

func (s *Service) Submit(ctx context.Context, owner, provider, intentID string) (ProviderReference, error) {
	p, err := normalizeProvider(provider)
	if err != nil { return ProviderReference{}, err }
	// Gate before intent, credential, or provider lookup: disabled routes never touch secrets or transport.
	if !s.enabled(p) { return ProviderReference{}, ErrUnavailable }
	if s.Intents == nil || s.Credentials == nil || s.Audits == nil { return ProviderReference{}, ErrUnavailable }
	intent, err := s.Intents.GetIntent(ctx, owner, intentID)
	if err != nil { return ProviderReference{}, err }
	if intent.Provider != p { return ProviderReference{}, ErrConflict }
	if intent.ConfirmedAt == nil { return ProviderReference{}, ErrNotConfirmed }
	if intent.SubmittedAt != nil { return ProviderReference{}, ErrConflict }
	if !intent.ExpiresAt.After(s.now()) { return ProviderReference{}, ErrIntentExpired }
	stored, err := s.Credentials.GetCredential(ctx, owner, p)
	if err != nil { return ProviderReference{}, err }
	secret, err := DecryptCredential(s.Key, stored.Nonce, stored.Ciphertext)
	if err != nil { return ProviderReference{}, fmt.Errorf("credential decrypt failed") }
	input := CredentialInput{Name: stored.Name, Secret: string(secret)}
	for i := range secret { secret[i] = 0 }
	providerAdapter := s.Providers[p]
	if providerAdapter == nil { return ProviderReference{}, ErrUnavailable }
	ref, submitErr := providerAdapter.Submit(ctx, input, intent)
	input.Secret = ""
	if submitErr != nil {
		_, _ = s.Audits.AppendAudit(ctx, AuditRecord{ID: fmt.Sprintf("audit-%d", s.now().UnixNano()), Owner: owner, Provider: p, IntentID: intent.ID, Action: "submit", Outcome: "failed", Message: boundedMessage(submitErr.Error()), CreatedAt: s.now()})
		return ProviderReference{}, submitErr
	}
	if _, err := s.Intents.MarkSubmitted(ctx, owner, intent.ID, s.now()); err != nil { return ProviderReference{}, err }
	_, _ = s.Audits.AppendAudit(ctx, AuditRecord{ID: fmt.Sprintf("audit-%d", s.now().UnixNano()), Owner: owner, Provider: p, IntentID: intent.ID, Action: "submit", Outcome: "succeeded", Reference: boundedMessage(ref.Reference), CreatedAt: s.now()})
	return ref, nil
}

func digestPayload(payload []byte) string {
	// The payload is already frozen at intent creation; hashing bytes preserves the
	// exact confirmation material without storing secrets in the UI response.
	return sha256Hex(payload)
}

func boundedMessage(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 255 { return value[:255] }
	return value
}

func sha256Hex(value []byte) string {
	hash := sha256.Sum256(value)
	return fmt.Sprintf("%x", hash[:])
}

// Memory stores make the contract testable without allowing a production app
// to silently fall back to process memory; app wiring always uses MySQL.
type MemoryStore struct {
	mu sync.Mutex
	credentials map[string]encryptedCredential
	intents map[string]SubmissionIntent
	audits map[string][]AuditRecord
	seq int64
}

func NewMemoryStore() *MemoryStore { return &MemoryStore{credentials: map[string]encryptedCredential{}, intents: map[string]SubmissionIntent{}, audits: map[string][]AuditRecord{}} }
func (m *MemoryStore) next(prefix string) string { m.seq++; return fmt.Sprintf("%s-%d", prefix, m.seq) }
func credentialKey(owner string, provider Provider) string { return owner + ":" + string(provider) }
func (m *MemoryStore) SaveCredential(_ context.Context, owner string, provider Provider, value encryptedCredential) (CredentialRef, error) { m.mu.Lock(); defer m.mu.Unlock(); value.ID = m.next("credential"); value.Owner, value.Provider = owner, provider; value.CreatedAt, value.UpdatedAt = time.Now().UTC(), time.Now().UTC(); m.credentials[credentialKey(owner, provider)] = value; return value.CredentialRef, nil }
func (m *MemoryStore) GetCredential(_ context.Context, owner string, provider Provider) (encryptedCredential, error) { m.mu.Lock(); defer m.mu.Unlock(); value, ok := m.credentials[credentialKey(owner, provider)]; if !ok { return encryptedCredential{}, ErrNotFound }; return value, nil }
func (m *MemoryStore) CreateIntent(_ context.Context, value SubmissionIntent) (SubmissionIntent, error) { m.mu.Lock(); defer m.mu.Unlock(); if value.ID == "" { value.ID = m.next("intent") }; m.intents[value.ID] = value; return value, nil }
func (m *MemoryStore) GetIntent(_ context.Context, owner, id string) (SubmissionIntent, error) { m.mu.Lock(); defer m.mu.Unlock(); value, ok := m.intents[id]; if !ok || value.Owner != owner { return SubmissionIntent{}, ErrNotFound }; value.Payload = append(json.RawMessage(nil), value.Payload...); return value, nil }
func (m *MemoryStore) ConfirmIntent(_ context.Context, owner, id string) (SubmissionIntent, error) { m.mu.Lock(); defer m.mu.Unlock(); value, ok := m.intents[id]; if !ok || value.Owner != owner { return SubmissionIntent{}, ErrNotFound }; if value.ConfirmedAt != nil { return value, nil }; now := time.Now().UTC(); value.ConfirmedAt = &now; m.intents[id] = value; return value, nil }
func (m *MemoryStore) MarkSubmitted(_ context.Context, owner, id string, at time.Time) (SubmissionIntent, error) { m.mu.Lock(); defer m.mu.Unlock(); value, ok := m.intents[id]; if !ok || value.Owner != owner { return SubmissionIntent{}, ErrNotFound }; if value.SubmittedAt != nil { return value, ErrConflict }; value.SubmittedAt = &at; m.intents[id] = value; return value, nil }
func (m *MemoryStore) AppendAudit(_ context.Context, value AuditRecord) (AuditRecord, error) { m.mu.Lock(); defer m.mu.Unlock(); if value.ID == "" { value.ID = m.next("audit") }; m.audits[value.Owner] = append(m.audits[value.Owner], value); return value, nil }
func (m *MemoryStore) ListAudits(_ context.Context, owner, intentID string) ([]AuditRecord, error) { m.mu.Lock(); defer m.mu.Unlock(); out := []AuditRecord{}; for _, value := range m.audits[owner] { if intentID == "" || value.IntentID == intentID { out = append(out, value) } }; return out, nil }
