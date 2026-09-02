package app

import (
	"context"
	"database/sql"
	"net/http"

	"qiantie/backend/internal/batchfactoryv11"
	"qiantie/backend/internal/config"
	"qiantie/backend/internal/httpapi"
	"qiantie/backend/internal/localartifact"
	"qiantie/backend/internal/localexecutor"
	"qiantie/backend/internal/novelfetchworkshop"
	"qiantie/backend/internal/storage"
)

func Build(ctx context.Context, cfg config.Config, db *sql.DB, register func(*http.ServeMux)) (http.Handler, error) {
	if err := db.PingContext(ctx); err != nil {
		return nil, err
	}
	migrations := append(storage.AppMigrations(), storage.NovelFetchWorkshopMigrations()...)
	if err := storage.RunMigrations(ctx, db, migrations); err != nil {
		return nil, err
	}
	store := batchfactoryv11.NewMySQLStore(db)
	novelFetchStore := novelfetchworkshop.NewMySQLStore(db)
	executorService := localexecutor.NewService(localexecutor.NewMySQLStore(db), nil)
	artifactFiles := localartifact.NewStore(cfg.LocalExecutorArtifactDir, cfg.LocalExecutorArtifactMaxBytes)
	return httpapi.NewRouter(httpapi.RouterOptions{
		BridgeSecret:    cfg.BridgeSecret,
		Users:           storage.BridgeUsers{DB: db},
		Slice:           cfg.Slice,
		Store:           store,
		NovelFetchStore: novelFetchStore,
		RegisterV11:     register,
		LocalExecutors:  executorService,
		LocalArtifacts:  artifactFiles,
	}), nil
}
