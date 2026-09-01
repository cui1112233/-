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
	return httpapi.NewRouter(httpapi.RouterOptions{BridgeSecret: cfg.BridgeSecret, Users: storage.BridgeUsers{DB: db}, Slice: cfg.Slice, Store: store, RegisterV11: register}), nil
}
