package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"qiantie/backend/internal/localartifact"
	"qiantie/backend/internal/localexecutor"
)

func artifactTestAPI(t *testing.T, now func() time.Time) (http.Handler, *localexecutor.Service, *localartifact.Store, string) {
	t.Helper()
	rootDir := t.TempDir()
	artifactStore := localartifact.NewStore(rootDir, 1024*1024)
	store := localexecutor.NewMemoryStore()
	svc := localexecutor.NewService(store, now)
	root := http.NewServeMux()
	auth := BridgeAuth{Secret: "secret", Now: now}
	RegisterLocalExecutorRoutes(root, auth, svc)
	RegisterLocalExecutorJobRoutes(root, auth, svc)
	RegisterLocalExecutorArtifactRoutes(root, auth, svc, artifactStore)
	return root, svc, artifactStore, rootDir
}

func acceptedUploadHTTPJob(t *testing.T, svc *localexecutor.Service) (localexecutor.PairResult, localexecutor.JobView, localexecutor.LeaseCredential) {
	t.Helper()
	paired := pairJobExecutor(t, svc, "alice")
	job, err := svc.CreateJob(context.Background(), "alice", localexecutor.CreateJobInput{SourceTaskID: "artifact-http", Platform: localexecutor.PlatformDoubao})
	if err != nil {
		t.Fatal(err)
	}
	claim, err := svc.ClaimJob(context.Background(), paired.Token)
	if err != nil {
		t.Fatal(err)
	}
	lease := localexecutor.LeaseCredential{Token: claim.LeaseToken, Generation: claim.LeaseGeneration}
	for _, state := range []localexecutor.JobState{localexecutor.JobPreparing, localexecutor.JobSubmitting} {
		if err := svc.RecordProgress(context.Background(), paired.Token, job.ID, lease, state); err != nil {
			t.Fatal(err)
		}
	}
	if err := svc.RecordAcceptance(context.Background(), paired.Token, job.ID, lease, localexecutor.AcceptanceInput{AccountID: "acct", SubmissionID: "msg"}); err != nil {
		t.Fatal(err)
	}
	for _, state := range []localexecutor.JobState{localexecutor.JobGenerating, localexecutor.JobDownloading} {
		if err := svc.RecordProgress(context.Background(), paired.Token, job.ID, lease, state); err != nil {
			t.Fatal(err)
		}
	}
	return paired, job, lease
}

func testMP4(payload string) []byte {
	head := []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 0, 0, 'i', 's', 'o', 'm', 'm', 'p', '4', '2'}
	return append(head, []byte(payload)...)
}

func TestLocalExecutorArtifactUploadStoresAndBindsExactMP4(t *testing.T) {
	now := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	api, svc, _, _ := artifactTestAPI(t, func() time.Time { return now })
	paired, job, lease := acceptedUploadHTTPJob(t, svc)
	data := testMP4("exact-video")
	req := httptest.NewRequest(http.MethodPost, "/api/local-executor/v1/jobs/"+job.ID+"/artifact", bytes.NewReader(data))
	req.Header.Set("Authorization", "Bearer "+paired.Token)
	req.Header.Set("Content-Type", "video/mp4")
	req.Header.Set("X-Lease-Token", lease.Token)
	req.Header.Set("X-Lease-Generation", "1")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var response struct {
		ArtifactID string `json:"artifactId"`
		SHA256     string `json:"sha256"`
		ByteSize   int64  `json:"byteSize"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.ArtifactID == "" || response.SHA256 == "" || response.ByteSize != int64(len(data)) {
		t.Fatalf("response=%+v", response)
	}
	artifact, err := svc.GetArtifact(context.Background(), "alice", response.ArtifactID)
	if err != nil {
		t.Fatal(err)
	}
	if artifact.JobID != job.ID || artifact.SHA256 != response.SHA256 {
		t.Fatalf("artifact=%+v", artifact)
	}
}

func TestLocalExecutorArtifactUploadRejectsInvalidMP4WithoutMetadata(t *testing.T) {
	now := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	api, svc, _, rootDir := artifactTestAPI(t, func() time.Time { return now })
	paired, job, lease := acceptedUploadHTTPJob(t, svc)
	req := httptest.NewRequest(http.MethodPost, "/api/local-executor/v1/jobs/"+job.ID+"/artifact", bytes.NewReader([]byte("not-video")))
	req.Header.Set("Authorization", "Bearer "+paired.Token)
	req.Header.Set("Content-Type", "video/mp4")
	req.Header.Set("X-Lease-Token", lease.Token)
	req.Header.Set("X-Lease-Generation", "1")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	entries, err := os.ReadDir(rootDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("artifact files left behind: %v", entries)
	}
}

func TestLocalExecutorArtifactUploadRejectsWrongLeaseBeforePersisting(t *testing.T) {
	now := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	api, svc, _, rootDir := artifactTestAPI(t, func() time.Time { return now })
	paired, job, lease := acceptedUploadHTTPJob(t, svc)
	req := httptest.NewRequest(http.MethodPost, "/api/local-executor/v1/jobs/"+job.ID+"/artifact", bytes.NewReader(testMP4("x")))
	req.Header.Set("Authorization", "Bearer "+paired.Token)
	req.Header.Set("Content-Type", "video/mp4")
	req.Header.Set("X-Lease-Token", lease.Token+"wrong")
	req.Header.Set("X-Lease-Generation", "1")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	entries, err := os.ReadDir(rootDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("artifact files left behind: %v", entries)
	}
}

func TestLocalExecutorArtifactDownloadIsOwnerScoped(t *testing.T) {
	now := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	api, svc, _, _ := artifactTestAPI(t, func() time.Time { return now })
	paired, job, lease := acceptedUploadHTTPJob(t, svc)
	data := testMP4("download-me")
	upload := httptest.NewRequest(http.MethodPost, "/api/local-executor/v1/jobs/"+job.ID+"/artifact", bytes.NewReader(data))
	upload.Header.Set("Authorization", "Bearer "+paired.Token)
	upload.Header.Set("Content-Type", "video/mp4")
	upload.Header.Set("X-Lease-Token", lease.Token)
	upload.Header.Set("X-Lease-Generation", "1")
	uploadRec := httptest.NewRecorder()
	api.ServeHTTP(uploadRec, upload)
	if uploadRec.Code != http.StatusCreated {
		t.Fatalf("upload=%d body=%s", uploadRec.Code, uploadRec.Body.String())
	}
	var response struct{ ArtifactID string `json:"artifactId"` }
	if err := json.NewDecoder(uploadRec.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}

	bobReq := httptest.NewRequest(http.MethodGet, "/api/shuihuo-production/local-executor-artifacts/"+response.ArtifactID, nil)
	SignBridgeRequest(bobReq, "bob", false, now, "secret")
	bobRec := httptest.NewRecorder()
	api.ServeHTTP(bobRec, bobReq)
	if bobRec.Code != http.StatusNotFound {
		t.Fatalf("bob=%d", bobRec.Code)
	}

	aliceReq := httptest.NewRequest(http.MethodGet, "/api/shuihuo-production/local-executor-artifacts/"+response.ArtifactID, nil)
	SignBridgeRequest(aliceReq, "alice", false, now, "secret")
	aliceRec := httptest.NewRecorder()
	api.ServeHTTP(aliceRec, aliceReq)
	if aliceRec.Code != http.StatusOK || !bytes.Equal(aliceRec.Body.Bytes(), data) {
		t.Fatalf("alice=%d body=%q", aliceRec.Code, aliceRec.Body.Bytes())
	}
}
