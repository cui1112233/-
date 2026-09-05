package httpapi

import (
	"errors"
	"net/http"

	"qiantie/backend/internal/batchfactoryv11"
)

func registerDirectorRoutes(mux *http.ServeMux, service *batchfactoryv11.DirectorService, store batchfactoryv11.Store) {
	mux.HandleFunc("POST /api/batch-factory/v11/batches/{batchId}/books/{bookId}/hook", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r); if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		value, err := service.RunHook(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"))
		if err != nil { writeStoreError(w, err); return }
		writeJSON(w, http.StatusCreated, map[string]any{"hook": value})
	})
	mux.HandleFunc("POST /api/batch-factory/v11/batches/{batchId}/books/{bookId}/hooks/{hookId}/approve", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r); if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		value, err := service.ApproveHook(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"), r.PathValue("hookId"))
		if err != nil { writeStoreError(w, err); return }
		writeJSON(w, http.StatusOK, map[string]any{"hook": value})
	})
	mux.HandleFunc("POST /api/batch-factory/v11/batches/{batchId}/books/{bookId}/director", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r); if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		value, err := service.RunDirector(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"))
		if err != nil { writeStoreError(w, err); return }
		writeJSON(w, http.StatusCreated, map[string]any{"directorRevision": value})
	})
	mux.HandleFunc("POST /api/batch-factory/v11/batches/{batchId}/director", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r); if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		batchID := r.PathValue("batchId")
		batch, err := store.GetBatch(r.Context(), owner, batchID)
		if err != nil { writeStoreError(w, err); return }
		type failure struct { BookID string `json:"bookId"`; Error string `json:"error"` }
		revisions := []batchfactoryv11.DirectorRevision{}
		failures := []failure{}
		for _, book := range batch.Books {
			revision, runErr := service.RunDirector(r.Context(), owner, batchID, book.ID)
			if runErr != nil { failures = append(failures, failure{BookID:book.ID, Error:safeDirectorError(runErr)}); continue }
			revisions = append(revisions, revision)
		}
		status := http.StatusCreated
		if len(revisions) == 0 && len(failures) > 0 { status = http.StatusConflict }
		writeJSON(w, status, map[string]any{"directorRevisions":revisions,"failures":failures})
	})
}

func safeDirectorError(err error) string {
	switch {
	case errors.Is(err, batchfactoryv11.ErrNotFound): return "not found"
	case errors.Is(err, batchfactoryv11.ErrConflict): return "director prerequisites not satisfied"
	case errors.Is(err, batchfactoryv11.ErrInvalid): return err.Error()
	case errors.Is(err, batchfactoryv11.ErrUnavailable): return "director unavailable"
	default: return "director failed"
	}
}
