package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func (api *API) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(api.cors)

	r.Get("/health", api.handleHealth)
	r.Route("/api", func(r chi.Router) {
		r.Post("/login", api.handleLogin)
		r.Group(func(r chi.Router) {
			r.Use(api.requireAuth)
			r.Get("/me", api.handleMe)
			r.Get("/config", api.handleGetConfig)
			r.Post("/config", api.handleSaveConfig)
			r.Get("/history", api.handleHistoryList)
			r.Post("/history", api.handleHistoryCreate)
			r.Get("/history/{id}", api.handleHistoryGet)
			r.Put("/history/{id}", api.handleHistoryUpdate)
			r.Delete("/history/{id}", api.handleHistoryDelete)
			r.Get("/shuihuo-production/models", api.handleListShuihuoModels)
			r.Get("/shuihuo-production/projects", api.handleListShuihuoProjects)
			r.Post("/shuihuo-production/projects", api.handleCreateShuihuoProject)
			r.Get("/shuihuo-production/projects/{id}", api.handleGetShuihuoProject)
			r.Put("/shuihuo-production/projects/{id}", api.handleUpdateShuihuoProject)
			r.Delete("/shuihuo-production/projects/{id}", api.handleDeleteShuihuoProject)
			r.Get("/shuihuo-production/projects/{id}/segments", api.handleListShuihuoSegments)
			r.Get("/shuihuo-production/projects/{id}/media", api.handleListShuihuoMedia)
			r.Get("/shuihuo-production/projects/{id}/assets", api.handleListShuihuoAssets)
			r.Get("/shuihuo-production/projects/{id}/analysis", api.handleGetShuihuoAnalysis)
			r.Get("/shuihuo-production/projects/{id}/export", api.handleExportShuihuoProject)
			r.Get("/shuihuo-production/projects/{id}/export/download", api.handleDownloadShuihuoExport)
			r.Post("/shuihuo-production/projects/{id}/assets/generate", api.handleGenerateShuihuoAssets)
			r.Post("/shuihuo-production/batch-factory/settings/canonicalize", api.handleCanonicalizeBatchFactorySettings)
			r.Post("/shuihuo-production/batch-factory/overrides/canonicalize", api.handleCanonicalizeBatchFactoryOverride)
			r.Get("/shuihuo-production/batch-factory/batches/{batchId}/settings-state", api.handleGetBatchFactorySettingsState)
			r.Put("/shuihuo-production/batch-factory/batches/{batchId}/settings-state/bootstrap", api.handleBootstrapBatchFactorySettingsState)
			r.Put("/shuihuo-production/batch-factory/batches/{batchId}/settings", api.handleSaveBatchFactorySettings)
			r.Put("/shuihuo-production/batch-factory/batches/{batchId}/items/{itemId}/overrides", api.handleSaveBatchFactoryItemOverride)
			r.Put("/shuihuo-production/batch-factory/batches/{batchId}/items/{itemId}/videos/{videoId}/overrides", api.handleSaveBatchFactoryVideoOverride)
			r.Post("/shuihuo-production/batch-factory/import-videos", api.handleImportBatchFactoryVideos)
			r.Post("/shuihuo-production/batch-factory/status", api.handleBatchFactoryProductionStatus)
			r.Get("/shuihuo-production/batch-factory/merge-capability", api.handleBatchFactoryMergeCapability)
			r.Post("/shuihuo-production/batch-factory/merge-videos", api.handleBatchFactoryMergeVideos)
			r.Get("/shuihuo-production/projects/{id}/tasks", api.handleListShuihuoTasks)
			r.Post("/shuihuo-production/projects/{id}/tasks", api.handleCreateShuihuoTask)
			r.Post("/shuihuo-production/projects/{id}/tasks/batch", api.handleCreateShuihuoBatchTasks)
			r.Post("/shuihuo-production/projects/{id}/segmentation/fixed", api.handleFixedSegmentation)
			r.Post("/shuihuo-production/projects/{id}/segmentation/import", api.handleImportSegmentation)
			r.Post("/shuihuo-production/projects/{id}/segmentation/smart", api.handleSmartSegmentation)
			r.Post("/shuihuo-production/projects/{id}/analysis/assets", api.handleShuihuoAssetAnalysis)
			r.Post("/shuihuo-production/projects/{id}/segmentation/confirm", api.handleConfirmSegmentation)
			r.Post("/shuihuo-production/projects/{id}/segments", api.handleCreateShuihuoSegment)
			r.Put("/shuihuo-production/projects/{id}/segments/order", api.handleReorderShuihuoSegments)
			r.Put("/shuihuo-production/segments/{segmentId}", api.handleUpdateShuihuoSegment)
			r.Delete("/shuihuo-production/segments/{segmentId}", api.handleDeleteShuihuoSegment)
			r.Get("/shuihuo-production/segments/{segmentId}/assets", api.handleListShuihuoSegmentAssets)
			r.Put("/shuihuo-production/segments/{segmentId}/assets", api.handleReplaceShuihuoSegmentAssets)
			r.Put("/shuihuo-production/assets/{assetId}", api.handleUpdateShuihuoAsset)
			r.Delete("/shuihuo-production/assets/{assetId}", api.handleDeleteShuihuoAsset)
			r.Post("/shuihuo-production/projects/{id}/media", api.handleUploadShuihuoMedia)
			r.Put("/shuihuo-production/media/{mediaId}/segment", api.handleAttachShuihuoMedia)
			r.Put("/shuihuo-production/media/{mediaId}/primary", api.handleSetShuihuoPrimaryMedia)
			r.Delete("/shuihuo-production/media/{mediaId}", api.handleDeleteShuihuoMedia)
			r.Get("/shuihuo-production/media/{mediaId}/download", api.handleDownloadShuihuoMedia)
			r.Put("/shuihuo-production/tasks/{taskId}/cancel", api.handleCancelShuihuoTask)
			r.Post("/shuihuo-production/tasks/{taskId}/retry", api.handleRetryShuihuoTask)
			r.With(api.requireOwner).Get("/shuihuo-production/admin/models", api.handleAdminModelList)
			r.With(api.requireOwner).Post("/shuihuo-production/admin/models", api.handleCreateAdminModel)
			r.With(api.requireOwner).Put("/shuihuo-production/admin/models/{modelId}", api.handleUpdateAdminModel)
		})
	})
	return r
}

func (api *API) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Qiantie-Bridge-Secret, X-Qiantie-Username, X-Qiantie-Owner")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (api *API) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func readJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(target)
}
