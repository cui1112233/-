package batchfactoryv11

import (
	"context"
	"database/sql"
)

// ReadbackMySQLStore keeps MySQLStore as the single write authority while
// hydrating the sparse settings state required by the V11 browser contract.
// It deliberately does not copy or reinterpret patches: loadPatch returns the
// exact persisted JSON values, including false, "", and 0.
type ReadbackMySQLStore struct {
	*MySQLStore
}

var _ Store = (*ReadbackMySQLStore)(nil)

func NewReadbackMySQLStore(db *sql.DB) *ReadbackMySQLStore {
	return &ReadbackMySQLStore{MySQLStore: NewMySQLStore(db)}
}

func (s *ReadbackMySQLStore) hydrateSettingsState(ctx context.Context, owner string, batch Batch) (Batch, error) {
	patch, err := loadPatch(ctx, s.db, owner, ScopeRef{Kind: ScopeBatch, BatchID: batch.ID})
	if err != nil {
		return Batch{}, err
	}
	batch.SettingsState = SettingsState{Patch: clonePatch(patch), Revision: batch.Revision}

	for bookIndex := range batch.Books {
		book := &batch.Books[bookIndex]
		patch, err := loadPatch(ctx, s.db, owner, ScopeRef{Kind: ScopeBook, BatchID: batch.ID, BookID: book.ID})
		if err != nil {
			return Batch{}, err
		}
		book.SettingsState = SettingsState{Patch: clonePatch(patch), Revision: book.Revision}

		for videoIndex := range book.Videos {
			video := &book.Videos[videoIndex]
			patch, err := loadPatch(ctx, s.db, owner, ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: video.ID})
			if err != nil {
				return Batch{}, err
			}
			video.SettingsState = SettingsState{Patch: clonePatch(patch), Revision: video.Revision}
		}
	}
	return batch, nil
}

func (s *ReadbackMySQLStore) GetBatch(ctx context.Context, owner, id string) (Batch, error) {
	batch, err := s.MySQLStore.GetBatch(ctx, owner, id)
	if err != nil {
		return Batch{}, err
	}
	return s.hydrateSettingsState(ctx, owner, batch)
}

func (s *ReadbackMySQLStore) ListBatches(ctx context.Context, owner string) ([]Batch, error) {
	batches, err := s.MySQLStore.ListBatches(ctx, owner)
	if err != nil {
		return nil, err
	}
	out := make([]Batch, 0, len(batches))
	for _, batch := range batches {
		hydrated, err := s.hydrateSettingsState(ctx, owner, batch)
		if err != nil {
			return nil, err
		}
		out = append(out, hydrated)
	}
	return out, nil
}
