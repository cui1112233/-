package app

import (
	"context"
	"database/sql"
	"net/http"

	"qiantie/backend/internal/config"
	"qiantie/backend/internal/httpapi"
	"qiantie/backend/internal/legacy"
	"qiantie/backend/internal/storage"
)

type App struct {
	cfg config.Config
	db  *sql.DB
	api *httpapi.API
}

func New(cfg config.Config) (*App, error) {
	db, err := storage.OpenMySQL(cfg.MySQLDSN)
	if err != nil {
		return nil, err
	}
	if err := storage.RunMigrations(context.Background(), db); err != nil {
		db.Close()
		return nil, err
	}
	api := httpapi.New(httpapi.Dependencies{
		DB:           db,
		TokenSecret:  cfg.TokenSecret,
		SeedUsername: cfg.SeedUsername,
		SeedPassword: cfg.SeedPassword,
	})
	return &App{cfg: cfg, db: db, api: api}, nil
}

func (a *App) Router() http.Handler {
	return a.api.Router()
}

func (a *App) ImportLegacy(ctx context.Context, sourceDir string) error {
	return legacy.Import(ctx, a.db, sourceDir)
}

func (a *App) Close() error {
	if a.db == nil {
		return nil
	}
	return a.db.Close()
}
