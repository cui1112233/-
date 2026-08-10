package app

import (
	"context"
	"database/sql"
	"net/http"

	"qiantie/backend/internal/auth"
	"qiantie/backend/internal/config"
	"qiantie/backend/internal/httpapi"
	"qiantie/backend/internal/legacy"
	"qiantie/backend/internal/storage"
	"qiantie/backend/internal/store"
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
	users := store.NewUsers(db)
	if err := users.EnsureUser(context.Background(), cfg.SeedUsername, auth.HashPassword(cfg.SeedPassword)); err != nil {
		db.Close()
		return nil, err
	}
	configs := store.NewConfigs(db)
	api := httpapi.New(httpapi.Dependencies{
		DB:           db,
		TokenSecret:  cfg.TokenSecret,
		SeedUsername: cfg.SeedUsername,
		SeedPassword: cfg.SeedPassword,
		Users:        users,
		Configs:      configs,
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
