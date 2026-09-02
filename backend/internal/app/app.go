package app

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"qiantie/backend/internal/batchfactoryv11"
	"qiantie/backend/internal/batchfactoryv11/external"
	"qiantie/backend/internal/config"
	"qiantie/backend/internal/httpapi"
	"qiantie/backend/internal/localartifact"
	"qiantie/backend/internal/localexecutor"
	"qiantie/backend/internal/storage"
)

func Build(ctx context.Context, cfg config.Config, db *sql.DB, register func(*http.ServeMux)) (http.Handler, error) {
	if err := db.PingContext(ctx); err != nil {
		return nil, err
	}
	if err := storage.RunMigrations(ctx, db, storage.AppMigrations()); err != nil {
		return nil, err
	}
	store := batchfactoryv11.NewReadbackMySQLStore(db)
	var director *batchfactoryv11.DirectorService
	if cfg.Slice >= 2 {
		provider := &batchfactoryv11.OpenAICompatibleProvider{Endpoint: cfg.DirectorEndpoint, APIKey: cfg.DirectorAPIKey, Model: cfg.DirectorModel}
		if err := provider.Validate(); err != nil { return nil, err }
		director = &batchfactoryv11.DirectorService{Store: store, Provider: provider}
	}
	compiler := &batchfactoryv11.PromptCompilerService{Store: store}
	videoRegistry := batchfactoryv11.NewMemoryVideoProviderRegistry()
	localExecutorService := localexecutor.NewService(localexecutor.NewMySQLStore(db), nil)
	artifactStore := localartifact.NewStore(cfg.LocalExecutorArtifactDir, cfg.LocalExecutorArtifactMaxBytes)
	var production *batchfactoryv11.ProductionService
	if cfg.Slice >= 4 {
		var fallbackAdapter batchfactoryv11.ProductionAdapter
		if strings.TrimSpace(cfg.VideoEndpoint) != "" && strings.TrimSpace(cfg.VideoPollEndpoint) != "" && strings.TrimSpace(cfg.VideoAPIKey) != "" && strings.TrimSpace(cfg.VideoModel) != "" {
			adapter := &batchfactoryv11.HTTPVideoAdapter{Endpoint: cfg.VideoEndpoint, PollEndpoint: cfg.VideoPollEndpoint, APIKey: cfg.VideoAPIKey, Model: cfg.VideoModel}
			if err := adapter.Validate(); err != nil { return nil, err }
			fallbackAdapter = adapter
		}
		localAdapter := batchfactoryv11.NewLocalExecutorVideoAdapter(&localVideoJobClient{service: localExecutorService}, cfg.LocalExecutorPublicBaseURL)
		localAdapter.ArtifactSecret = cfg.BridgeSecret
		modelID := strings.TrimSpace(cfg.VideoModel)
		if modelID == "" { modelID = batchfactoryv11.DefaultPersonalVideoModel }
		var fallbackPoller batchfactoryv11.ProductionPoller
		if poller, ok := fallbackAdapter.(batchfactoryv11.ProductionPoller); ok { fallbackPoller = poller }
		production = &batchfactoryv11.ProductionService{
			Store: store, Compiler: compiler, Adapter: fallbackAdapter, Poller: fallbackPoller,
			ProviderRegistry: videoRegistry, LocalExecutor: localAdapter,
			Enabled: cfg.ProductionEnabled, Model: batchfactoryv11.FrozenVideoModel{ID: modelID, MaxDuration: 15},
		}
	}
	var merge *batchfactoryv11.MergeService
	if cfg.Slice >= 5 {
		adapter := &batchfactoryv11.HTTPMergeAdapter{Endpoint: cfg.MergeEndpoint, PollEndpoint: cfg.MergePollEndpoint, APIKey: cfg.MergeAPIKey}
		if err := adapter.Validate(); err != nil { return nil, err }
		merge = &batchfactoryv11.MergeService{Store: store, Adapter: adapter, Poller: adapter, Enabled: cfg.MergeEnabled}
	}
	var externalPublish *external.Service
	if cfg.Slice >= 6 {
		externalStore := external.NewMySQLStore(db)
		provider121 := external.New121Provider(cfg.External121Endpoint, cfg.External121APIKey)
		providerYadi := external.NewYadiProvider(cfg.ExternalYadiEndpoint, cfg.ExternalYadiAPIKey)
		if cfg.External121Enabled {
			if err := provider121.Validate(); err != nil { return nil, err }
		}
		if cfg.ExternalYadiEnabled {
			if err := providerYadi.Validate(); err != nil { return nil, err }
		}
		externalPublish = &external.Service{
			Credentials: externalStore, Intents: externalStore, Audits: externalStore,
			BatchReader:      store,
			ProductionReader: production,
			MergeReader:      merge,
			Providers: map[external.Provider]external.SubmissionProvider{
				external.Provider121: provider121,
				external.ProviderYadi: providerYadi,
		},
		Enabled: map[external.Provider]bool{external.Provider121: cfg.External121Enabled, external.ProviderYadi: cfg.ExternalYadiEnabled},
		Key: cfg.ExternalCredentialsKey,
	}
	}
	return httpapi.NewRouter(httpapi.RouterOptions{BridgeSecret: cfg.BridgeSecret, Users: storage.BridgeUsers{DB: db}, Slice: cfg.Slice, Store: store, Director: director, Compiler: compiler, Production: production, Merge: merge, External: externalPublish, LocalExecutors: localExecutorService, LocalArtifacts: artifactStore, RegisterV11: register}), nil
}
