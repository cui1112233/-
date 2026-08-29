package app

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"qiantie/backend/internal/auth"
	"qiantie/backend/internal/config"
	"qiantie/backend/internal/httpapi"
	"qiantie/backend/internal/legacy"
	shuihuomodels "qiantie/backend/internal/shuihuo/models"
	"qiantie/backend/internal/shuihuo/providers"
	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
	shuihuotasks "qiantie/backend/internal/shuihuo/tasks"
	"qiantie/backend/internal/storage"
	"qiantie/backend/internal/store"
)

type App struct {
	cfg          config.Config
	db           *sql.DB
	api          *httpapi.API
	objects      shuihuostorage.ObjectStorage
	workerCancel context.CancelFunc
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
	preferences := store.NewPreferences(db)
	histories := store.NewHistories(db)
	redisHealth := httpapi.ShuihuoDependencyHealth{Reason: "Redis 未配置"}
	var queue shuihuotasks.Queue
	if cfg.RedisAddr != "" {
		redisQueue := shuihuotasks.NewRedisQueue(cfg.RedisAddr)
		probeCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		err := pingRedis(probeCtx, cfg.RedisAddr)
		cancel()
		if err == nil {
			redisHealth = httpapi.ShuihuoDependencyHealth{Ready: true}
			queue = redisQueue
		} else {
			redisHealth = httpapi.ShuihuoDependencyHealth{Reason: "Redis 连接或 PING 失败"}
		}
	}
	enabledKinds, modelHealth := enabledShuihuoModelKinds(context.Background(), db)
	health := httpapi.NewShuihuoHealth(
		httpapi.ShuihuoDependencyHealth{Ready: true},
		redisHealth,
		httpapi.ShuihuoDependencyHealth{Ready: objects != nil},
		enabledKinds,
	)
	if modelHealth != "" {
		health.Models = httpapi.ShuihuoDependencyHealth{Reason: modelHealth}
	}
	api := httpapi.New(httpapi.Dependencies{
		DB:                db,
		TokenSecret:       cfg.TokenSecret,
		BridgeSecret:      cfg.BridgeSecret,
		SeedUsername:      cfg.SeedUsername,
		SeedPassword:      cfg.SeedPassword,
		Users:             users,
		Configs:           configs,
		Preferences:       preferences,
		Histories:         histories,
		Objects:           objects,
		Queue:             queue,
		Health:            health,
		TextCompletion:    providers.NewTextCompletion(nil, cfg.ModelCredential),
		TextModelEndpoint: cfg.ModelEndpoint,
	})
	application := &App{cfg: cfg, db: db, api: api, objects: objects}
	if queue != nil {
		workerCtx, cancel := context.WithCancel(context.Background())
		application.workerCancel = cancel
		vidu := providers.NewVidu(nil, cfg.ModelCredential, cfg.ModelEndpoint)
		genericHTTP := shuihuomodels.NewGenericHTTPAdapter(nil, cfg.ModelCredential)
		tasksRepo := shuihuostore.NewTasks(db)
		modelsRepo := shuihuostore.NewModels(db)
		objectsBridge := shuihuotasks.ObjectStorageBridge{Store: objects}
		worker := shuihuotasks.Worker{
			Tasks: tasksRepo, Models: modelsRepo, Segments: shuihuostore.NewSegments(db), Media: shuihuostore.NewMedia(db),
			Objects: objectsBridge,
			Adapter: shuihuomodels.AdapterRouter{
				shuihuomodels.AdapterJimengImage:      providers.NewJimeng(nil, cfg.ModelCredential),
				shuihuomodels.AdapterViduImageToVideo: vidu,
				shuihuomodels.AdapterGenericHTTP:      genericHTTP,
			},
		}
		poller := shuihuotasks.Poller{
			Tasks: tasksRepo, Models: modelsRepo, Provider: vidu,
			Objects: objectsBridge,
		}
		genericPoller := shuihuotasks.GenericPoller{
			Tasks: tasksRepo, Models: modelsRepo, Provider: genericHTTP,
			Objects: objectsBridge,
		}
		go func() { _ = worker.Run(workerCtx, queue) }()
		go func() { _ = poller.Run(workerCtx) }()
		go func() { _ = genericPoller.Run(workerCtx) }()
	}
	return application, nil
}

func pingRedis(ctx context.Context, address string) error {
	dialer := net.Dialer{}
	connection, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return err
	}
	defer connection.Close()
	if deadline, ok := ctx.Deadline(); ok {
		if err := connection.SetDeadline(deadline); err != nil {
			return err
		}
	}
	if _, err := connection.Write([]byte("*1\r\n$4\r\nPING\r\n")); err != nil {
		return err
	}
	response, err := bufio.NewReader(connection).ReadString('\n')
	if err != nil {
		return err
	}
	if response != "+PONG\r\n" {
		return fmt.Errorf("unexpected Redis PING response")
	}
	return nil
}

func enabledShuihuoModelKinds(ctx context.Context, db *sql.DB) ([]string, string) {
	models, err := shuihuostore.NewModels(db).ListEnabled(ctx)
	if err != nil {
		return nil, "读取已启用模型失败"
	}
	kinds := make([]string, 0, len(models))
	for _, model := range models {
		kind := strings.TrimSpace(string(model.Kind))
		if kind != "" {
			kinds = append(kinds, kind)
		}
	}
	return kinds, ""
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
	if a.workerCancel != nil {
		a.workerCancel()
	}
	if a.db == nil {
		return nil
	}
	return a.db.Close()
}
