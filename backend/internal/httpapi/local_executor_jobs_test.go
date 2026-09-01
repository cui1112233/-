package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"qiantie/backend/internal/localexecutor"
)

func newExecutorJobTestAPI(t *testing.T, now func() time.Time) (http.Handler, *localexecutor.Service) {
	t.Helper()
	store := localexecutor.NewMemoryStore()
	svc := localexecutor.NewService(store, now)
	root := http.NewServeMux()
	auth := BridgeAuth{Secret: "secret", Now: now}
	RegisterLocalExecutorRoutes(root, auth, svc)
	RegisterLocalExecutorJobRoutes(root, auth, svc)
	return root, svc
}

func pairJobExecutor(t *testing.T, svc *localexecutor.Service, owner string) localexecutor.PairResult {
	t.Helper()
	pairing, err := svc.CreatePairing(context.Background(), owner, localexecutor.PlatformDoubao)
	if err != nil {
		t.Fatal(err)
	}
	paired, err := svc.Pair(context.Background(), localexecutor.PairInput{Code: pairing.Code, DeviceName: owner + "-pc", Platform: localexecutor.PlatformDoubao})
	if err != nil {
		t.Fatal(err)
	}
	return paired
}

func TestLocalExecutorJobWebsiteOwnerIsolation(t *testing.T) {
	now := time.Date(2026, 9, 1, 11, 0, 0, 0, time.UTC)
	api, svc := newExecutorJobTestAPI(t, func() time.Time { return now })
	job, err := svc.CreateJob(context.Background(), "bob", localexecutor.CreateJobInput{SourceTaskID: "video-bob", Platform: localexecutor.PlatformDoubao})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/shuihuo-production/local-executor-jobs/"+job.ID, nil)
	SignBridgeRequest(req, "alice", false, now, "secret")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestLocalExecutorJobClaimRequiresBearerAndRejectsStaleLease(t *testing.T) {
	now := time.Date(2026, 9, 1, 11, 0, 0, 0, time.UTC)
	api, svc := newExecutorJobTestAPI(t, func() time.Time { return now })
	paired := pairJobExecutor(t, svc, "alice")
	job, _ := svc.CreateJob(context.Background(), "alice", localexecutor.CreateJobInput{SourceTaskID: "video-1", Platform: localexecutor.PlatformDoubao})

	unauth := httptest.NewRequest(http.MethodPost, "/api/local-executor/v1/jobs/claim", nil)
	unauthRec := httptest.NewRecorder()
	api.ServeHTTP(unauthRec, unauth)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("unauth=%d", unauthRec.Code)
	}

	claimReq := httptest.NewRequest(http.MethodPost, "/api/local-executor/v1/jobs/claim", nil)
	claimReq.Header.Set("Authorization", "Bearer "+paired.Token)
	claimRec := httptest.NewRecorder()
	api.ServeHTTP(claimRec, claimReq)
	if claimRec.Code != http.StatusOK {
		t.Fatalf("claim=%d body=%s", claimRec.Code, claimRec.Body.String())
	}
	var first localexecutor.ClaimResult
	if err := json.NewDecoder(claimRec.Body).Decode(&first); err != nil {
		t.Fatal(err)
	}

	now = now.Add(61 * time.Second)
	reclaimReq := httptest.NewRequest(http.MethodPost, "/api/local-executor/v1/jobs/claim", nil)
	reclaimReq.Header.Set("Authorization", "Bearer "+paired.Token)
	reclaimRec := httptest.NewRecorder()
	api.ServeHTTP(reclaimRec, reclaimReq)
	if reclaimRec.Code != http.StatusOK {
		t.Fatalf("reclaim=%d body=%s", reclaimRec.Code, reclaimRec.Body.String())
	}

	progressReq := jsonRequest(t, http.MethodPost, "/api/local-executor/v1/jobs/"+job.ID+"/progress", map[string]any{
		"leaseToken": first.LeaseToken, "leaseGeneration": first.LeaseGeneration, "state": "preparing",
	})
	progressReq.Header.Set("Authorization", "Bearer "+paired.Token)
	progressRec := httptest.NewRecorder()
	api.ServeHTTP(progressRec, progressReq)
	if progressRec.Code != http.StatusConflict {
		t.Fatalf("progress=%d body=%s", progressRec.Code, progressRec.Body.String())
	}
}

