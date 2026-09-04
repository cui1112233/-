package localexecutor

import "testing"

func TestNewMemoryStoreInitializesCollections(t *testing.T) {
	store := NewMemoryStore()
	if store == nil {
		t.Fatal("NewMemoryStore returned nil")
	}
	if store.pairings == nil || store.executors == nil || store.tokenIDs == nil ||
		store.jobs == nil || store.sourceJobs == nil || store.artifacts == nil || store.jobArtifacts == nil {
		t.Fatal("NewMemoryStore must initialize every in-memory collection")
	}
}
