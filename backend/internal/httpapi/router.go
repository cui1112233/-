package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
	"qiantie/backend/internal/batchfactoryv11/external"
	"qiantie/backend/internal/localartifact"
	"qiantie/backend/internal/localexecutor"
	"qiantie/backend/internal/novelfetchworkshop"
)

type RouterOptions struct {
	BridgeSecret    string
	ReleaseSHA      string
	Now             func() time.Time
	Users           BridgeUserResolver
	Slice           int
	RegisterV11     func(*http.ServeMux)
	Store           batchfactoryv11.Store
	Director        *batchfactoryv11.DirectorService
	Compiler        *batchfactoryv11.PromptCompilerService
	Production      *batchfactoryv11.ProductionService
	Merge           *batchfactoryv11.MergeService
	External        *external.Service
	NovelFetchStore novelfetchworkshop.LifecycleStore
	LocalExecutors  *localexecutor.Service
	LocalArtifacts  *localartifact.Store
}

func NewRouter(options RouterOptions) http.Handler {
	v11 := http.NewServeMux()
	v11.HandleFunc("GET /api/batch-factory/v11/capabilities", capabilityHandlerForRuntime(options.Slice, options.Production != nil && options.Production.Enabled, options.Merge != nil && options.Merge.Enabled, options.External != nil && options.External.Enabled[external.Provider121], options.External != nil && options.External.Enabled[external.ProviderYadi]))
	if options.Store != nil && options.Slice >= 1 {
		registerSliceOneRoutes(v11, options.Store)
	}
	if options.Store != nil && options.Director != nil && options.Slice >= 2 {
		registerDirectorRoutes(v11, options.Director, options.Store)
	}
	if options.Compiler != nil && options.Slice >= 3 {
		registerCompilerRoutes(v11, options.Compiler)
	}
	if options.Production != nil && options.Slice >= 4 {
		registerProductionRoutes(v11, options.Production)
	}
	if options.Merge != nil && options.Slice >= 5 {
		registerMergeRoutes(v11, options.Merge)
	}
	if options.External != nil && options.Slice >= 6 {
		registerExternalRoutes(v11, options.External)
	}
	if options.RegisterV11 != nil {
		options.RegisterV11(v11)
	}

	root := http.NewServeMux()
	root.HandleFunc("GET /api/runtime-build-info", func(w http.ResponseWriter, req *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"service": "go-api", "git_sha": options.ReleaseSHA})
	})
	auth := BridgeAuth{Secret: options.BridgeSecret, Now: options.Now, Users: options.Users}
	root.Handle("/api/batch-factory/v11/", auth.Middleware(v11))
	RegisterLocalExecutorRoutes(root, auth, options.LocalExecutors)
	RegisterLocalExecutorJobRoutes(root, auth, options.LocalExecutors)
	RegisterLocalExecutorArtifactRoutes(root, auth, options.LocalExecutors, options.LocalArtifacts)
	if options.NovelFetchStore != nil {
		novelFetch := http.NewServeMux()
		registerNovelFetchWorkshopRoutes(novelFetch, options.NovelFetchStore)
		registerNovelFetchCleanupRoutes(novelFetch, options.NovelFetchStore, options.Now)
		root.Handle("/api/novel-fetch-workshop/", NovelFetchBridgeAuth{Secret: options.BridgeSecret, Now: options.Now, Users: options.Users}.Middleware(novelFetch))
	}
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
