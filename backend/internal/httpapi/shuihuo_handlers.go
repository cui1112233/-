package httpapi

import (
	"net/http"
)

func (api *API) handleListShuihuoProjects(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"projects": []any{}})
}

func (api *API) handleListAdminModels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"models": []any{}})
}
