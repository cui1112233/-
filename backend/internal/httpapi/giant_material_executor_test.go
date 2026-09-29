package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qiantie/backend/internal/giantmaterialexecutor"
)

func TestGiantMaterialExecutorRoutesKeepControlPlaneSeparateAndHideVideoURL(t *testing.T) {
	now := time.Date(2026, 9, 29, 13, 0, 0, 0, time.UTC)
	service := giantmaterialexecutor.NewService(giantmaterialexecutor.NewMemoryStore(), func() time.Time { return now })
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, GiantMaterialExecutor: service})

	pairingResponse := signedJSONRequest(t, api, now, "alice", http.MethodPost, "/api/shuihuo-production/giant-material-executor/pairings", map[string]any{"platform": giantmaterialexecutor.PlatformGiantMaterial})
	if pairingResponse.Code != http.StatusCreated {
		t.Fatalf("pairing=%d body=%s", pairingResponse.Code, pairingResponse.Body.String())
	}
	pairing := decodeBody[giantmaterialexecutor.PairingSecret](t, pairingResponse)

	pairedRequest := signedJSONRequest(t, api, now, "alice", http.MethodPost, "/api/giant-material-executor/v1/pair", map[string]any{"code": pairing.Code, "platform": giantmaterialexecutor.PlatformGiantMaterial, "deviceName": "win-box", "os": "windows", "version": "0.1.0"})
	if pairedRequest.Code != http.StatusOK {
		t.Fatalf("pair=%d body=%s", pairedRequest.Code, pairedRequest.Body.String())
	}
	paired := decodeBody[giantmaterialexecutor.PairResult](t, pairedRequest)

	jobRequest := signedJSONRequest(t, api, now, "alice", http.MethodPost, "/api/shuihuo-production/giant-material-jobs", map[string]any{"platform": giantmaterialexecutor.PlatformGiantMaterial, "materialId": "7689285397448523826", "platformBookId": "book-1", "title": "滚屏测试", "videoUrl": "https://material.hnqingyuwen.top/n8_videos/sample.mp4", "modelVersion": "windows-paddleocr-v1"})
	if jobRequest.Code != http.StatusCreated {
		t.Fatalf("job=%d body=%s", jobRequest.Code, jobRequest.Body.String())
	}
	job := decodeBody[map[string]giantmaterialexecutor.JobView](t, jobRequest)["job"]
	if job.ID == "" || job.State != giantmaterialexecutor.JobQueued {
		t.Fatalf("job=%+v", job)
	}
	if body := jobRequest.Body.String(); body == "" || containsAny(body, "n8_videos/sample.mp4", "leaseToken") {
		t.Fatalf("public response leaked private fields: %s", body)
	}

	claim := bearerJSONRequest(t, api, paired.Token, http.MethodPost, "/api/giant-material-executor/v1/jobs/claim", nil)
	if claim.Code != http.StatusOK {
		t.Fatalf("claim=%d body=%s", claim.Code, claim.Body.String())
	}
	claimValue := decodeBody[giantmaterialexecutor.ClaimResult](t, claim)
	progressBody := map[string]any{"leaseToken": claimValue.LeaseToken, "leaseGeneration": claimValue.LeaseGeneration, "state": giantmaterialexecutor.JobRunning, "completed": 1, "total": 1, "percent": 100}
	if progress := bearerJSONRequest(t, api, paired.Token, http.MethodPost, "/api/giant-material-executor/v1/jobs/"+job.ID+"/progress", progressBody); progress.Code != http.StatusOK {
		t.Fatalf("progress=%d body=%s", progress.Code, progress.Body.String())
	}
	get := signedJSONRequest(t, api, now, "alice", http.MethodGet, "/api/shuihuo-production/giant-material-jobs/"+job.ID, nil)
	if get.Code != http.StatusOK {
		t.Fatalf("get=%d body=%s", get.Code, get.Body.String())
	}
}

func bearerJSONRequest(t *testing.T, api http.Handler, token, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(payload))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	return rec
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
}
