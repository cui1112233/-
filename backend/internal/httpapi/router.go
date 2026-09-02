package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
)

type RouterOptions struct {
	BridgeSecret string
	Now          func() time.Time
	Users        BridgeUserResolver
	Slice        int
	RegisterV11  func(*http.ServeMux)
	Store        batchfactoryv11.Store
	Director     *batchfactoryv11.DirectorService
	Compiler     *batchfactoryv11.PromptCompilerService
	Production   *batchfactoryv11.ProductionService
}

func NewRouter(options RouterOptions) http.Handler {
	v11 := http.NewServeMux()
	v11.HandleFunc("GET /api/batch-factory/v11/capabilities", capabilityHandlerForRuntime(options.Slice, options.Production != nil && options.Production.Enabled))
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
	if options.RegisterV11 != nil {
		options.RegisterV11(v11)
	}

	root := http.NewServeMux()
	root.Handle("/api/batch-factory/v11/", BridgeAuth{Secret: options.BridgeSecret, Now: options.Now, Users: options.Users}.Middleware(v11))
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
