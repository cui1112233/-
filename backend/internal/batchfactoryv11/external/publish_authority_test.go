package external

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
)

type publishBatchReader struct{ batch batchfactoryv11.Batch }
func (r publishBatchReader) GetBatch(_ context.Context, _ string, id string) (batchfactoryv11.Batch, error) {
	if id != r.batch.ID { return batchfactoryv11.Batch{}, batchfactoryv11.ErrNotFound }
	return r.batch, nil
}

type publishProductionReader struct{ status batchfactoryv11.BatchStatus }
func (r publishProductionReader) GetBatchStatus(context.Context, string, string) (batchfactoryv11.BatchStatus, error) {
	return r.status, nil
}

type publishMergeReader struct{ jobs []batchfactoryv11.MergeJob }
func (r publishMergeReader) GetBatchStatus(context.Context, string, string) ([]batchfactoryv11.MergeJob, error) {
	return r.jobs, nil
}

func TestCreateIntentBindsAuthoritativeProductionAndMergeMedia(t *testing.T) {
	batch := batchfactoryv11.Batch{
		ID: "batch-1",
		Books: []batchfactoryv11.Book{{
			ID: "book-1",
			DirectorRevision: &batchfactoryv11.DirectorRevision{ID: "rev-1"},
			Videos: []batchfactoryv11.Video{{ID: "video-1"}},
		}},
	}
	service := &Service{
		Credentials: NewMemoryStore(), Intents: NewMemoryStore(), Audits: NewMemoryStore(),
		BatchReader: publishBatchReader{batch: batch},
		ProductionReader: publishProductionReader{status: batchfactoryv11.BatchStatus{BatchID: batch.ID, Jobs: []batchfactoryv11.ProductionJob{{
			BookID: "book-1", DirectorRevisionID: "rev-1",
			Tasks: []batchfactoryv11.ProductionTask{{VideoID: "video-1", Status: batchfactoryv11.ProductionSucceeded, MediaURL: "https://owned.example/video.mp4"}},
		}}}},
		MergeReader: publishMergeReader{jobs: []batchfactoryv11.MergeJob{{Status: batchfactoryv11.MergeSucceeded, OutputURL: "https://owned.example/merged.mp4", UpdatedAt: time.Unix(2, 0)}}},
		Enabled: map[Provider]bool{Provider121: true},
		Now: func() time.Time { return time.Unix(10, 0).UTC() },
	}
	payload := json.RawMessage(`{"books":[{"id":"book-1","videos":[{"id":"video-1","url":"https://attacker.example/video.mp4"}]}]}`)
	intent, err := service.CreateIntent(context.Background(), "alice", "121", batch.ID, "", payload)
	if err != nil { t.Fatal(err) }
	var document map[string]any
	if err := json.Unmarshal(intent.Payload, &document); err != nil { t.Fatal(err) }
	books := document["books"].([]any)
	book := books[0].(map[string]any)
	video := book["videos"].([]any)[0].(map[string]any)
	if video["url"] != "https://owned.example/video.mp4" || book["mergedUrl"] != "https://owned.example/merged.mp4" {
		t.Fatalf("payload was not bound to owned media: %#v", document)
	}
}

func TestCreateIntentRejectsWithoutCompletedMerge(t *testing.T) {
	batch := batchfactoryv11.Batch{ID: "batch-1", Books: []batchfactoryv11.Book{{
		ID: "book-1", DirectorRevision: &batchfactoryv11.DirectorRevision{ID: "rev-1"},
		Videos: []batchfactoryv11.Video{{ID: "video-1"}},
	}}}
	service := &Service{
		Intents: NewMemoryStore(), BatchReader: publishBatchReader{batch: batch},
		ProductionReader: publishProductionReader{status: batchfactoryv11.BatchStatus{Jobs: []batchfactoryv11.ProductionJob{{BookID: "book-1", DirectorRevisionID: "rev-1", Tasks: []batchfactoryv11.ProductionTask{{VideoID: "video-1", Status: batchfactoryv11.ProductionSucceeded, MediaURL: "https://owned.example/video.mp4"}}}}}},
		MergeReader: publishMergeReader{},
		Enabled: map[Provider]bool{Provider121: true},
	}
	_, err := service.CreateIntent(context.Background(), "alice", "121", batch.ID, "", json.RawMessage(`{"books":[{"id":"book-1","videos":[{"id":"video-1"}]}]}`))
	if !errors.Is(err, ErrConflict) { t.Fatalf("expected merge conflict, got %v", err) }
}
