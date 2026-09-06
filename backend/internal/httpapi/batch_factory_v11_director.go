package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"qiantie/backend/internal/batchfactoryv11"
)

type directorBatchInput struct {
	BookIDs []string `json:"bookIds,omitempty"`
}

func registerDirectorRoutes(mux *http.ServeMux, service *batchfactoryv11.DirectorService, store batchfactoryv11.Store) {
	mux.HandleFunc("POST /api/batch-factory/v11/batches/{batchId}/books/{bookId}/hook", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		value, err := service.RunHook(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"hook": value})
	})
	mux.HandleFunc("POST /api/batch-factory/v11/batches/{batchId}/books/{bookId}/hooks/{hookId}/approve", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		value, err := service.ApproveHook(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"), r.PathValue("hookId"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"hook": value})
	})
	mux.HandleFunc("POST /api/batch-factory/v11/batches/{batchId}/books/{bookId}/director", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		value, err := service.RunDirector(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"directorRevision": value})
	})
	mux.HandleFunc("POST /api/batch-factory/v11/batches/{batchId}/director", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var input directorBatchInput
		if r.Body != nil {
			decoder := json.NewDecoder(r.Body)
			if err := decoder.Decode(&input); err != nil && !errors.Is(err, io.EOF) {
				writeStoreError(w, batchfactoryv11.ErrInvalid)
				return
			}
		}
		batchID := r.PathValue("batchId")
		batch, err := store.GetBatch(r.Context(), owner, batchID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		selected := make(map[string]bool, len(input.BookIDs))
		for _, bookID := range input.BookIDs {
			if strings.TrimSpace(bookID) == "" || selected[bookID] {
				continue
			}
			selected[bookID] = true
		}
		if len(selected) > 0 {
			for bookID := range selected {
				if _, lookupErr := bookByID(batch, bookID); lookupErr != nil {
					writeStoreError(w, batchfactoryv11.ErrNotFound)
					return
				}
			}
		}
		type failure struct {
			BookID string `json:"bookId"`
			Error  string `json:"error"`
		}
		revisions := []batchfactoryv11.DirectorRevision{}
		failures := []failure{}
		for _, book := range batch.Books {
			if len(selected) > 0 && !selected[book.ID] {
				continue
			}
			revision, runErr := service.RunDirector(r.Context(), owner, batchID, book.ID)
			if runErr != nil {
				failures = append(failures, failure{BookID: book.ID, Error: safeDirectorError(runErr)})
				continue
			}
			revisions = append(revisions, revision)
		}
		status := http.StatusCreated
		if len(revisions) == 0 && len(failures) > 0 {
			status = http.StatusConflict
		}
		writeJSON(w, status, map[string]any{"directorRevisions": revisions, "failures": failures})
	})
}

func bookByID(batch batchfactoryv11.Batch, bookID string) (batchfactoryv11.Book, error) {
	for _, book := range batch.Books {
		if book.ID == bookID {
			return book, nil
		}
	}
	return batchfactoryv11.Book{}, batchfactoryv11.ErrNotFound
}

func safeDirectorError(err error) string {
	switch {
	case errors.Is(err, batchfactoryv11.ErrNotFound):
		return "not found"
	case errors.Is(err, batchfactoryv11.ErrConflict):
		return "director prerequisites not satisfied"
	case errors.Is(err, batchfactoryv11.ErrInvalid):
		return err.Error()
	case errors.Is(err, batchfactoryv11.ErrUnavailable):
		return "director unavailable"
	default:
		return "director failed"
	}
}
