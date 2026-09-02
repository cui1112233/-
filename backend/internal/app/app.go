package app

import (
	"context"
	"database/sql"
	"net/http"
	"qiantie/backend/internal/batchfactoryv11"
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
		production = &batchfactoryv11.ProductionService{Store: store, Compiler: compiler, Adapter: adapter, Enabled: cfg.ProductionEnabled, Model: batchfactoryv11.FrozenVideoModel{ID: cfg.VideoModel}}
	}
	return httpapi.NewRouter(httpapi.RouterOptions{BridgeSecret: cfg.BridgeSecret, Users: storage.BridgeUsers{DB: db}, Slice: cfg.Slice, Store: store, Director: director, Compiler: compiler, Production: production, RegisterV11: register}), nil
}
