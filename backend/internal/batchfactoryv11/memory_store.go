package batchfactoryv11

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"
)

type memoryOwned[T any] struct {
	Owner string
	Value T
}
type MemoryStore struct {
	mu             sync.Mutex
	seq            int64
	batches        map[string]memoryOwned[Batch]
	intakes        map[string]memoryOwned[Intake]
	patches        map[string]SettingsPatch
	configVersions map[string]memoryOwned[ConfigVersion]
	prompts        map[string][]Prompt
	drafts         map[string]Draft
}

func NewMemoryStore() *MemoryStore {
	systemDefault := ConfigVersion{ID: "system-default-v1", Name: "System Default", Config: json.RawMessage(`{"source":"system"}`)}
	return &MemoryStore{
		batches:        map[string]memoryOwned[Batch]{},
		intakes:        map[string]memoryOwned[Intake]{},
		patches:        map[string]SettingsPatch{},
		configVersions: map[string]memoryOwned[ConfigVersion]{systemDefault.ID: {Owner: "", Value: systemDefault}},
		prompts:        map[string][]Prompt{},
		drafts:         map[string]Draft{},
	}
}
func (s *MemoryStore) id(prefix string) string { s.seq++; return fmt.Sprintf("%s-%d", prefix, s.seq) }
func scopeKey(r ScopeRef) string {
	return string(r.Kind) + ":" + r.BatchID + ":" + r.BookID + ":" + r.VideoID
}
func (s *MemoryStore) DebugPatch(r ScopeRef) SettingsPatch {
	s.mu.Lock()
	defer s.mu.Unlock()
	return clonePatch(s.patches[scopeKey(r)])
}

func hydrateMemoryBatchSettingsState(b Batch, patches map[string]SettingsPatch) Batch {
	b.SettingsState = SettingsState{
		Patch:    clonePatch(patches[scopeKey(ScopeRef{Kind: ScopeBatch, BatchID: b.ID})]),
		Revision: b.Revision,
	}
	books := make([]Book, len(b.Books))
	for i := range b.Books {
		book := b.Books[i]
		book.SettingsState = SettingsState{
			Patch:    clonePatch(patches[scopeKey(ScopeRef{Kind: ScopeBook, BatchID: b.ID, BookID: book.ID})]),
			Revision: book.Revision,
		}
		videos := make([]Video, len(book.Videos))
		for j := range book.Videos {
			video := book.Videos[j]
			video.SettingsState = SettingsState{
				Patch:    clonePatch(patches[scopeKey(ScopeRef{Kind: ScopeVideo, BatchID: b.ID, BookID: book.ID, VideoID: video.ID})]),
				Revision: video.Revision,
			}
			videos[j] = video
		}
		book.Videos = videos
		books[i] = book
	}
	b.Books = books
	return b
}

