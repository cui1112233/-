package httpapi

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
)

type concurrentDirectorHTTPProvider struct {
	mu        sync.Mutex
	active    int
	maxActive int
	calls     int
	delay     time.Duration
}

func (p *concurrentDirectorHTTPProvider) Complete(_ context.Context, _ batchfactoryv11.TextCompletionRequest) (string, error) {
	p.mu.Lock()
	p.calls++
	p.active++
	if p.active > p.maxActive {
		p.maxActive = p.active
	}
	p.mu.Unlock()

	time.Sleep(p.delay)

	p.mu.Lock()
	p.active--
	p.mu.Unlock()
	return directorHTTPJSON, nil
}

func (p *concurrentDirectorHTTPProvider) stats() (calls, maxActive int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.calls, p.maxActive
}

func TestBatchDirectorRunsMultipleBooksConcurrently(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	batch, err := store.CreateBatch(context.Background(), "alice", batchfactoryv11.CreateBatchInput{
		Title: "multi-book",
		Books: []batchfactoryv11.CreateBookInput{
			{Title: "book-a", SourceText: "林晚推门进入客厅。"},
			{Title: "book-b", SourceText: "林晚推门进入客厅。"},
			{Title: "book-c", SourceText: "林晚推门进入客厅。"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	provider := &concurrentDirectorHTTPProvider{delay: 120 * time.Millisecond}
	service := &batchfactoryv11.DirectorService{Store: store, Provider: provider}
	api := NewRouter(RouterOptions{
		BridgeSecret: "secret",
		Now:          func() time.Time { return now },
		Slice:        2,
		Store:        store,
		Director:     service,
	})

	path := "/api/batch-factory/v11/batches/" + batch.ID + "/director"
	rec := signedJSONRequest(t, api, now, "alice", http.MethodPost, path, map[string]any{})
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	calls, maxActive := provider.stats()
	if calls != 3 {
		t.Fatalf("provider calls=%d want=3", calls)
	}
	if maxActive < 2 {
		t.Fatalf("batch director remained serial: maxActive=%d want>=2", maxActive)
	}

	loaded, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, book := range loaded.Books {
		if book.DirectorRevision == nil || len(book.Videos) == 0 {
			t.Fatalf("book %s lost director/video output: %+v", book.ID, book)
		}
	}
}
