package batchfactoryv11

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type H3CanonicalTimelineRevision struct {
	ID        string              `json:"id"`
	Owner     string              `json:"-"`
	BatchID   string              `json:"batch_id"`
	BookID    string              `json:"book_id"`
	Timeline  H3CanonicalTimeline `json:"timeline"`
	CreatedAt time.Time           `json:"created_at"`
}

// H3AudioMeasurementRevision is written by the trusted TTS/media probe path.
// Browser compile requests may only reference AssetID; they never provide the
// canonical duration used by the timeline allocator.
type H3AudioMeasurementRevision struct {
	ID          string             `json:"id"`
	Owner       string             `json:"-"`
	BatchID     string             `json:"batch_id"`
	BookID      string             `json:"book_id"`
	Measurement H3AudioMeasurement `json:"measurement"`
	CreatedAt   time.Time          `json:"created_at"`
}

type H3VideoCompilationRevision struct {
	ID          string             `json:"id"`
	Owner       string             `json:"-"`
	BatchID     string             `json:"batch_id"`
	BookID      string             `json:"book_id"`
	Compilation H3VideoCompilation `json:"compilation"`
	CreatedAt   time.Time          `json:"created_at"`
}

type H3Repository interface {
	PersistH3AudioMeasurement(context.Context, string, string, string, H3AudioMeasurement) (H3AudioMeasurementRevision, error)
	GetH3AudioMeasurement(context.Context, string, string, string, string) (H3AudioMeasurementRevision, error)
	PersistH3CanonicalTimeline(context.Context, string, string, string, H3CanonicalTimeline) (H3CanonicalTimelineRevision, error)
	GetH3CanonicalTimeline(context.Context, string, string) (H3CanonicalTimelineRevision, error)
	PersistH3VideoCompilation(context.Context, string, string, string, H3VideoCompilation) (H3VideoCompilationRevision, error)
	GetH3VideoCompilation(context.Context, string, string) (H3VideoCompilationRevision, error)
	LatestH3VideoCompilation(context.Context, string, string, string, string) (H3VideoCompilationRevision, error)
}

var _ H3Repository = (*MemoryStore)(nil)
var _ H3Repository = (*MySQLStore)(nil)

func (s *MemoryStore) PersistH3AudioMeasurement(_ context.Context, owner, batchID, bookID string, measurement H3AudioMeasurement) (H3AudioMeasurementRevision, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := validateH3AudioMeasurement(measurement); err != nil {
		return H3AudioMeasurementRevision{}, err
	}
	owned, ok := s.batches[batchID]
	if !ok || owned.Owner != owner {
		return H3AudioMeasurementRevision{}, ErrNotFound
	}
	bookFound := false
	for _, book := range owned.Value.Books {
		if book.ID == bookID {
			bookFound = true
			break
		}
	}
	if !bookFound {
		return H3AudioMeasurementRevision{}, ErrNotFound
	}
	revisions := s.directors[memoryBookKey(batchID, bookID)]
	if len(revisions) == 0 || revisions[len(revisions)-1].Output.H3Director == nil {
		return H3AudioMeasurementRevision{}, ErrConflict
	}
	active := revisions[len(revisions)-1].Output.H3Director
	if measurement.VideoSourceRevision != active.VideoSourceRevision || measurement.VideoSourceHash != active.VideoSourceHash {
		return H3AudioMeasurementRevision{}, fmt.Errorf("%w: audio measurement does not match active H3 video source", ErrConflict)
	}
	for _, stored := range s.h3AudioMeasurements {
		value := stored.Value
		if stored.Owner == owner && value.BookID == bookID && value.Measurement.AssetID == measurement.AssetID && value.Measurement.ContentHash == measurement.ContentHash {
			return value, nil
		}
	}
	value := H3AudioMeasurementRevision{
		ID: s.id("h3-audio"), Owner: owner, BatchID: batchID, BookID: bookID,
		Measurement: measurement, CreatedAt: time.Now().UTC(),
	}
	s.h3AudioMeasurements[value.ID] = memoryOwned[H3AudioMeasurementRevision]{Owner: owner, Value: value}
	return value, nil
}

func (s *MemoryStore) GetH3AudioMeasurement(_ context.Context, owner, batchID, bookID, assetID string) (H3AudioMeasurementRevision, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var latest H3AudioMeasurementRevision
	found := false
	for _, stored := range s.h3AudioMeasurements {
		value := stored.Value
		if stored.Owner != owner || value.BatchID != batchID || value.BookID != bookID || value.Measurement.AssetID != assetID {
			continue
		}
		if !found || value.CreatedAt.After(latest.CreatedAt) || (value.CreatedAt.Equal(latest.CreatedAt) && value.ID > latest.ID) {
			latest, found = value, true
		}
	}
	if !found {
		return H3AudioMeasurementRevision{}, ErrNotFound
	}
	return latest, nil
}

func validateH3AudioMeasurement(measurement H3AudioMeasurement) error {
	if strings.TrimSpace(measurement.AssetID) == "" || strings.TrimSpace(measurement.ContentHash) == "" || measurement.DurationMS <= 0 || strings.TrimSpace(measurement.VideoSourceRevision) == "" || strings.TrimSpace(measurement.VideoSourceHash) == "" {
		return ErrInvalid
	}
	return nil
}

