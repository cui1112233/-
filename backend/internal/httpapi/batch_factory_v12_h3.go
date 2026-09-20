package httpapi

import (
	"encoding/json"
	"net/http"

	"qiantie/backend/internal/batchfactoryv11"
)

func registerV12H3Routes(mux *http.ServeMux, service *batchfactoryv11.H3KernelService, director *batchfactoryv11.DirectorService) {
	mux.HandleFunc("POST /api/batch-factory/v12/batches/{batchId}/books/{bookId}/h3/director", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var input struct {
			batchfactoryv11.H3DirectorRunRequest
			TextProvider *textProviderInput `json:"textProvider"`
		}
		if !decodeJSON(w, r, &input) {
			return
		}
		runner, err := directorForRequest(director, input.TextProvider)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		if runner == nil {
			writeStoreError(w, batchfactoryv11.ErrUnavailable)
			return
		}
		revision, err := runner.RunH3Director(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"), input.H3DirectorRunRequest)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"directorRevision": revision})
	})
	mux.HandleFunc("POST /api/batch-factory/v12/batches/{batchId}/books/{bookId}/h3/compile", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var input batchfactoryv11.H3KernelCompileRequest
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid H3 compile request: " + err.Error()})
			return
		}
		result, err := service.Compile(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"), input)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, result)
	})
	mux.HandleFunc("GET /api/batch-factory/v12/batches/{batchId}/books/{bookId}/h3/trace", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		trace, err := service.Trace(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"), r.URL.Query().Get("compilationId"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, trace)
	})
}
