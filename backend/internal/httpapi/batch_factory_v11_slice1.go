package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"qiantie/backend/internal/batchfactoryv11"
)

func registerSliceOneRoutes(mux *http.ServeMux, store batchfactoryv11.Store) {
	mux.HandleFunc("POST /api/batch-factory/v11/intakes/novel-fetch", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var input batchfactoryv11.NovelFetchIntakeInput
		if !decodeJSON(w, r, &input) {
			return
		}
		intake, err := store.CreateIntake(r.Context(), owner, input)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"intake": intake})
	})
	mux.HandleFunc("GET /api/batch-factory/v11/intakes/{intakeId}", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		intake, err := store.GetIntake(r.Context(), owner, r.PathValue("intakeId"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"intake": intake})
	})
	mux.HandleFunc("POST /api/batch-factory/v11/intakes/{intakeId}/batches", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var input batchfactoryv11.CreateBatchInput
		if !decodeJSON(w, r, &input) {
			return
		}
		batch, err := store.CreateBatchFromIntake(r.Context(), owner, r.PathValue("intakeId"), input)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"batch": batch})
	})
	mux.HandleFunc("GET /api/batch-factory/v11/batches", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		batches, err := store.ListBatches(r.Context(), owner)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"batches": batches})
	})
	mux.HandleFunc("POST /api/batch-factory/v11/batches", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var input batchfactoryv11.CreateBatchInput
		if !decodeJSON(w, r, &input) {
			return
		}
		batch, err := store.CreateBatch(r.Context(), owner, input)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"batch": batch})
	})
	mux.HandleFunc("GET /api/batch-factory/v11/batches/{batchId}", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		batch, err := store.GetBatch(r.Context(), owner, r.PathValue("batchId"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"batch": batch})
	})
	mux.HandleFunc("PUT /api/batch-factory/v11/batches/{batchId}/books/{bookId}/source", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var input batchfactoryv11.SourceUpdate
		if !decodeJSON(w, r, &input) {
			return
		}
		book, err := store.UpdateBookSource(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"), input)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"book": book})
	})
	mux.HandleFunc("PUT /api/batch-factory/v11/batches/{batchId}/settings", settingsHandler(store, batchfactoryv11.ScopeBatch))
	mux.HandleFunc("PUT /api/batch-factory/v11/batches/{batchId}/books/{bookId}/override", settingsHandler(store, batchfactoryv11.ScopeBook))
	mux.HandleFunc("PUT /api/batch-factory/v11/batches/{batchId}/books/{bookId}/videos/{videoId}/override", settingsHandler(store, batchfactoryv11.ScopeVideo))
	mux.HandleFunc("POST /api/batch-factory/v11/batches/{batchId}/change-impact", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var input batchfactoryv11.SettingsUpdate
		if !decodeJSON(w, r, &input) {
			return
		}
		impact, err := store.ChangeImpact(r.Context(), owner, r.PathValue("batchId"), input)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, impact)
	})
	mux.HandleFunc("GET /api/batch-factory/v11/config-versions", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		versions, err := store.ConfigVersions(r.Context(), owner)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"configVersions": versions})
	})
	mux.HandleFunc("GET /api/batch-factory/v11/prompts", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		prompts, err := store.ListPrompts(r.Context(), owner, r.URL.Query().Get("kind"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"prompts": prompts})
	})
	mux.HandleFunc("POST /api/batch-factory/v11/prompts", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var input batchfactoryv11.Prompt
		if !decodeJSON(w, r, &input) {
			return
		}
		if strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.Content) == "" {
			writeStoreError(w, batchfactoryv11.ErrInvalid)
			return
		}
		prompt, err := store.CreatePrompt(r.Context(), owner, input)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"prompt": prompt})
	})
	mux.HandleFunc("GET /api/batch-factory/v11/drafts", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		q := r.URL.Query()
		draft, err := store.GetDraft(r.Context(), owner, q.Get("key"), q.Get("kind"), q.Get("scope"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"draft": draft})
	})
	mux.HandleFunc("PUT /api/batch-factory/v11/drafts", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var input batchfactoryv11.Draft
		if !decodeJSON(w, r, &input) {
			return
		}
		if strings.TrimSpace(input.Key) == "" {
			writeStoreError(w, batchfactoryv11.ErrInvalid)
			return
		}
		draft, err := store.SaveDraft(r.Context(), owner, input)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"draft": draft})
	})
}

func settingsHandler(store batchfactoryv11.Store, kind batchfactoryv11.ScopeKind) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var input batchfactoryv11.SettingsUpdate
		if !decodeJSON(w, r, &input) {
			return
		}
		ref := batchfactoryv11.ScopeRef{Kind: kind, BatchID: r.PathValue("batchId"), BookID: r.PathValue("bookId"), VideoID: r.PathValue("videoId")}
		result, err := store.SaveSettings(r.Context(), owner, ref, input)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

func bridgeOwner(r *http.Request) (string, bool) {
	identity, ok := BridgeIdentityFromContext(r.Context())
	return identity.Username, ok && identity.Username != ""
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	if r.Body == nil {
		return true
	}
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return false
	}
	return true
}

func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, batchfactoryv11.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	case errors.Is(err, batchfactoryv11.ErrConflict):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "revision conflict"})
	case errors.Is(err, batchfactoryv11.ErrInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid input"})
	case errors.Is(err, batchfactoryv11.ErrUnavailable):
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "capability unavailable"})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
	}
}
