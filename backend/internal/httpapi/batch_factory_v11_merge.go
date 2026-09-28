package httpapi

import (
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
	"qiantie/backend/internal/localartifact"
	"qiantie/backend/internal/mergeworker"
)

type mergeSubmitInput struct {
	RequestID            string  `json:"requestId"`
	TimingMode           string  `json:"timingMode"`
	Speed                float64 `json:"speed"`
	TTSSpeed             float64 `json:"ttsSpeed"`
	AudioDurationSeconds float64 `json:"audioDurationSeconds"`
}

func registerMergeRoutes(mux *http.ServeMux, service *batchfactoryv11.MergeService, files *localartifact.Store, output mergeworker.ObjectStore, remote mergeworker.ObjectReader) {
	mux.HandleFunc("POST /api/batch-factory/v11/batches/{batchId}/merge-artifacts/migrate-to-tos", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if files == nil || output == nil {
			writeStoreError(w, batchfactoryv11.ErrUnavailable)
			return
		}
		repository, ok := service.Store.(batchfactoryv11.MergeRepository)
		if !ok {
			writeStoreError(w, batchfactoryv11.ErrUnavailable)
			return
		}
		batchID := r.PathValue("batchId")
		jobs, err := repository.ListMergeJobs(r.Context(), owner, batchID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		migrated, retained := 0, 0
		for _, job := range jobs {
			prefix := "/api/batch-factory/v11/batches/" + batchID + "/merge-media/"
			if job.Status != batchfactoryv11.MergeSucceeded || !strings.HasPrefix(strings.TrimSpace(job.OutputURL), prefix) {
				continue
			}
			artifactID := strings.TrimPrefix(strings.TrimSpace(job.OutputURL), prefix)
			path, pathErr := files.Path(artifactID + ".mp4")
			if pathErr != nil {
				continue // already remote or a separately retained legacy artifact
			}
			if _, uploadErr := output.PutMerged(r.Context(), job.ID, path); uploadErr != nil {
				retained++
				continue
			}
			updated := job
			updated.OutputURL = prefix + job.ID
			updated.ProgressPhase = "stored"
			updated.ErrorMessage = ""
			if _, updateErr := repository.UpdateMergeJob(r.Context(), owner, job.ID, updated); updateErr != nil {
				retained++
				continue
			}
			if removeErr := files.Remove(artifactID + ".mp4"); removeErr != nil {
				retained++
				continue
			}
			migrated++
		}
		writeJSON(w, http.StatusOK, map[string]any{"migrated": migrated, "retained": retained})
	})
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
	mux.HandleFunc("GET /api/batch-factory/v11/batches/{batchId}/merge-status", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		jobs, err := service.GetBatchStatus(r.Context(), owner, r.PathValue("batchId"))
		if err != nil {
			log.Printf("batch factory merge status failed: batch=%q owner=%q error=%v", r.PathValue("batchId"), owner, err)
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"batchId": r.PathValue("batchId"), "jobs": jobs})
	})
	mux.HandleFunc("GET /api/batch-factory/v11/batches/{batchId}/merge-media/{artifactId}", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		repository, ok := service.Store.(batchfactoryv11.MergeRepository)
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
		found := false
		for _, job := range jobs {
			if job.Status == batchfactoryv11.MergeSucceeded && strings.TrimSpace(job.OutputURL) == expectedOutput {
				found = true
				break
			}
		}
		if !found {
			writeStoreError(w, batchfactoryv11.ErrNotFound)
			return
		}
		var file interface {
			Read([]byte) (int, error)
			Close() error
		}
		if files != nil {
			localFile, localErr := files.Open(artifactID + ".mp4")
			if localErr == nil {
				file = localFile
			} else if !errors.Is(localErr, localartifact.ErrInvalidID) && !errors.Is(localErr, os.ErrNotExist) {
				writeStoreError(w, batchfactoryv11.ErrUnavailable)
				return
			}
		}
		if file == nil && remote != nil {
			file, err = remote.Open(r.Context(), artifactID)
		}
		if file == nil || err != nil {
			writeStoreError(w, batchfactoryv11.ErrNotFound)
			return
		}
		defer file.Close()
		w.Header().Set("Content-Type", "video/mp4")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = io.Copy(w, file)
	})
}

func jobTime(jobs []batchfactoryv11.MergeJob, output string) (at time.Time) {
	for _, job := range jobs {
		if strings.TrimSpace(job.OutputURL) == output {
			return job.UpdatedAt
		}
	}
	return at
}
