package app

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"

	"qiantie/backend/internal/auth"
	"qiantie/backend/internal/config"
	"qiantie/backend/internal/httpapi"
	"qiantie/backend/internal/legacy"
	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
	"qiantie/backend/internal/storage"
	"qiantie/backend/internal/store"
)

type App struct {
	cfg     config.Config
	db      *sql.DB
	api     *httpapi.API
	objects shuihuostorage.ObjectStorage
}

func New(cfg config.Config) (*App, error) {
	objects, err := newObjectStorage(cfg.Storage)
	if err != nil {
		return nil, err
	}
	db, err := storage.OpenMySQL(cfg.MySQLDSN)
	if err != nil {
		return nil, err
	}
	if err := storage.RunMigrations(context.Background(), db); err != nil {
		db.Close()
		return nil, err
	}
	users := store.NewUsers(db)
	if err := users.EnsureSeedOwner(context.Background(), cfg.SeedUsername, auth.HashPassword(cfg.SeedPassword)); err != nil {
		db.Close()
		return nil, err
	}
	configs := store.NewConfigs(db)
	histories := store.NewHistories(db)
	api := httpapi.New(httpapi.Dependencies{
		DB:           db,
		TokenSecret:  cfg.TokenSecret,
		SeedUsername: cfg.SeedUsername,
		SeedPassword: cfg.SeedPassword,
		Users:        users,
		Configs:      configs,
		Histories:    histories,
	})
	return &App{cfg: cfg, db: db, api: api, objects: objects}, nil
}

func newObjectStorage(cfg config.StorageConfig) (shuihuostorage.ObjectStorage, error) {
	switch cfg.Driver {
	case "local":
		return shuihuostorage.NewLocal(cfg.LocalDir, cfg.PublicBaseURL), nil
	case "tos":
		return shuihuostorage.NewTOS(shuihuostorage.TOSConfig{Bucket: cfg.Bucket, Endpoint: cfg.Endpoint, Region: cfg.Region, AccessKey: cfg.AccessKey, SecretKey: cfg.SecretKey})
	case "minio":
		return shuihuostorage.NewMinIO(shuihuostorage.MinIOConfig{Bucket: cfg.Bucket, Endpoint: cfg.Endpoint, AccessKey: cfg.AccessKey, SecretKey: cfg.SecretKey})
	default:
		return nil, fmt.Errorf("unsupported object storage driver %q", cfg.Driver)
	}
}

func (a *App) Router() http.Handler {
	return a.api.Router()
}

func (a *App) ImportLegacy(ctx context.Context, sourceDir string) error {
	return legacy.Import(ctx, a.db, sourceDir, auth.HashPassword(a.cfg.SeedPassword))
}

func (a *App) Close() error {
	if a.db == nil {
		return nil
	}
	return a.db.Close()
}
