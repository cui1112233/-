package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"

	"qiantie/backend/internal/store"

	"github.com/go-chi/chi/v5"
)

type Dependencies struct {
	DB           *sql.DB
	TokenSecret  string
	SeedUsername string
	SeedPassword string
	Users        UserStore
	Configs      ConfigStore
	Histories    HistoryStore
}

type UserStore interface {
	FindByUsername(ctx context.Context, username string) (store.User, error)
	FindByID(ctx context.Context, id int64) (store.User, error)
}

type API struct {
	deps Dependencies
}

func New(deps Dependencies) *API {
	return &API{deps: deps}
}

func (api *API) Router() http.Handler {
	r := chi.NewRouter()
	r.Get("/healthz", api.handleHealth)
	r.Route("/api", func(r chi.Router) {
		r.Post("/login", api.handleLogin)
		r.Post("/logout", api.handleLogout)
		r.With(api.requireAuth).Get("/me", api.handleMe)
		r.With(api.requireAuth).Get("/config", api.handleGetConfig)
		r.With(api.requireAuth).Post("/config", api.handleSaveConfig)
		r.With(api.requireAuth).Post("/config/test", api.handleTestConfig)
		r.With(api.requireAuth).Get("/history", api.handleListHistory)
		r.With(api.requireAuth).Post("/history", api.handleSaveHistory)
		r.With(api.requireAuth).Get("/history/{id}", api.handleGetHistory)
		r.With(api.requireAuth).Delete("/history/{id}", api.handleDeleteHistory)
		r.With(api.requireAuth).Delete("/history", api.handleClearHistory)
		r.With(api.requireAuth).Get("/shuihuo-production/projects", api.handleListShuihuoProjects)
		r.With(api.requireAuth).Post("/shuihuo-production/projects", api.handleCreateShuihuoProject)
		r.With(api.requireAuth).Get("/shuihuo-production/projects/{id}", api.handleGetShuihuoProject)
		r.With(api.requireAuth).Get("/shuihuo-production/projects/{id}/assets", api.handleListShuihuoAssets)
		r.With(api.requireAuth).Post("/shuihuo-production/projects/{id}/assets", api.handleCreateShuihuoAsset)
		r.With(api.requireAuth).Get("/shuihuo-production/models", api.handleListShuihuoModels)
		r.With(api.requireAuth).Post("/shuihuo-production/projects/{id}/segmentation/fixed", api.handleFixedSegmentation)
		r.With(api.requireAuth).Post("/shuihuo-production/projects/{id}/segmentation/import", api.handleImportSegmentation)
		r.With(api.requireAuth).Post("/shuihuo-production/projects/{id}/segmentation/smart", api.handleSmartSegmentation)
		r.With(api.requireAuth).Post("/shuihuo-production/projects/{id}/segmentation/confirm", api.handleConfirmSegmentation)
		r.With(api.requireAuth, api.requireOwner).Get("/admin/models", api.handleListAdminModels)
	})
	return r
}

func (api *API) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func readJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(target)
}
