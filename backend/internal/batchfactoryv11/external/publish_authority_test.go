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
	if id != r.batch.ID {
		return batchfactoryv11.Batch{}, batchfactoryv11.ErrNotFound
	}
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
			ID:               "book-1",
			DirectorRevision: &batchfactoryv11.DirectorRevision{ID: "rev-1"},
			Videos:           []batchfactoryv11.Video{{ID: "video-1"}},
		}},
	}
	service := &Service{
		Credentials: NewMemoryStore(), Intents: NewMemoryStore(), Audits: NewMemoryStore(),
		BatchReader: publishBatchReader{batch: batch},
		ProductionReader: publishProductionReader{status: batchfactoryv11.BatchStatus{BatchID: batch.ID, Jobs: []batchfactoryv11.ProductionJob{{
			BookID: "book-1", DirectorRevisionID: "rev-1",
			Tasks: []batchfactoryv11.ProductionTask{{VideoID: "video-1", Status: batchfactoryv11.ProductionSucceeded, MediaURL: "https://owned.example/video.mp4"}},
		}}}},
		MergeReader: publishMergeReader{jobs: []batchfactoryv11.MergeJob{{ID: "merge-book-1", BookID: "book-1", Status: batchfactoryv11.MergeSucceeded, Sources: []batchfactoryv11.MergeMedia{{VideoID: "video-1", URL: "https://owned.example/video.mp4"}}, OutputURL: "https://owned.example/merged.mp4", UpdatedAt: time.Unix(2, 0)}}},
		Enabled:     map[Provider]bool{Provider121: true},
		Now:         func() time.Time { return time.Unix(10, 0).UTC() },
	}
	payload := json.RawMessage(`{"books":[{"id":"book-1","videos":[{"id":"video-1","url":"https://attacker.example/video.mp4"}]}]}`)
	intent, err := service.CreateIntent(context.Background(), "alice", "121", batch.ID, "", payload)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(intent.Payload, &document); err != nil {
		t.Fatal(err)
	}
	books := document["books"].([]any)
	book := books[0].(map[string]any)
	video := book["videos"].([]any)[0].(map[string]any)
	if video["url"] != "https://owned.example/video.mp4" || book["mergedUrl"] != "https://owned.example/merged.mp4" {
		t.Fatalf("payload was not bound to owned media: %#v", document)
	}
}

func TestSelectBookMergedMediaDefaultsToOneXWhenMultipleFinalVersionsExist(t *testing.T) {
	media := map[string]publishMedia{"video-1": {URL: "https://owned.example/video.mp4"}}
	jobs := []batchfactoryv11.MergeJob{
		{ID: "merge-one-x", BookID: "book-1", Status: batchfactoryv11.MergeSucceeded, Speed: 1, Sources: []batchfactoryv11.MergeMedia{{VideoID: "video-1", URL: "https://owned.example/video.mp4"}}, OutputURL: "https://owned.example/one-x.mp4", UpdatedAt: time.Unix(1, 0)},
		{ID: "merge-one-point-five", BookID: "book-1", Status: batchfactoryv11.MergeSucceeded, Speed: 1.5, Sources: []batchfactoryv11.MergeMedia{{VideoID: "video-1", URL: "https://owned.example/video.mp4"}}, OutputURL: "https://owned.example/one-point-five.mp4", UpdatedAt: time.Unix(2, 0)},
	}

	selected, found := selectBookMergedMedia(jobs, "book-1", media, primaryUploadSource{})
	if !found || selected.ID != "merge-one-x" {
		t.Fatalf("default upload source=%+v", selected)
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
		MergeReader:      publishMergeReader{},
		Enabled:          map[Provider]bool{Provider121: true},
	}
	_, err := service.CreateIntent(context.Background(), "alice", "121", batch.ID, "", json.RawMessage(`{"books":[{"id":"book-1","videos":[{"id":"video-1"}]}]}`))
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("expected merge conflict, got %v", err)
	}
}

func TestCreateIntentUsesEachBooksSelectedUploadVideo(t *testing.T) {
	batch := batchfactoryv11.Batch{ID: "batch-1", Books: []batchfactoryv11.Book{
		{ID: "book-1", DirectorRevision: &batchfactoryv11.DirectorRevision{ID: "rev-1"}, SettingsState: batchfactoryv11.SettingsState{Patch: batchfactoryv11.SettingsPatch{"primaryUploadSource": json.RawMessage(`{"kind":"video","videoId":"video-1","taskId":"task-1"}`)}}, Videos: []batchfactoryv11.Video{{ID: "video-1"}}},
		{ID: "book-2", DirectorRevision: &batchfactoryv11.DirectorRevision{ID: "rev-2"}, Videos: []batchfactoryv11.Video{{ID: "video-2"}}},
	}}
	service := &Service{
		Intents: NewMemoryStore(), BatchReader: publishBatchReader{batch: batch},
		ProductionReader: publishProductionReader{status: batchfactoryv11.BatchStatus{Jobs: []batchfactoryv11.ProductionJob{
			{BookID: "book-1", DirectorRevisionID: "rev-1", Tasks: []batchfactoryv11.ProductionTask{{ID: "task-1", VideoID: "video-1", Status: batchfactoryv11.ProductionSucceeded, MediaURL: "https://owned.example/one.mp4"}}},
			{BookID: "book-2", DirectorRevisionID: "rev-2", Tasks: []batchfactoryv11.ProductionTask{{ID: "task-2", VideoID: "video-2", Status: batchfactoryv11.ProductionSucceeded, MediaURL: "https://owned.example/two.mp4"}}},
		}}},
		MergeReader: publishMergeReader{jobs: []batchfactoryv11.MergeJob{{ID: "merge-book-2", BookID: "book-2", Status: batchfactoryv11.MergeSucceeded, Sources: []batchfactoryv11.MergeMedia{{VideoID: "video-2", URL: "https://owned.example/two.mp4"}}, OutputURL: "https://owned.example/two-merged.mp4", UpdatedAt: time.Unix(2, 0)}}},
		Enabled:     map[Provider]bool{Provider121: true},
	}
	intent, err := service.CreateIntent(context.Background(), "alice", "121", batch.ID, "", json.RawMessage(`{"books":[{"id":"book-1","videos":[{"id":"video-1"}]},{"id":"book-2","videos":[{"id":"video-2"}]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(intent.Payload, &document); err != nil {
		t.Fatal(err)
	}
	books := document["books"].([]any)
	first := books[0].(map[string]any)
	second := books[1].(map[string]any)
	if first["uploadVideoUrl"] != "https://owned.example/one.mp4" || first["coverVideoUrl"] != "https://owned.example/one.mp4" {
		t.Fatalf("first book did not retain its selected first-shot upload source: %#v", first)
	}
	if second["uploadVideoUrl"] != "https://owned.example/two-merged.mp4" || second["uploadVideoKind"] != "merged" {
		t.Fatalf("second book did not receive its own merged upload source: %#v", second)
	}
}
