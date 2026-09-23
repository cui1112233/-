package httpapi

import (
	"net/http"
	"os/exec"
	"strings"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
	"qiantie/backend/internal/localartifact"
)

type mergeSubmitInput struct {
	RequestID            string  `json:"requestId"`
	TimingMode           string  `json:"timingMode"`
	Speed                float64 `json:"speed"`
	TTSSpeed             float64 `json:"ttsSpeed"`
	AudioDurationSeconds float64 `json:"audioDurationSeconds"`
}

func registerMergeRoutes(mux *http.ServeMux, service *batchfactoryv11.MergeService, files *localartifact.Store) {
	mux.HandleFunc("POST /api/batch-factory/v11/batches/{batchId}/merge", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var input mergeSubmitInput
		if !decodeJSON(w, r, &input) {
			return
		}
		if strings.TrimSpace(input.RequestID) == "" {
			writeStoreError(w, batchfactoryv11.ErrInvalid)
			return
		}
		job, err := service.SubmitBatchMerge(r.Context(), owner, r.PathValue("batchId"), input.RequestID, batchfactoryv11.MergeOptions{TimingMode: input.TimingMode, Speed: input.Speed, TTSSpeed: input.TTSSpeed, AudioDurationSeconds: input.AudioDurationSeconds})
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"job": job})
	})
	mux.HandleFunc("POST /api/batch-factory/v11/batches/{batchId}/books/{bookId}/merge", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var input mergeSubmitInput
		if !decodeJSON(w, r, &input) {
			return
		}
		if strings.TrimSpace(input.RequestID) == "" {
			writeStoreError(w, batchfactoryv11.ErrInvalid)
			return
		}
		job, err := service.SubmitBookMerge(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"), input.RequestID, batchfactoryv11.MergeOptions{TimingMode: input.TimingMode, Speed: input.Speed, TTSSpeed: input.TTSSpeed, AudioDurationSeconds: input.AudioDurationSeconds})
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"job": job})
	})
	// A live merge adapter keeps its task state in the running process.  Route
	// status reads through MergeService so queued jobs are polled and their
	// durable state advances; the historical-only route below deliberately
	// cannot do that and is reserved for lower-capability slices.
	mux.HandleFunc("GET /api/batch-factory/v11/batches/{batchId}/merge-status", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		jobs, err := service.GetBatchStatus(r.Context(), owner, r.PathValue("batchId"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"batchId": r.PathValue("batchId"), "jobs": jobs})
	})
	registerHistoricalMergeMediaRoutes(mux, service.Store, files)
}

// registerHistoricalMergeReadRoutes exposes only already persisted merged
// outputs. It intentionally has no adapter or poller, so lower capability
// slices can show an owner's old finished videos without enabling new merges.
func registerHistoricalMergeReadRoutes(mux *http.ServeMux, store batchfactoryv11.Store, files *localartifact.Store) {
	mux.HandleFunc("GET /api/batch-factory/v11/batches/{batchId}/merge-status", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if store == nil {
			writeStoreError(w, batchfactoryv11.ErrUnavailable)
			return
		}
		if _, err := store.GetBatch(r.Context(), owner, r.PathValue("batchId")); err != nil {
			writeStoreError(w, err)
			return
		}
		repository, ok := store.(batchfactoryv11.MergeRepository)
		if !ok {
			writeStoreError(w, batchfactoryv11.ErrUnavailable)
			return
		}
		jobs, err := repository.ListMergeJobs(r.Context(), owner, r.PathValue("batchId"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"batchId": r.PathValue("batchId"), "jobs": jobs})
	})
	registerHistoricalMergeMediaRoutes(mux, store, files)
}

// registerHistoricalMergeMediaRoutes keeps already-created local artifacts
// readable in both historical-only and live-merge runtimes.  Live runtimes
// provide their own merge-status endpoint above so queued jobs can be polled.
func registerHistoricalMergeMediaRoutes(mux *http.ServeMux, store batchfactoryv11.Store, files *localartifact.Store) {
	mux.HandleFunc("GET /api/batch-factory/v11/batches/{batchId}/merge-cover/{artifactId}", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if files == nil {
			writeStoreError(w, batchfactoryv11.ErrUnavailable)
			return
		}
		repository, ok := store.(batchfactoryv11.MergeRepository)
		if !ok {
			writeStoreError(w, batchfactoryv11.ErrUnavailable)
			return
		}
		batchID, artifactID := r.PathValue("batchId"), r.PathValue("artifactId")
		jobs, err := repository.ListMergeJobs(r.Context(), owner, batchID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		expectedOutput := "/api/batch-factory/v11/batches/" + batchID + "/merge-media/" + artifactID
		if !hasSucceededMergeOutput(jobs, expectedOutput) {
			writeStoreError(w, batchfactoryv11.ErrNotFound)
			return
		}
		file, err := files.Open(artifactID + ".mp4")
		if err != nil {
			writeStoreError(w, batchfactoryv11.ErrNotFound)
			return
		}
		path := file.Name()
		_ = file.Close()
		image, err := exec.CommandContext(r.Context(), "ffmpeg", "-v", "error", "-ss", "0.001", "-i", path, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-").Output()
		if err != nil || len(image) == 0 {
			writeStoreError(w, batchfactoryv11.ErrUnavailable)
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Cache-Control", "private, max-age=3600")
		_, _ = w.Write(image)
	})
	mux.HandleFunc("GET /api/batch-factory/v11/batches/{batchId}/merge-media/{artifactId}", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if files == nil {
			writeStoreError(w, batchfactoryv11.ErrUnavailable)
			return
		}
		repository, ok := store.(batchfactoryv11.MergeRepository)
		if !ok {
			writeStoreError(w, batchfactoryv11.ErrUnavailable)
			return
		}
		batchID, artifactID := r.PathValue("batchId"), r.PathValue("artifactId")
		jobs, err := repository.ListMergeJobs(r.Context(), owner, batchID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		expectedOutput := "/api/batch-factory/v11/batches/" + batchID + "/merge-media/" + artifactID
		if !hasSucceededMergeOutput(jobs, expectedOutput) {
			writeStoreError(w, batchfactoryv11.ErrNotFound)
			return
		}
		file, err := files.Open(artifactID + ".mp4")
		if err != nil {
			if err == localartifact.ErrInvalidID {
				writeStoreError(w, batchfactoryv11.ErrNotFound)
				return
			}
			writeStoreError(w, batchfactoryv11.ErrUnavailable)
			return
		}
		defer file.Close()
		w.Header().Set("Content-Type", "video/mp4")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeContent(w, r, artifactID+".mp4", jobTime(jobs, expectedOutput), file)
	})
}

func hasSucceededMergeOutput(jobs []batchfactoryv11.MergeJob, output string) bool {
	for _, job := range jobs {
		if job.Status == batchfactoryv11.MergeSucceeded && strings.TrimSpace(job.OutputURL) == output {
			return true
		}
	}
	return false
}

func jobTime(jobs []batchfactoryv11.MergeJob, output string) (at time.Time) {
	for _, job := range jobs {
		if strings.TrimSpace(job.OutputURL) == output {
			return job.UpdatedAt
		}
	}
	return at
}
