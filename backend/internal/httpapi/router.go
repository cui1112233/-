package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
	"qiantie/backend/internal/localartifact"
	"qiantie/backend/internal/localexecutor"
	"qiantie/backend/internal/novelfetchworkshop"
)

type RouterOptions struct {
	BridgeSecret    string
	Now             func() time.Time
	Users           BridgeUserResolver
	Slice           int
	RegisterV11     func(*http.ServeMux)
	Store           batchfactoryv11.Store
	NovelFetchStore novelfetchworkshop.LifecycleStore
	LocalExecutors  *localexecutor.Service
	LocalArtifacts  *localartifact.Store
}

func NewRouter(options RouterOptions) http.Handler {
	v11 := http.NewServeMux()
	v11.HandleFunc("GET /api/batch-factory/v11/capabilities", capabilityHandler(options.Slice))
	if options.Store != nil && options.Slice >= 1 {
		registerSliceOneRoutes(v11, options.Store)
	}
	if options.RegisterV11 != nil {
		options.RegisterV11(v11)
	}

	root := http.NewServeMux()
	auth := BridgeAuth{Secret: options.BridgeSecret, Now: options.Now, Users: options.Users}
	root.Handle("/api/batch-factory/v11/", auth.Middleware(v11))
	if options.NovelFetchStore != nil {
		novelFetch := http.NewServeMux()
		registerNovelFetchWorkshopRoutes(novelFetch, options.NovelFetchStore)
		registerNovelFetchCleanupRoutes(novelFetch, options.NovelFetchStore, options.Now)
		root.Handle("/api/novel-fetch-workshop/", NovelFetchBridgeAuth{Secret: options.BridgeSecret, Now: options.Now, Users: options.Users}.Middleware(novelFetch))
	}
	RegisterLocalExecutorRoutes(root, auth, options.LocalExecutors)
	RegisterLocalExecutorJobRoutes(root, auth, options.LocalExecutors)
	RegisterLocalExecutorArtifactRoutes(root, auth, options.LocalExecutors, options.LocalArtifacts)
	root.HandleFunc("GET /health", func(w http.ResponseWriter, req *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	return root
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
