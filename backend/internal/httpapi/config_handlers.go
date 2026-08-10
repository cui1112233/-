package httpapi

import (
	"context"
	"net/http"

	"qiantie/backend/internal/store"
)

type ConfigStore interface {
	Get(ctx context.Context, userID int64) (store.APIConfig, error)
	Save(ctx context.Context, userID int64, cfg store.APIConfig) error
}

type configRequest struct {
	Provider string `json:"provider"`
	BaseURL  string `json:"baseUrl"`
	Model    string `json:"model"`
	APIKey   string `json:"apiKey"`
}

func (api *API) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	cfg, err := api.deps.Configs.Get(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Read config failed"})
		return
	}
	writePublicConfig(w, cfg)
}

func (api *API) handleSaveConfig(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	oldConfig, err := api.deps.Configs.Get(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Read config failed"})
		return
	}
	var req configRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	next := store.APIConfig{
		Provider:         firstNonEmpty(req.Provider, oldConfig.Provider, "openai"),
		BaseURL:          firstNonEmpty(req.BaseURL, oldConfig.BaseURL, "https://api.openai.com/v1"),
		Model:            firstNonEmpty(req.Model, oldConfig.Model, "gpt-4o-mini"),
		APIKeyCiphertext: firstNonEmpty(req.APIKey, oldConfig.APIKeyCiphertext, ""),
	}
	if err := api.deps.Configs.Save(r.Context(), user.ID, next); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Save config failed"})
		return
	}
	writePublicConfig(w, next)
}

func (api *API) handleTestConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Config endpoint is reachable"})
}

func writePublicConfig(w http.ResponseWriter, cfg store.APIConfig) {
	writeJSON(w, http.StatusOK, map[string]any{
		"provider":  cfg.Provider,
		"baseUrl":   cfg.BaseURL,
		"model":     cfg.Model,
		"hasApiKey": cfg.APIKeyCiphertext != "",
	})
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
