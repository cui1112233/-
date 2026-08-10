package httpapi

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"

	"qiantie/backend/internal/store"

	"github.com/go-chi/chi/v5"
)

type HistoryStore interface {
	List(ctx context.Context, userID int64, limit int) ([]store.HistoryEntry, error)
	Save(ctx context.Context, userID int64, e store.HistoryEntry) error
	Get(ctx context.Context, userID int64, externalID string) (store.HistoryEntry, error)
	Delete(ctx context.Context, userID int64, externalID string) error
	Clear(ctx context.Context, userID int64) error
}

type historyRequest struct {
	ID         string `json:"id"`
	Mode       string `json:"mode"`
	Format     string `json:"format"`
	FormatName string `json:"formatName"`
	Duration   string `json:"duration"`
	Output     string `json:"output"`
}

func (api *API) handleListHistory(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	entries, err := api.deps.Histories.List(r.Context(), user.ID, 50)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Read history failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

func (api *API) handleSaveHistory(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	var req historyRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if invalidID(req.ID) || req.Output == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id 和 output 为必填项"})
		return
	}
	entry := store.HistoryEntry{
		ExternalID: req.ID,
		Mode:       firstNonEmpty(req.Mode, "continuous"),
		Format:     firstNonEmpty(req.Format, ""),
		FormatName: firstNonEmpty(req.FormatName, ""),
		Duration:   firstNonEmpty(req.Duration, "10s"),
		Preview:    preview(req.Output),
		Output:     req.Output,
		CreatedAt:  time.Now(),
	}
	if err := api.deps.Histories.Save(r.Context(), user.ID, entry); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Save history failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": req.ID})
}

func (api *API) handleGetHistory(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	id := chi.URLParam(r, "id")
	if invalidID(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的 ID"})
		return
	}
	entry, err := api.deps.Histories.Get(r.Context(), user.ID, id)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "记录不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Read history failed"})
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(entry.Output))
}

func (api *API) handleDeleteHistory(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	id := chi.URLParam(r, "id")
	if invalidID(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的 ID"})
		return
	}
	if err := api.deps.Histories.Delete(r.Context(), user.ID, id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Delete history failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (api *API) handleClearHistory(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	if err := api.deps.Histories.Clear(r.Context(), user.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Clear history failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func invalidID(id string) bool {
	return id == "" || strings.Contains(id, "..") || strings.Contains(id, "/") || strings.Contains(id, "\\")
}

func preview(output string) string {
	trimmed := strings.ReplaceAll(output, "\n", " ")
	runes := []rune(trimmed)
	if len(runes) > 40 {
		return string(runes[:40])
	}
	return trimmed
}
