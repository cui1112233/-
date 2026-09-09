package mergeworker

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandlerRequiresBearerAuthentication(t *testing.T) {
	handler := NewHandler("service-secret", NewMemoryStore(), NewMemoryQueue())
	req := httptest.NewRequest(http.MethodPost, "/v1/merge", bytes.NewBufferString(`{"batchId":"batch-1","sources":[]}`))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestHandlerSubmitPreservesOrderedSourcesAndQueuesJob(t *testing.T) {
	store := NewMemoryStore()
	queue := NewMemoryQueue()
	handler := NewHandler("service-secret", store, queue)
	payload := SubmitRequest{
		BatchID: "batch-1",
		Sources: []Source{
			{ProductionJobID: "production-1", VideoID: "video-1", MediaURL: "https://media.example/1.mp4", Order: 0},
			{ProductionJobID: "production-2", VideoID: "video-2", MediaURL: "https://media.example/2.mp4", Order: 1},
		},
		TimingMode: "speed",
		Speed:      1,
		TTSSpeed:   1.7,
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/v1/merge", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer service-secret")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	var response Job
	if err := json.Unmarshal(res.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.ID == "" || response.Status != StateQueued {
		t.Fatalf("response=%+v", response)
	}
	stored, err := store.Get(req.Context(), response.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.Sources) != 2 || stored.Sources[0].VideoID != "video-1" || stored.Sources[1].VideoID != "video-2" {
		t.Fatalf("sources=%+v", stored.Sources)
	}
	if got := queue.IDs(); len(got) != 1 || got[0] != response.ID {
		t.Fatalf("queue=%v", got)
	}
}

func TestHandlerRejectsNonContiguousSourceOrder(t *testing.T) {
	handler := NewHandler("service-secret", NewMemoryStore(), NewMemoryQueue())
	payload := SubmitRequest{BatchID: "batch-1", Sources: []Source{{ProductionJobID: "production-1", VideoID: "video-1", MediaURL: "https://media.example/1.mp4", Order: 1}}}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/v1/merge", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer service-secret")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestHandlerPollReturnsStoredJob(t *testing.T) {
	store := NewMemoryStore()
	queue := NewMemoryQueue()
	handler := NewHandler("service-secret", store, queue)
	job, err := store.Create(httptest.NewRequest(http.MethodGet, "/", nil).Context(), Job{ID: "merge-task-1", BatchID: "batch-1", Status: StateSucceeded, OutputURL: "https://media.example/merged.mp4"})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/merge/"+job.ID, nil)
	req.Header.Set("Authorization", "Bearer service-secret")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	var response Job
	if err := json.Unmarshal(res.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Status != StateSucceeded || response.OutputURL != "https://media.example/merged.mp4" {
		t.Fatalf("response=%+v", response)
	}
}
