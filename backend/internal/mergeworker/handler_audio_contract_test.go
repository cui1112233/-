package mergeworker

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandlerPreservesAutomaticAudioTimingRequest(t *testing.T) {
	store := NewMemoryStore()
	queue := NewMemoryQueue()
	handler := NewHandler("service-secret", store, queue)
	payload := SubmitRequest{
		BatchID: "batch-1",
		Sources: []Source{{ProductionJobID: "production-1", VideoID: "video-1", MediaURL: "https://media.example/1.mp4", Order: 0}},
		TimingMode:           "audio",
		Speed:                0,
		AudioDurationSeconds: 6.25,
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
	stored, err := store.Get(req.Context(), response.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.TimingMode != "audio" || stored.Speed != 0 || stored.AudioDurationSeconds != 6.25 {
		t.Fatalf("stored=%+v", stored)
	}
}

func TestHandlerRejectsAudioTimingWithoutAudioDuration(t *testing.T) {
	handler := NewHandler("service-secret", NewMemoryStore(), NewMemoryQueue())
	payload := SubmitRequest{
		BatchID: "batch-1",
		Sources: []Source{{ProductionJobID: "production-1", VideoID: "video-1", MediaURL: "https://media.example/1.mp4", Order: 0}},
		TimingMode: "audio",
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/v1/merge", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer service-secret")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
}