func TestAcceptedLocalExecutorJobCannotBeReleased(t *testing.T) {
	now := time.Date(2026, 9, 1, 11, 0, 0, 0, time.UTC)
	api, svc := newExecutorJobTestAPI(t, func() time.Time { return now })
	paired := pairJobExecutor(t, svc, "alice")
	job, _ := svc.CreateJob(context.Background(), "alice", localexecutor.CreateJobInput{SourceTaskID: "video-2", Platform: localexecutor.PlatformDoubao})
	claim, _ := svc.ClaimJob(context.Background(), paired.Token)
	lease := localexecutor.LeaseCredential{Token: claim.LeaseToken, Generation: claim.LeaseGeneration}
	if err := svc.RecordProgress(context.Background(), paired.Token, job.ID, lease, localexecutor.JobPreparing); err != nil {
		t.Fatal(err)
	}
	if err := svc.RecordProgress(context.Background(), paired.Token, job.ID, lease, localexecutor.JobSubmitting); err != nil {
		t.Fatal(err)
	}
	if err := svc.RecordAcceptance(context.Background(), paired.Token, job.ID, lease, localexecutor.AcceptanceInput{AccountID: "account-1", SubmissionID: "message-1"}); err != nil {
		t.Fatal(err)
	}

	releaseReq := jsonRequest(t, http.MethodPost, "/api/local-executor/v1/jobs/"+job.ID+"/release", map[string]any{
		"leaseToken": claim.LeaseToken, "leaseGeneration": claim.LeaseGeneration, "reason": "network",
	})
	releaseReq.Header.Set("Authorization", "Bearer "+paired.Token)
	releaseRec := httptest.NewRecorder()
	api.ServeHTTP(releaseRec, releaseReq)
	if releaseRec.Code != http.StatusConflict {
		t.Fatalf("release=%d body=%s", releaseRec.Code, releaseRec.Body.String())
	}
}

func TestCancelledLocalExecutorJobStopsProgress(t *testing.T) {
	now := time.Date(2026, 9, 1, 11, 0, 0, 0, time.UTC)
	api, svc := newExecutorJobTestAPI(t, func() time.Time { return now })
	paired := pairJobExecutor(t, svc, "alice")
	job, _ := svc.CreateJob(context.Background(), "alice", localexecutor.CreateJobInput{SourceTaskID: "video-3", Platform: localexecutor.PlatformDoubao})
	claim, _ := svc.ClaimJob(context.Background(), paired.Token)

	cancelReq := httptest.NewRequest(http.MethodPut, "/api/shuihuo-production/local-executor-jobs/"+job.ID+"/cancel", nil)
	SignBridgeRequest(cancelReq, "alice", false, now, "secret")
	cancelRec := httptest.NewRecorder()
	api.ServeHTTP(cancelRec, cancelReq)
	if cancelRec.Code != http.StatusOK {
		t.Fatalf("cancel=%d body=%s", cancelRec.Code, cancelRec.Body.String())
	}

	progressReq := jsonRequest(t, http.MethodPost, "/api/local-executor/v1/jobs/"+job.ID+"/progress", map[string]any{
		"leaseToken": claim.LeaseToken, "leaseGeneration": claim.LeaseGeneration, "state": "preparing",
	})
	progressReq.Header.Set("Authorization", "Bearer "+paired.Token)
	progressRec := httptest.NewRecorder()
	api.ServeHTTP(progressRec, progressReq)
	if progressRec.Code != http.StatusConflict {
		t.Fatalf("progress=%d body=%s", progressRec.Code, progressRec.Body.String())
	}
}
