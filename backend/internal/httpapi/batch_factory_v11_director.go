package httpapi

import (
	"errors"
	"net/http"
	"sync"

	"qiantie/backend/internal/batchfactoryv11"
)

const batchDirectorConcurrency = 4

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
		type result struct {
			index int
			revision batchfactoryv11.DirectorRevision
			failure *failure
		}

		results := make(chan result, len(batch.Books))
		sem := make(chan struct{}, batchDirectorConcurrency)
		var wg sync.WaitGroup
		for index, book := range batch.Books {
			index, book := index, book
			wg.Add(1)
			go func() {
				defer wg.Done()
				select {
				case sem <- struct{}{}:
					defer func() { <-sem }()
				case <-r.Context().Done():
					results <- result{index:index, failure:&failure{BookID:book.ID, Error:safeDirectorError(r.Context().Err())}}
					return
				}
				revision, runErr := service.RunDirector(r.Context(), owner, batchID, book.ID)
				if runErr != nil {
					results <- result{index:index, failure:&failure{BookID:book.ID, Error:safeDirectorError(runErr)}}
					return
				}
				results <- result{index:index, revision:revision}
			}()
		}
		wg.Wait()
		close(results)

		ordered := make([]result, len(batch.Books))
		for item := range results { ordered[item.index] = item }
		revisions := []batchfactoryv11.DirectorRevision{}
		failures := []failure{}
		for _, item := range ordered {
			if item.failure != nil { failures = append(failures, *item.failure); continue }
			revisions = append(revisions, item.revision)
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
	case errors.Is(err, batchfactoryv11.ErrInvalid): return "invalid director input or output"
	case errors.Is(err, batchfactoryv11.ErrUnavailable): return "director unavailable"
	default: return "director failed"
	}
}
