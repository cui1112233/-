package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"qiantie/backend/internal/batchfactoryv11"
)

type shotVisualImageInput struct { ImageURL string `json:"imageUrl"` }

type productionSubmitInput struct {
	RequestID string `json:"requestId"`
	Provider  string `json:"provider,omitempty"`
}

type videoProviderConfigInput struct {
	Provider string `json:"provider"`
	APIKey string `json:"apiKey,omitempty"`
	Model string `json:"model,omitempty"`
	CreateURL string `json:"createUrl,omitempty"`
	TasksURL string `json:"tasksUrl,omitempty"`
	ResultURL string `json:"resultUrl,omitempty"`
}

func registerProductionRoutes(mux *http.ServeMux, service *batchfactoryv11.ProductionService) {
	mux.HandleFunc("PUT /api/batch-factory/v11/video-provider/config", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		if service == nil || service.ProviderRegistry == nil { writeStoreError(w, batchfactoryv11.ErrUnavailable); return }
		var input videoProviderConfigInput
		if !decodeJSON(w, r, &input) { return }
		err := service.ProviderRegistry.Put(r.Context(), owner, batchfactoryv11.VideoProviderConfig{
			Provider: input.Provider, APIKey: input.APIKey, Model: input.Model,
			CreateURL: input.CreateURL, TasksURL: input.TasksURL, ResultURL: input.ResultURL,
		})
		if err != nil { writeStoreError(w, err); return }
		provider := batchfactoryv11.NormalizeVideoProviderForHTTP(input.Provider)
		model := input.Model
		if provider == batchfactoryv11.VideoProviderPersonalAPI && strings.TrimSpace(model) == "" { model = batchfactoryv11.DefaultPersonalVideoModel }
		writeJSON(w, http.StatusOK, map[string]any{"provider": provider, "model": model, "configured": true})
	})
	mux.HandleFunc("GET /api/batch-factory/v11/video-provider/status", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		provider := batchfactoryv11.NormalizeVideoProviderForHTTP(r.URL.Query().Get("provider"))
		if service == nil || service.ProviderRegistry == nil { writeStoreError(w, batchfactoryv11.ErrUnavailable); return }
		view, err := service.ProviderRegistry.View(r.Context(), owner, provider)
		if err != nil && !errors.Is(err, batchfactoryv11.ErrUnavailable) { writeStoreError(w, err); return }
		if errors.Is(err, batchfactoryv11.ErrUnavailable) {
			view = batchfactoryv11.VideoProviderConfigView{Provider: provider, Configured: false}
		}
		writeJSON(w, http.StatusOK, view)
	})

	mux.HandleFunc("PUT /api/batch-factory/v11/batches/{batchId}/books/{bookId}/videos/{videoId}/shots/{shotId}/visual-image", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		if service == nil || service.Store == nil { writeStoreError(w, batchfactoryv11.ErrUnavailable); return }
		var input shotVisualImageInput
		if !decodeJSON(w, r, &input) { return }
		if strings.TrimSpace(input.ImageURL) == "" { writeStoreError(w, batchfactoryv11.ErrInvalid); return }
		err := service.Store.UpdateShotVisualImage(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"), r.PathValue("videoId"), r.PathValue("shotId"), strings.TrimSpace(input.ImageURL))
		if err != nil { writeStoreError(w, err); return }
		writeJSON(w, http.StatusOK, map[string]any{"shotId": r.PathValue("shotId"), "imageUrl": strings.TrimSpace(input.ImageURL), "persisted": true})
	})
	mux.HandleFunc("POST /api/batch-factory/v11/batches/{batchId}/books/{bookId}/production", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		var input productionSubmitInput
		if !decodeJSON(w, r, &input) { return }
		if strings.TrimSpace(input.RequestID) == "" { writeStoreError(w, batchfactoryv11.ErrInvalid); return }
		job, err := service.SubmitBookProductionWithProvider(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"), input.RequestID, input.Provider)
		if err != nil { writeStoreError(w, err); return }
		writeJSON(w, http.StatusCreated, map[string]any{"job":job})
	})
	mux.HandleFunc("POST /api/batch-factory/v11/batches/{batchId}/production", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		var input productionSubmitInput
		if !decodeJSON(w, r, &input) { return }
		if strings.TrimSpace(input.RequestID) == "" { writeStoreError(w, batchfactoryv11.ErrInvalid); return }
		status, err := service.SubmitBatchProductionWithProvider(r.Context(), owner, r.PathValue("batchId"), input.RequestID, input.Provider)
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