func (s *MemoryStore) CreateIntake(_ context.Context, owner string, input NovelFetchIntakeInput) (Intake, error) {
	input = normalizeNovelFetchIntake(input)
	s.mu.Lock()
	defer s.mu.Unlock()
	b, _ := json.Marshal(input)
	now := time.Now().UTC()
	v := Intake{ID: s.id("intake"), Owner: owner, Payload: b, CreatedAt: now}
	s.intakes[v.ID] = memoryOwned[Intake]{owner, v}
	return v, nil
}
func (s *MemoryStore) GetIntake(_ context.Context, owner, id string) (Intake, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.intakes[id]
	if !ok || v.Owner != owner {
		return Intake{}, ErrNotFound
	}
	return v.Value, nil
}
func (s *MemoryStore) CreateBatchFromIntake(ctx context.Context, owner, intakeID string, input CreateBatchInput) (Batch, error) {
	s.mu.Lock()
	owned, ok := s.intakes[intakeID]
	if !ok || owned.Owner != owner {
		s.mu.Unlock()
		return Batch{}, ErrNotFound
	}
	if owned.Value.ConsumedAt != nil {
		s.mu.Unlock()
		return Batch{}, ErrConflict
	}
	var intake NovelFetchIntakeInput
	_ = json.Unmarshal(owned.Value.Payload, &intake)
	if len(input.Books) == 0 {
		input.Books = intake.Books
	}
	if input.Title == "" {
		input.Title = "Novel Fetch Batch"
	}
	s.mu.Unlock()
	batch, err := s.CreateBatch(ctx, owner, input)
	if err != nil {
		return Batch{}, err
	}
	s.mu.Lock()
	now := time.Now().UTC()
	v := owned.Value
	v.ConsumedAt = &now
	s.intakes[intakeID] = memoryOwned[Intake]{owner, v}
	b := s.batches[batch.ID]
	bv := b.Value
	bv.SourceIntakeID = intakeID
	s.batches[batch.ID] = memoryOwned[Batch]{owner, bv}
	batch = hydrateMemoryBatchSettingsState(bv, s.patches)
	s.mu.Unlock()
	return batch, nil
}
func (s *MemoryStore) CreateBatch(_ context.Context, owner string, input CreateBatchInput) (Batch, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	b := Batch{ID: s.id("batch"), Title: input.Title, Revision: 1, Books: []Book{}, CreatedAt: now, UpdatedAt: now}
	if b.Title == "" {
		b.Title = "Untitled Batch"
	}
	for _, bi := range input.Books {
		book := Book{ID: s.id("book"), BatchID: b.ID, Title: bi.Title, SourceText: bi.SourceText, Revision: 1, Videos: []Video{}}
		book.BookID = book.ID
		for _, vi := range bi.Videos {
			video := Video{ID: s.id("video"), BatchID: b.ID, BookID: book.ID, Label: vi.Label, VisualPrompt: vi.VisualPrompt, DurationSeconds: vi.DurationSeconds, CompatibilityState: "active", Revision: 1}
			book.Videos = append(book.Videos, video)
		}
		b.Books = append(b.Books, book)
	}
	s.batches[b.ID] = memoryOwned[Batch]{owner, b}
	return hydrateMemoryBatchSettingsState(b, s.patches), nil
}
func (s *MemoryStore) ListBatches(_ context.Context, owner string) ([]Batch, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Batch{}
	for _, v := range s.batches {
		if v.Owner == owner {
			out = append(out, hydrateMemoryBatchSettingsState(v.Value, s.patches))
		}
	}
	return out, nil
}
func (s *MemoryStore) GetBatch(_ context.Context, owner, id string) (Batch, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.batches[id]
	if !ok || v.Owner != owner {
		return Batch{}, ErrNotFound
	}
	return hydrateMemoryBatchSettingsState(v.Value, s.patches), nil
}
func (s *MemoryStore) SaveSettings(_ context.Context, owner string, ref ScopeRef, update SettingsUpdate) (SettingsResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	owned, ok := s.batches[ref.BatchID]
	if !ok || owned.Owner != owner {
		return SettingsResult{}, ErrNotFound
	}
	b := owned.Value
	var rev *int64
	switch ref.Kind {
	case ScopeBatch:
		rev = &b.Revision
	case ScopeBook:
		for i := range b.Books {
			if b.Books[i].ID == ref.BookID {
				rev = &b.Books[i].Revision
				break
			}
		}
	case ScopeVideo:
		for i := range b.Books {
			if b.Books[i].ID != ref.BookID {
				continue
			}
			for j := range b.Books[i].Videos {
				if b.Books[i].Videos[j].ID == ref.VideoID {
					rev = &b.Books[i].Videos[j].Revision
					break
				}
			}
		}
	}
	if rev == nil {
		return SettingsResult{}, ErrNotFound
	}
	if update.ExpectedRevision != *rev {
		return SettingsResult{}, ErrConflict
	}
	versionID, selectsVersion, err := configVersionIDFromUpdate(ref, update)
	if err != nil {
		return SettingsResult{}, err
	}
	if selectsVersion {
		version, exists := s.configVersions[versionID]
		if !exists || (version.Owner != "" && version.Owner != owner) {
			return SettingsResult{}, ErrNotFound
		}
	}
	(*rev)++
	patch := ApplySparseUpdate(s.patches[scopeKey(ref)], update)
	s.patches[scopeKey(ref)] = patch
	b.UpdatedAt = time.Now().UTC()
	s.batches[b.ID] = memoryOwned[Batch]{owner, b}
	effective := SettingsPatch{}
	batchPatch := s.patches[scopeKey(ScopeRef{Kind: ScopeBatch, BatchID: b.ID})]
	effective = ResolveSettings(effective, batchPatch)
	if ref.BookID != "" {
		effective = ResolveSettings(effective, s.patches[scopeKey(ScopeRef{Kind: ScopeBook, BatchID: b.ID, BookID: ref.BookID})])
	}
	if ref.VideoID != "" {
		effective = ResolveSettings(effective, s.patches[scopeKey(ScopeRef{Kind: ScopeVideo, BatchID: b.ID, BookID: ref.BookID, VideoID: ref.VideoID})])
	}
	snap := ConfigSnapshot{ID: s.id("snapshot"), BatchID: b.ID, BookID: ref.BookID, VideoID: ref.VideoID, Effective: effective, CreatedAt: time.Now().UTC()}
	return SettingsResult{Scope: ref, Patch: clonePatch(patch), Revision: *rev, Snapshot: &snap}, nil
}
func (s *MemoryStore) ConfigVersions(_ context.Context, owner string) ([]ConfigVersion, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []ConfigVersion{}
	for _, version := range s.configVersions {
		if version.Owner == "" || version.Owner == owner {
			out = append(out, version.Value)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	return out, nil
}
func (s *MemoryStore) ChangeImpact(_ context.Context, owner, batchID string, u SettingsUpdate) (ChangeImpact, error) {
	b, err := s.GetBatch(context.Background(), owner, batchID)
	if err != nil {
		return ChangeImpact{}, err
	}
	videos := 0
	for _, book := range b.Books {
		videos += len(book.Videos)
	}
	return ChangeImpact{AffectedBooks: len(b.Books), AffectedVideos: videos, InvalidatesDirector: false, PreservesOverrides: true, ChangedKeys: ChangedKeys(u)}, nil
}
func (s *MemoryStore) ListPrompts(_ context.Context, owner, kind string) ([]Prompt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Prompt{}
	for _, p := range s.prompts[owner] {
		if kind == "" || p.Kind == kind {
			out = append(out, p)
		}
	}
	return out, nil
}
func (s *MemoryStore) CreatePrompt(_ context.Context, owner string, p Prompt) (Prompt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p.ID = s.id("prompt")
	p.VersionID = s.id("prompt-version")
	p.Revision = 1
	p.CreatedAt = time.Now().UTC()
	s.prompts[owner] = append(s.prompts[owner], p)
	return p, nil
}
func draftKey(owner, key, kind, scope string) string {
	return owner + ":" + key + ":" + kind + ":" + scope
}
func (s *MemoryStore) GetDraft(_ context.Context, owner, key, kind, scope string) (Draft, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.drafts[draftKey(owner, key, kind, scope)]
	if !ok {
		return Draft{}, ErrNotFound
	}
	return v, nil
}
func (s *MemoryStore) SaveDraft(_ context.Context, owner string, d Draft) (Draft, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := draftKey(owner, d.Key, d.Kind, d.Scope)
	old := s.drafts[k]
	d.Revision = old.Revision + 1
	if d.Revision == 0 {
		d.Revision = 1
	}
	d.UpdatedAt = time.Now().UTC()
	s.drafts[k] = d
	return d, nil
}
