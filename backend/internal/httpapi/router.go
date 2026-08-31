package httpapi

import (
	"encoding/json"
	"net/http"
	"time"
)

type RouterOptions struct {
	BridgeSecret string
	Now          func() time.Time
	Users        BridgeUserResolver
	Slice        int
	RegisterV11  func(*http.ServeMux)
}

func NewRouter(options RouterOptions) http.Handler {
	v11 := http.NewServeMux()
	v11.HandleFunc("GET /api/batch-factory/v11/capabilities", capabilityHandler(options.Slice))
	if options.RegisterV11 != nil {
		options.RegisterV11(v11)
	}

	root := http.NewServeMux()
	root.Handle("/api/batch-factory/v11/", BridgeAuth{Secret: options.BridgeSecret, Now: options.Now, Users: options.Users}.Middleware(v11))
	root.HandleFunc("GET /health", func(w http.ResponseWriter, req *http.Request) { writeJSON(w, http.StatusOK, map[string]any{"ok": true}) })
	return root
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
