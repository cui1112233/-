package httpapi

import (
	"net/http"
	"strings"

	"qiantie/backend/internal/batchfactoryv11"
)

type mergeSubmitInput struct {
	RequestID            string  `json:"requestId"`
	TimingMode           string  `json:"timingMode"`
	Speed                float64 `json:"speed"`
	TTSSpeed             float64 `json:"ttsSpeed"`
	AudioDurationSeconds float64 `json:"audioDurationSeconds"`
}

func mergeOptionsFromInput(input mergeSubmitInput) batchfactoryv11.MergeOptions {
	return batchfactoryv11.MergeOptions{
		TimingMode:           input.TimingMode,
		Speed:                input.Speed,
		TTSSpeed:             input.TTSSpeed,
		AudioDurationSeconds: input.AudioDurationSeconds,
	}
}

func registerMergeRoutes(mux *http.ServeMux, service *batchfactoryv11.MergeService) {
	// Legacy batch-level merge routes remain registered for existing V11
	// clients. New Batch Factory UI uses the per-book hierarchy below so one
	// novel produces one final video instead of merging the entire batch.
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
		job, err := service.SubmitBatchMerge(r.Context(), owner, r.PathValue("batchId"), input.RequestID, mergeOptionsFromInput(input))
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
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"batchId": r.PathValue("batchId"), "jobs": jobs})
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
		status, err := service.SubmitBookMerge(
			r.Context(),
			owner,
			r.PathValue("batchId"),
			r.PathValue("bookId"),
			input.RequestID,
			mergeOptionsFromInput(input),
		)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"merge": status})
	})

	mux.HandleFunc("GET /api/batch-factory/v11/batches/{batchId}/books/{bookId}/merge-status", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		requestID := strings.TrimSpace(r.URL.Query().Get("requestId"))
		if requestID == "" {
			writeStoreError(w, batchfactoryv11.ErrInvalid)
			return
		}
		status, err := service.GetBookMergeStatus(
			r.Context(),
			owner,
			r.PathValue("batchId"),
			r.PathValue("bookId"),
			requestID,
		)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"merge": status})
	})
}
