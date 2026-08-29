package httpapi

import (
	"context"
	"net/http"

	"qiantie/backend/internal/pet"
	"qiantie/backend/internal/store"
)

type ConfigStore interface {
	Get(ctx context.Context, userID int64) (store.APIConfig, error)
	Save(ctx context.Context, userID int64, cfg store.APIConfig) error
}

type PreferenceStore interface {
	GetPet(ctx context.Context, userID int64) (string, error)
	SavePet(ctx context.Context, userID int64, petID string) error
}

type configRequest struct {
	Provider string `json:"provider"`
	BaseURL  string `json:"baseUrl"`
	Model    string `json:"model"`
	APIKey   string `json:"apiKey"`
	Pet      string `json:"pet"`
}

func (api *API) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	cfg, err := api.deps.Configs.Get(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Read config failed"})
		return
	}
	petID, err := api.readPetPreference(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Read pet preference failed"})
		return
	}
	writePublicConfig(w, cfg, petID)
}

func (api *API) handleSaveConfig(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	oldConfig, err := api.deps.Configs.Get(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Read config failed"})
		return
	}
	oldPetID, err := api.readPetPreference(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Read pet preference failed"})
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
	nextPetID := pet.NormalizeID(req.Pet, oldPetID)
	if err := api.deps.Configs.Save(r.Context(), user.ID, next); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Save config failed"})
		return
	}
	if api.deps.Preferences != nil {
		if err := api.deps.Preferences.SavePet(r.Context(), user.ID, nextPetID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Save pet preference failed"})
			return
		}
	}
	writePublicConfig(w, next, nextPetID)
}

func (api *API) handleTestConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Config endpoint is reachable"})
}

func (api *API) readPetPreference(ctx context.Context, userID int64) (string, error) {
	if api.deps.Preferences == nil {
		return pet.DefaultID, nil
	}
	petID, err := api.deps.Preferences.GetPet(ctx, userID)
	if err != nil {
		return "", err
	}
	return pet.NormalizeID(petID, pet.DefaultID), nil
}

func writePublicConfig(w http.ResponseWriter, cfg store.APIConfig, petID string) {
	writeJSON(w, http.StatusOK, map[string]any{
		"provider":  cfg.Provider,
		"baseUrl":   cfg.BaseURL,
		"model":     cfg.Model,
		"hasApiKey": cfg.APIKeyCiphertext != "",
		"pet":       pet.NormalizeID(petID, pet.DefaultID),
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
