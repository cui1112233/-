package httpapi

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
	"qiantie/backend/internal/localartifact"
	"qiantie/backend/internal/mergeworker"
)

func TestVideoUploadCreatesHTTPSManualTaskAndSelectsIt(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	batch, err := store.CreateBatch(context.Background(), "alice", batchfactoryv11.CreateBatchInput{Title: "b", Books: []batchfactoryv11.CreateBookInput{{Title: "k", SourceText: "正文"}}})
	if err != nil {
		t.Fatal(err)
	}
	director := &batchfactoryv11.DirectorService{Store: store, Provider: &directorHTTPProvider{output: directorHTTPJSON}}
	if _, err := director.RunDirector(context.Background(), "alice", batch.ID, batch.Books[0].ID); err != nil {
		t.Fatal(err)
	}
	book, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	video := book.Books[0].Videos[0]
	var uploadedKey string
	output := &mergeworker.TOSObjectStore{
		Bucket:        "bucket-a",
		PublicBaseURL: "https://cdn.example/media",
		PutFile: func(_ context.Context, bucket, key, path, mediaType string) error {
			if bucket != "bucket-a" || mediaType != "video/mp4" || !strings.HasPrefix(key, "batch-uploaded/") || !strings.HasSuffix(key, ".mp4") || path == "" {
				t.Fatalf("unexpected upload bucket=%q key=%q path=%q type=%q", bucket, key, path, mediaType)
			}
			uploadedKey = key
			return nil
		},
	}
	production := &batchfactoryv11.ProductionService{Store: store, Enabled: true}
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 5, Store: store, Production: production, LocalArtifacts: localartifact.NewStore(t.TempDir(), 1<<20), MergeOutput: output})
	path := "/api/batch-factory/v11/batches/" + batch.ID + "/books/" + batch.Books[0].ID + "/videos/" + video.ID + "/upload"
	rec := signedMP4UploadRequest(t, api, now, path, "clip.mp4", []byte("0000ftypisom-uploaded-video"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if uploadedKey == "" {
		t.Fatal("upload was not sent to TOS")
	}
	updated, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	selected := updated.Books[0].Videos[0]
	primary := string(selected.SettingsState.Patch["primaryMediaTaskId"])
	if primary == "" || primary == `""` {
		t.Fatalf("primary task=%q", primary)
	}
	jobs, err := store.ListProductionJobs(context.Background(), "alice", batch.ID)
	if err != nil || len(jobs) != 1 || len(jobs[0].Tasks) != 1 {
		t.Fatalf("jobs=%+v err=%v", jobs, err)
	}
	task := jobs[0].Tasks[0]
	if task.Provider != "manual_upload" || task.Status != batchfactoryv11.ProductionSucceeded || !strings.HasPrefix(task.MediaURL, "https://cdn.example/media/batch-uploaded/") || task.ActualDurationSeconds != 0 {
		t.Fatalf("task=%+v", task)
	}
}

func signedMP4UploadRequest(t *testing.T, api http.Handler, now time.Time, path, filename string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	file, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, path, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	SignBridgeRequest(req, "alice", false, now, "secret")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	return rec
}
