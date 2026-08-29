package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"qiantie/backend/internal/credentials"
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
	ImageConfigs      ImageConfigStore
	VideoConfigs      VideoConfigStore
	CredentialCipher  *credentials.Cipher
	Histories         HistoryStore
	Presets           PresetStore
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
		r.With(api.requireAuth).Get("/login/session", api.handleMe)
		r.With(api.requireAuth).Post("/login/logout", api.handleLogout)
		r.Post("/logout", api.handleLogout)
		// Local executors authenticate with an opaque device token issued through
		// a short-lived, user-authorized pairing code. They never receive the
		// browser session token or any provider account credentials.
		r.Post("/local-executors/pair", api.handlePairLocalExecutor)
		r.Post("/local-executors/heartbeat", api.handleLocalExecutorHeartbeat)
		r.Post("/local-executors/jobs/claim", api.handleClaimLocalExecutorJob)
		r.Post("/local-executors/jobs/{jobId}/status", api.handleUpdateLocalExecutorJobStatus)
		r.Post("/local-executors/jobs/{jobId}/result", api.handleUploadLocalExecutorJobResult)
		r.With(api.requireAuth).Get("/me", api.handleMe)
		r.With(api.requireAuth).Get("/config", api.handleGetConfig)
		r.With(api.requireAuth, api.requireOwner).Get("/admin/presets", api.handleEmbeddedPresets)
		r.With(api.requireAuth, api.requireOwner).Post("/admin/presets/draft", api.handleCreatePresetDraft)
		r.With(api.requireAuth, api.requireOwner).Post("/admin/presets/{id}/publish", api.handlePublishPreset)
		r.With(api.requireAuth, api.requireOwner).Post("/admin/presets/{id}/rollback", api.handleRollbackPreset)
		r.With(api.requireAuth).Post("/config", api.handleSaveConfig)
		r.With(api.requireAuth).Post("/config/test", api.handleTestConfig)
		r.With(api.requireAuth).Get("/history", api.handleListHistory)
		r.With(api.requireAuth).Post("/history", api.handleSaveHistory)
		r.With(api.requireAuth).Get("/history/{id}", api.handleGetHistory)
		r.With(api.requireAuth).Delete("/history/{id}", api.handleDeleteHistory)
		r.With(api.requireAuth).Delete("/history", api.handleClearHistory)
		r.Group(func(r chi.Router) {
			r.Use(api.requireAuth)
			r.Get("/batch-factory/batches", api.handleListBatchFactoryBatches)
			r.Post("/batch-factory/batches", api.handleCreateBatchFactoryBatch)
			r.Get("/batch-factory/batches/{batchId}", api.handleGetBatchFactoryBatch)
			r.Put("/batch-factory/batches/{batchId}/settings", api.handleUpdateBatchFactorySettings)
			r.Put("/batch-factory/batches/{batchId}/items/{itemId}", api.handleUpdateBatchFactoryItem)
			r.Post("/batch-factory/intakes/novel-fetch", api.handleCreateBatchFactoryIntake)
			r.Get("/batch-factory/intakes/{intakeId}", api.handleGetBatchFactoryIntake)
		})
		r.Group(func(r chi.Router) {
			r.Use(api.requirePlatformAuth)
			r.Get("/novel-fetch-workshop/config", api.handleGetNovelFetchWorkshopSettings)
			r.Put("/novel-fetch-workshop/config", api.handleSaveNovelFetchWorkshopSettings)
			r.Get("/novel-fetch-workshop/tasks", api.handleListNovelFetchWorkshopTasks)
			r.Delete("/novel-fetch-workshop/tasks", api.handleDeleteNovelFetchWorkshopTasks)
			r.Get("/novel-fetch-workshop/tasks/{bookId}", api.handleGetNovelFetchWorkshopTask)
			r.Put("/novel-fetch-workshop/tasks/{bookId}", api.handleSaveNovelFetchWorkshopTask)
			r.Get("/batch-factory-data/batches", api.handleListBatchFactoryBatches)
			r.Post("/batch-factory-data/batches", api.handleCreateBatchFactoryBatch)
			r.Get("/batch-factory-data/batches/{batchId}", api.handleGetBatchFactoryBatch)
			r.Put("/batch-factory-data/batches/{batchId}/settings", api.handleUpdateBatchFactorySettings)
			r.Put("/batch-factory-data/batches/{batchId}/items/{itemId}", api.handleUpdateBatchFactoryItem)
			r.Post("/batch-factory-data/intakes", api.handleCreateBatchFactoryIntake)
			r.Get("/batch-factory-data/intakes/{intakeId}", api.handleGetBatchFactoryIntake)
			r.Get("/shuihuo-production/health", api.handleShuihuoHealth)
			r.Post("/script-videos/local", api.handleCreateLocalScriptVideo)
			r.Get("/script-videos/{taskId}", api.handleGetLocalScriptVideo)
			r.Get("/script-videos/{taskId}/download", api.handleDownloadLocalScriptVideo)
			r.Get("/shuihuo-production/local-executors", api.handleListLocalExecutors)
			r.Post("/shuihuo-production/local-executors/pairings", api.handleCreateLocalExecutorPairing)
			r.Get("/shuihuo-production/config", api.handleGetShuihuoProductionConfig)
			r.Put("/shuihuo-production/config", api.handleSaveShuihuoProductionConfig)
			r.Put("/shuihuo-production/account-ai-config", api.handleSaveBridgeAccountAIConfig)
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
			r.Post("/shuihuo-production/projects/import", api.handleImportShuihuoProject)
			r.Get("/shuihuo-production/projects/{id}", api.handleGetShuihuoProject)
			r.Get("/shuihuo-production/projects/{id}/voice-settings", api.handleListShuihuoSegmentVoiceSettings)
			r.Get("/shuihuo-production/projects/{id}/export", api.handleExportShuihuoProject)
			r.Get("/shuihuo-production/projects/{id}/files", api.handleListShuihuoProjectFiles)
			r.Delete("/shuihuo-production/projects/{id}", api.handleDeleteShuihuoProject)
			r.Put("/shuihuo-production/projects/{id}/source", api.handleReplaceShuihuoSource)
			r.Get("/shuihuo-production/projects/{id}/assets", api.handleListShuihuoAssets)
			r.Post("/shuihuo-production/projects/{id}/assets", api.handleCreateShuihuoAsset)
			r.Post("/shuihuo-production/projects/{id}/assets/image", api.handleUploadShuihuoAssetImage)
			r.Post("/shuihuo-production/projects/{id}/assets/generate", api.handleCreateShuihuoAssetImageTasks)
			r.Get("/shuihuo-production/projects/{id}/asset-generation-config", api.handleGetShuihuoAssetGenerationConfig)
			r.Put("/shuihuo-production/projects/{id}/asset-generation-config", api.handleSaveShuihuoAssetGenerationConfig)
			r.Post("/shuihuo-production/projects/{id}/assets/candidates/apply", api.handleApplyShuihuoAssetCandidates)
			r.Post("/shuihuo-production/projects/{id}/prompt-candidates/{kind}", api.handleGenerateShuihuoPromptCandidates)
			r.Put("/shuihuo-production/projects/{id}/prompt-candidates/{kind}/apply", api.handleApplyShuihuoPromptCandidates)
			r.Put("/shuihuo-production/assets/{assetId}", api.handleUpdateShuihuoAsset)
			r.Put("/shuihuo-production/assets/{assetId}/image", api.handleReplaceShuihuoAssetImage)
			r.Get("/shuihuo-production/assets/{assetId}/image", api.handleDownloadShuihuoAssetImage)
			r.Get("/shuihuo-production/assets/{assetId}/images", api.handleListShuihuoAssetImages)
			r.Put("/shuihuo-production/asset-images/{assetImageId}/primary", api.handleSetShuihuoAssetImagePrimary)
			r.Get("/shuihuo-production/asset-images/{assetImageId}/download", api.handleDownloadShuihuoGeneratedAssetImage)
			r.Delete("/shuihuo-production/assets/{assetId}", api.handleDeleteShuihuoAsset)
			r.Post("/shuihuo-production/projects/{id}/media", api.handleUploadShuihuoMedia)
			r.Put("/shuihuo-production/media/{mediaId}/segment", api.handleAttachShuihuoMedia)
			r.Put("/shuihuo-production/media/{mediaId}/primary", api.handleSetShuihuoPrimaryMedia)
			r.Delete("/shuihuo-production/media/{mediaId}", api.handleDeleteShuihuoMedia)
			r.Get("/shuihuo-production/media/{mediaId}/download", api.handleDownloadShuihuoMedia)
			r.Get("/shuihuo-production/models", api.handleListShuihuoModels)
			r.Post("/shuihuo-production/batch-factory/import-videos", api.handleImportBatchFactoryVideos)
			r.Post("/shuihuo-production/batch-factory/status", api.handleBatchFactoryProductionStatus)
			r.Get("/shuihuo-production/batch-factory/merge-capability", api.handleBatchFactoryMergeCapability)
			r.Post("/shuihuo-production/batch-factory/merge-videos", api.handleBatchFactoryMergeVideos)
			r.Get("/shuihuo-production/projects/{id}/tasks", api.handleListShuihuoTasks)
			r.Post("/shuihuo-production/projects/{id}/tasks", api.handleCreateShuihuoTask)
			r.Post("/shuihuo-production/projects/{id}/tasks/batch", api.handleCreateShuihuoBatchTasks)
			r.Post("/shuihuo-production/projects/{id}/segmentation/fixed", api.handleFixedSegmentation)
			r.Post("/shuihuo-production/projects/{id}/segmentation/paragraphs", api.handleParagraphSegmentation)
			r.Post("/shuihuo-production/projects/{id}/segmentation/import", api.handleImportSegmentation)
			r.Post("/shuihuo-production/projects/{id}/segmentation/smart", api.handleSmartSegmentation)
			r.Post("/shuihuo-production/projects/{id}/analysis/assets", api.handleShuihuoAssetAnalysis)
			r.Post("/shuihuo-production/projects/{id}/analysis/assets-and-bindings", api.handleShuihuoAssetPlan)
			r.Post("/shuihuo-production/projects/{id}/segmentation/confirm", api.handleConfirmSegmentation)
			r.Post("/shuihuo-production/segments/{segmentId}/merge-up", api.handleMergeShuihuoStoryboard)
			r.Post("/shuihuo-production/segments/{segmentId}/split", api.handleSplitShuihuoStoryboard)
			r.Post("/shuihuo-production/segments/{segmentId}/insert-after", api.handleInsertShuihuoStoryboard)
			r.Put("/shuihuo-production/segments/{segmentId}", api.handleUpdateShuihuoStoryboard)
			r.Delete("/shuihuo-production/segments/{segmentId}", api.handleDeleteShuihuoStoryboard)
			r.Put("/shuihuo-production/segments/{segmentId}/assets", api.handleReplaceShuihuoStoryboardAssets)
			r.Put("/shuihuo-production/segments/{segmentId}/voice-settings", api.handleSaveShuihuoSegmentVoiceSettings)
			r.Put("/shuihuo-production/projects/{id}/segments/order", api.handleReorderShuihuoStoryboards)
			r.Put("/shuihuo-production/tasks/{taskId}/cancel", api.handleCancelShuihuoTask)
			r.Post("/shuihuo-production/tasks/{taskId}/retry", api.handleRetryShuihuoTask)
			r.With(api.requireOwner).Get("/shuihuo-production/admin/models", api.handleAdminModelList)
			r.With(api.requireOwner).Post("/shuihuo-production/admin/models", api.handleCreateAdminModel)
			r.With(api.requireOwner).Get("/shuihuo-production/admin/object-cleanups", api.handleListShuihuoObjectCleanups)
			r.With(api.requireOwner).Post("/shuihuo-production/admin/object-cleanups/run", api.handleRunShuihuoObjectCleanups)
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
