package batchfactoryv11

import (
	"context"
	"testing"
)

type countingBatchReadStore struct {
	*MemoryStore
	getBatchCalls   int
	ownershipChecks int
}

func (s *countingBatchReadStore) GetBatch(ctx context.Context, owner, batchID string) (Batch, error) {
	s.getBatchCalls++
	return s.MemoryStore.GetBatch(ctx, owner, batchID)
}

func (s *countingBatchReadStore) EnsureBatchOwnership(ctx context.Context, owner, batchID string) error {
	s.ownershipChecks++
	_, err := s.MemoryStore.GetBatch(ctx, owner, batchID)
	return err
}

func TestBookStageSummaryDoesNotReloadWholeBatch(t *testing.T) {
	ctx := context.Background()
	base := NewMemoryStore()
	batch, err := base.CreateBatch(ctx, "alice", CreateBatchInput{
		Title: "runtime status",
		Books: []CreateBookInput{{Title: "book one"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	store := &countingBatchReadStore{MemoryStore: base}
	service := &BookStageService{Store: store}

	if _, err := service.Summary(ctx, "alice", batch.ID, batch.Books[0].ID); err != nil {
		t.Fatal(err)
	}
	if store.getBatchCalls != 0 {
		t.Fatalf("stage summary reloaded the whole batch %d time(s); the stage repository already validates ownership", store.getBatchCalls)
	}
}

func TestProductionStatusUsesLightweightBatchOwnershipCheck(t *testing.T) {
	ctx := context.Background()
	base := NewMemoryStore()
	batch, err := base.CreateBatch(ctx, "alice", CreateBatchInput{Title: "runtime status"})
	if err != nil {
		t.Fatal(err)
	}
	store := &countingBatchReadStore{MemoryStore: base}
	service := &ProductionService{Store: store}

	if _, err := service.GetBatchStatus(ctx, "alice", batch.ID); err != nil {
		t.Fatal(err)
	}
	if store.ownershipChecks != 1 {
		t.Fatalf("ownership checks = %d, want 1", store.ownershipChecks)
	}
	if store.getBatchCalls != 0 {
		t.Fatalf("production status reloaded the whole batch %d time(s)", store.getBatchCalls)
	}
}

func TestMergeStatusUsesLightweightBatchOwnershipCheck(t *testing.T) {
	ctx := context.Background()
	base := NewMemoryStore()
	batch, err := base.CreateBatch(ctx, "alice", CreateBatchInput{Title: "runtime status"})
	if err != nil {
		t.Fatal(err)
	}
	store := &countingBatchReadStore{MemoryStore: base}
	service := &MergeService{Store: store, Enabled: true}

	if _, err := service.GetBatchStatus(ctx, "alice", batch.ID); err != nil {
		t.Fatal(err)
	}
	if store.ownershipChecks != 1 {
		t.Fatalf("ownership checks = %d, want 1", store.ownershipChecks)
	}
	if store.getBatchCalls != 0 {
		t.Fatalf("merge status reloaded the whole batch %d time(s)", store.getBatchCalls)
	}
}
