package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"qiantie/backend/internal/shuihuo/models"
	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
	shuihuotasks "qiantie/backend/internal/shuihuo/tasks"
	"qiantie/backend/internal/store"

	"github.com/go-chi/chi/v5"
)

type Dependencies struct {
	WebFS             fs.FS
	DB                *sql.DB
	TokenSecret       string
	BridgeSecret      string
	SeedUsername      string
	SeedPassword      string
	Users             UserStore
	Configs           ConfigStore
	Histories         HistoryStore
	Objects           shuihuostorage.ObjectStorage
	Queue             shuihuotasks.Queue
	Health            ShuihuoHealth
	TextCompletion    TextCompletionProvider
	TextModelEndpoint func(reference string) string
}

type TextCompletionProvider interface {
	Complete(ctx context.Context, model models.Definition, renderedPrompt string) (string, error)
}

type UserStore interface {
	FindByUsername(ctx context.Context, username string) (store.User, error)
	FindByID(ctx context.Context, id int64) (store.User, error)
	EnsureBridgeUser(ctx context.Context, username string, isOwner bool) (store.User, error)
}

type API struct {
	deps Dependencies
}

func New(deps Dependencies) *API {
	return &API{deps: deps}
}

func (api *API) Router() http.Handler {
	r := chi.NewRouter()
	if api.deps.WebFS != nil {
		r.Handle("/*", embeddedWebHandler(api.deps.WebFS))
	}
	r.Get("/healthz", api.handleHealth)
	r.Route("/api", func(r chi.Router) {
		r.Post("/login", api.handleLogin)
		r.Post("/logout", api.handleLogout)
		r.With(api.requireAuth).Get("/me", api.handleMe)
		r.With(api.requireAuth).Get("/config", api.handleGetConfig)
		r.With(api.requireAuth).Post("/config", api.handleSaveConfig)
		r.With(api.requireAuth).Post("/config/test", api.handleTestConfig)
		r.With(api.requireAuth).Get("/history", api.handleListHistory)
		r.With(api.requireAuth).Post("/history", api.handleSaveHistory)
		r.With(api.requireAuth).Get("/history/{id}", api.handleGetHistory)
		r.With(api.requireAuth).Delete("/history/{id}", api.handleDeleteHistory)
		r.With(api.requireAuth).Delete("/history", api.handleClearHistory)
		r.Group(func(r chi.Router) {
			r.Use(api.requirePlatformAuth)
			r.Get("/shuihuo-production/health", api.handleShuihuoHealth)
			r.Get("/shuihuo-production/config", api.handleGetShuihuoProductionConfig)
			r.Put("/shuihuo-production/config", api.handleSaveShuihuoProductionConfig)
			r.Get("/shuihuo-production/asset-types", api.handleListShuihuoAssetTypes)
			r.Post("/shuihuo-production/asset-types", api.handleCreateShuihuoAssetType)
			r.Put("/shuihuo-production/asset-types/{assetTypeId}", api.handleUpdateShuihuoAssetType)
			r.Delete("/shuihuo-production/asset-types/{assetTypeId}", api.handleDeleteShuihuoAssetType)
			r.Get("/shuihuo-production/asset-templates", api.handleListShuihuoAssetTemplates)
			r.Post("/shuihuo-production/asset-templates", api.handleCreateShuihuoAssetTemplate)
			r.Put("/shuihuo-production/asset-templates/{assetTemplateId}", api.handleUpdateShuihuoAssetTemplate)
			r.Delete("/shuihuo-production/asset-templates/{assetTemplateId}", api.handleDeleteShuihuoAssetTemplate)
			r.Get("/shuihuo-production/projects", api.handleListShuihuoProjects)
			r.Post("/shuihuo-production/projects", api.handleCreateShuihuoProject)
			r.Get("/shuihuo-production/projects/{id}", api.handleGetShuihuoProject)
			r.Get("/shuihuo-production/projects/{id}/files", api.handleListShuihuoProjectFiles)
			r.Delete("/shuihuo-production/projects/{id}", api.handleDeleteShuihuoProject)
			r.Get("/shuihuo-production/projects/{id}/assets", api.handleListShuihuoAssets)
			r.Post("/shuihuo-production/projects/{id}/assets", api.handleCreateShuihuoAsset)
			r.Post("/shuihuo-production/projects/{id}/assets/candidates/apply", api.handleApplyShuihuoAssetCandidates)
			r.Post("/shuihuo-production/projects/{id}/prompt-candidates/{kind}", api.handleGenerateShuihuoPromptCandidates)
			r.Put("/shuihuo-production/projects/{id}/prompt-candidates/{kind}/apply", api.handleApplyShuihuoPromptCandidates)
			r.Get("/shuihuo-production/models", api.handleListShuihuoModels)
			r.Post("/shuihuo-production/batch-factory/config-snapshots/resolve", api.handleResolveBatchFactoryConfigSnapshots)
			r.Post("/shuihuo-production/batch-factory/presets/resolve", api.handleResolveBatchFactoryPreset)
			r.Post("/shuihuo-production/batch-factory/hook/contract", api.handleBuildBatchFactoryHookContract)
			r.Post("/shuihuo-production/batch-factory/director/contract", api.handleBuildBatchFactoryDirectorContract)
			r.Post("/shuihuo-production/batch-factory/director/normalize", api.handleNormalizeBatchFactoryDirectorOutput)
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

func embeddedWebHandler(root fs.FS) http.Handler {
	files := http.FileServer(http.FS(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := path.Clean(strings.TrimPrefix(r.URL.Path, "/"))
		if name == "." || name == "" {
			name = "index.html"
		}
		if _, err := fs.Stat(root, name); err != nil {
			name = "index.html"
		}
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/" + name
		files.ServeHTTP(w, r2)
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
