package httpapi

import (
	"net/http"
	"strings"

	"qiantie/backend/internal/batchfactoryv11"
)

type productionSubmitInput struct {
	RequestID string `json:"requestId"`
}

func registerProductionRoutes(mux *http.ServeMux, service *batchfactoryv11.ProductionService) {
	mux.HandleFunc("POST /api/batch-factory/v11/batches/{batchId}/books/{bookId}/production", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		var input productionSubmitInput
		if !decodeJSON(w, r, &input) { return }
		if strings.TrimSpace(input.RequestID) == "" { writeStoreError(w, batchfactoryv11.ErrInvalid); return }
		job, err := service.SubmitBookProduction(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"), input.RequestID)
		if err != nil { writeStoreError(w, err); return }
		writeJSON(w, http.StatusCreated, map[string]any{"job":job})
	})
	mux.HandleFunc("POST /api/batch-factory/v11/batches/{batchId}/production", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		var input productionSubmitInput
		if !decodeJSON(w, r, &input) { return }
		if strings.TrimSpace(input.RequestID) == "" { writeStoreError(w, batchfactoryv11.ErrInvalid); return }
		status, err := service.SubmitBatchProduction(r.Context(), owner, r.PathValue("batchId"), input.RequestID)
		if err != nil { writeStoreError(w, err); return }
		writeJSON(w, http.StatusCreated, status)
	})
	mux.HandleFunc("GET /api/batch-factory/v11/batches/{batchId}/status", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		status, err := service.GetBatchStatus(r.Context(), owner, r.PathValue("batchId"))
		if err != nil { writeStoreError(w, err); return }
		writeJSON(w, http.StatusOK, status)
	})
}
