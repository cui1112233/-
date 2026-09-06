package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qiantie/backend/internal/localartifact"
	"qiantie/backend/internal/localexecutor"
)

func TestScriptVideoLocalCompatibilityRouteCreatesQueuedJob(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	store := localexecutor.NewMemoryStore()
	service := localexecutor.NewService(store, func() time.Time { return now })
	api := NewRouter(RouterOptions{
		BridgeSecret:  "secret",
		Now:           func() time.Time { return now },
		LocalExecutors: service,
		LocalArtifacts: localartifact.NewStore(t.TempDir(), 1<<20),
	})

	req := httptest.NewRequest(http.MethodPost, "/api/script-videos/local", strings.NewReader(`{"prompt":"雨夜追车，电影感镜头"}`))
	req.Header.Set("Content-Type", "application/json")
	SignBridgeRequest(req, "alpha-user", false, now, "secret")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("got status=%d body=%s", rec.Code, rec.Body.String())
	}
	var response struct {
		OK     bool   `json:"ok"`
		TaskID string `json:"taskId"`
		Status string `json:"status"`
		Stage  string `json:"stage"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v body=%s", err, rec.Body.String())
	}
	if !response.OK || response.TaskID == "" || response.Status != "processing" || response.Stage != string(localexecutor.JobQueued) {
		t.Fatalf("unexpected response: %+v", response)
	}

	job, err := service.GetJob(context.Background(), "alpha-user", response.TaskID)
	if err != nil {
		t.Fatalf("created job is not readable: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(job.Payload, &payload); err != nil {
		t.Fatalf("decode job payload: %v", err)
	}
	if payload["prompt"] != "雨夜追车，电影感镜头" {
		t.Fatalf("payload=%v", payload)
	}
}

func TestScriptVideoLocalCompatibilityRouteReturnsRealStage(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	store := localexecutor.NewMemoryStore()
	service := localexecutor.NewService(store, func() time.Time { return now })
	api := NewRouter(RouterOptions{
		BridgeSecret:  "secret",
		Now:           func() time.Time { return now },
		LocalExecutors: service,
		LocalArtifacts: localartifact.NewStore(t.TempDir(), 1<<20),
	})

	job, err := service.CreateJob(context.Background(), "alpha-user", localexecutor.CreateJobInput{
		SourceTaskID: "script-video-test-source",
		Platform:     localexecutor.PlatformDoubao,
		Payload:      map[string]any{"prompt": "测试提示词"},
	})
	if err != nil {
		t.Fatalf("create fixture job: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/script-videos/"+job.ID, nil)
	SignBridgeRequest(req, "alpha-user", false, now, "secret")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got status=%d body=%s", rec.Code, rec.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response["taskId"] != job.ID || response["status"] != "processing" || response["stage"] != string(localexecutor.JobQueued) {
		t.Fatalf("response=%v", response)
	}
}
