package localexecutor

import "testing"

func TestNewMemoryStoreInitializesAllIndexes(t *testing.T) {
	store := NewMemoryStore()
	if store == nil {
		t.Fatal("NewMemoryStore returned nil")
	}
	for name, value := range map[string]any{
		"pairings": store.pairings,
		"executors": store.executors,
		"tokenIDs": store.tokenIDs,
		"jobs": store.jobs,
		"sourceJobs": store.sourceJobs,
		"artifacts": store.artifacts,
		"jobArtifacts": store.jobArtifacts,
	} {
		if value == nil {
			t.Fatalf("%s map was not initialized", name)
		}
	}
}
