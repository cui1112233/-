package app

import (
	"context"
	"database/sql"
	"net/http"
	"qiantie/backend/internal/batchfactoryv11"
	"qiantie/backend/internal/batchfactoryv11/external"
	"qiantie/backend/internal/config"
	"qiantie/backend/internal/httpapi"
	"qiantie/backend/internal/storage"
)

func Build(ctx context.Context, cfg config.Config, db *sql.DB, register func(*http.ServeMux)) (http.Handler, error) {
	if err := db.PingContext(ctx); err != nil {
		return nil, err
	}
	if err := storage.RunMigrations(ctx, db, storage.V11Migrations()); err != nil {
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
	var production *batchfactoryv11.ProductionService
	if cfg.Slice >= 4 {
		adapter := &batchfactoryv11.HTTPVideoAdapter{Endpoint: cfg.VideoEndpoint, PollEndpoint: cfg.VideoPollEndpoint, APIKey: cfg.VideoAPIKey, Model: cfg.VideoModel}
		if err := adapter.Validate(); err != nil { return nil, err }
		production = &batchfactoryv11.ProductionService{Store: store, Compiler: compiler, Adapter: adapter, Poller: adapter, Enabled: cfg.ProductionEnabled, Model: batchfactoryv11.FrozenVideoModel{ID: cfg.VideoModel}}
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
		externalPublish = &external.Service{
		Credentials: externalStore, Intents: externalStore, Audits: externalStore,
		Providers: map[external.Provider]external.SubmissionProvider{
			external.Provider121: &external.HTTPProvider{Provider: external.Provider121, Endpoint: cfg.External121Endpoint, APIKey: cfg.External121APIKey},
			external.ProviderYadi: &external.HTTPProvider{Provider: external.ProviderYadi, Endpoint: cfg.ExternalYadiEndpoint, APIKey: cfg.ExternalYadiAPIKey},
		},
		Enabled: map[external.Provider]bool{external.Provider121: cfg.External121Enabled, external.ProviderYadi: cfg.ExternalYadiEnabled},
		Key: cfg.ExternalCredentialsKey,
	}
	}
	return httpapi.NewRouter(httpapi.RouterOptions{BridgeSecret: cfg.BridgeSecret, Users: storage.BridgeUsers{DB: db}, Slice: cfg.Slice, Store: store, Director: director, Compiler: compiler, Production: production, Merge: merge, External: externalPublish, RegisterV11: register}), nil
}
