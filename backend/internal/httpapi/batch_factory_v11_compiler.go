package httpapi

import (
	"net/http"

	"qiantie/backend/internal/batchfactoryv11"
)

func registerCompilerRoutes(mux *http.ServeMux, service *batchfactoryv11.PromptCompilerService) {
	mux.HandleFunc("GET /api/batch-factory/v11/batches/{batchId}/books/{bookId}/videos/{videoId}/effective-settings", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		value, _, _, _, err := service.ResolveEffective(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"), r.PathValue("videoId"))
		if err != nil { writeStoreError(w, err); return }
		writeJSON(w, http.StatusOK, map[string]any{"effectiveSettings": value})
	})
	mux.HandleFunc("GET /api/batch-factory/v11/batches/{batchId}/books/{bookId}/videos/{videoId}/final-prompt", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		var value batchfactoryv11.FinalPrompt
		var err error
		if shotID := r.URL.Query().Get("shotId"); shotID != "" {
			value, err = service.CompileShot(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"), r.PathValue("videoId"), shotID)
		} else {
			value, err = service.Compile(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"), r.PathValue("videoId"))
		}
		if err != nil { writeStoreError(w, err); return }
		writeJSON(w, http.StatusOK, map[string]any{"finalPrompt": value})
	})
}