func (s *MemoryStore) PersistH3CanonicalTimeline(_ context.Context, owner, batchID, bookID string, timeline H3CanonicalTimeline) (H3CanonicalTimelineRevision, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.memoryOwnsH3BookAndDirector(owner, batchID, bookID, timeline.DirectorRevisionID) {
		return H3CanonicalTimelineRevision{}, ErrNotFound
	}
	if timeline.SchemaVersion != h3CanonicalTimelineSchemaV1 || strings.TrimSpace(timeline.InputHash) == "" || timeline.AudioDurationMS <= 0 {
		return H3CanonicalTimelineRevision{}, ErrInvalid
	}
	for _, owned := range s.h3Timelines {
		value := owned.Value
		if owned.Owner == owner && value.BookID == bookID && value.Timeline.InputHash == timeline.InputHash {
			return cloneH3TimelineRevision(value), nil
		}
	}
	value := H3CanonicalTimelineRevision{
		ID:        s.id("h3-timeline"),
		Owner:     owner,
		BatchID:   batchID,
		BookID:    bookID,
		Timeline:  cloneH3Timeline(timeline),
		CreatedAt: time.Now().UTC(),
	}
	s.h3Timelines[value.ID] = memoryOwned[H3CanonicalTimelineRevision]{Owner: owner, Value: value}
	return cloneH3TimelineRevision(value), nil
}

func (s *MemoryStore) GetH3CanonicalTimeline(_ context.Context, owner, id string) (H3CanonicalTimelineRevision, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	owned, ok := s.h3Timelines[id]
	if !ok || owned.Owner != owner {
		return H3CanonicalTimelineRevision{}, ErrNotFound
	}
	return cloneH3TimelineRevision(owned.Value), nil
}

func (s *MemoryStore) PersistH3VideoCompilation(_ context.Context, owner, batchID, bookID string, compilation H3VideoCompilation) (H3VideoCompilationRevision, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if compilation.SchemaVersion != h3VideoCompilationSchemaV1 || strings.TrimSpace(compilation.InputHash) == "" || len(compilation.Segments) == 0 {
		return H3VideoCompilationRevision{}, ErrInvalid
	}
	ownedTimeline, ok := s.h3Timelines[compilation.CanonicalTimelineID]
	if !ok || ownedTimeline.Owner != owner {
		return H3VideoCompilationRevision{}, ErrNotFound
	}
	timeline := ownedTimeline.Value
	if timeline.BatchID != batchID || timeline.BookID != bookID || timeline.Timeline.DirectorRevisionID != compilation.DirectorRevisionID {
		return H3VideoCompilationRevision{}, ErrConflict
	}
	for _, owned := range s.h3Compilations {
		value := owned.Value
		if owned.Owner == owner && value.BookID == bookID && value.Compilation.InputHash == compilation.InputHash {
			return cloneH3CompilationRevision(value), nil
		}
	}
	value := H3VideoCompilationRevision{
		ID:          s.id("h3-compilation"),
		Owner:       owner,
		BatchID:     batchID,
		BookID:      bookID,
		Compilation: cloneH3Compilation(compilation),
		CreatedAt:   time.Now().UTC(),
	}
	s.h3Compilations[value.ID] = memoryOwned[H3VideoCompilationRevision]{Owner: owner, Value: value}
	return cloneH3CompilationRevision(value), nil
}

func (s *MemoryStore) GetH3VideoCompilation(_ context.Context, owner, id string) (H3VideoCompilationRevision, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	owned, ok := s.h3Compilations[id]
	if !ok || owned.Owner != owner {
		return H3VideoCompilationRevision{}, ErrNotFound
	}
	return cloneH3CompilationRevision(owned.Value), nil
}

func (s *MemoryStore) LatestH3VideoCompilation(_ context.Context, owner, batchID, bookID, directorRevisionID string) (H3VideoCompilationRevision, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var latest H3VideoCompilationRevision
	found := false
	for _, owned := range s.h3Compilations {
		value := owned.Value
		if owned.Owner != owner || value.BatchID != batchID || value.BookID != bookID || value.Compilation.DirectorRevisionID != directorRevisionID {
			continue
		}
		if !found || value.CreatedAt.After(latest.CreatedAt) || (value.CreatedAt.Equal(latest.CreatedAt) && value.ID > latest.ID) {
			latest, found = value, true
		}
	}
	if !found {
		return H3VideoCompilationRevision{}, ErrNotFound
	}
	return cloneH3CompilationRevision(latest), nil
}

func (s *MemoryStore) memoryOwnsH3BookAndDirector(owner, batchID, bookID, directorRevisionID string) bool {
	owned, ok := s.batches[batchID]
	if !ok || owned.Owner != owner {
		return false
	}
	bookFound := false
	for _, book := range owned.Value.Books {
		if book.ID == bookID {
			bookFound = true
			break
		}
	}
	if !bookFound {
		return false
	}
	for _, revision := range s.directors[memoryBookKey(batchID, bookID)] {
		if revision.ID == directorRevisionID {
			return true
		}
	}
	return false
}

func cloneH3TimelineRevision(value H3CanonicalTimelineRevision) H3CanonicalTimelineRevision {
	value.Timeline = cloneH3Timeline(value.Timeline)
	return value
}

func cloneH3CompilationRevision(value H3VideoCompilationRevision) H3VideoCompilationRevision {
	value.Compilation = cloneH3Compilation(value.Compilation)
	return value
}

func cloneH3Timeline(value H3CanonicalTimeline) H3CanonicalTimeline {
	var clone H3CanonicalTimeline
	cloneH3JSON(value, &clone)
	return clone
}

func cloneH3Compilation(value H3VideoCompilation) H3VideoCompilation {
	var clone H3VideoCompilation
	cloneH3JSON(value, &clone)
	return clone
}

func cloneH3JSON(value, target any) {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	if err := json.Unmarshal(raw, target); err != nil {
		panic(err)
	}
}
