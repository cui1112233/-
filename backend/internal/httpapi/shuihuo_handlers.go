package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
	shuihuostore "qiantie/backend/internal/shuihuo/store"

	"github.com/go-chi/chi/v5"
)

type shuihuoProjectRequest struct {
	Name       string `json:"name"`
	SourceText string `json:"sourceText"`
}
type shuihuoAssetRequest struct {
	Name               string `json:"name"`
	Prompt             string `json:"prompt"`
	Source             string `json:"source"`
	ReferenceObjectKey string `json:"referenceObjectKey"`
	ManuallyEdited     bool   `json:"manuallyEdited"`
}

func (api *API) handleListShuihuoProjects(w http.ResponseWriter, r *http.Request) {
	if api.deps.DB == nil {
		writeJSON(w, http.StatusOK, map[string]any{"projects": []any{}})
		return
	}
	user, _ := currentUser(r)
	projects, err := shuihuostore.NewProjects(api.deps.DB).List(r.Context(), user.ID, 100)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取作品失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": projects})
}

func (api *API) handleCreateShuihuoProject(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	var req shuihuoProjectRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "作品名称不能为空"})
		return
	}
	user, _ := currentUser(r)
	project, err := shuihuostore.NewProjects(api.deps.DB).Create(r.Context(), user.ID, domain.Project{Name: strings.TrimSpace(req.Name), SourceText: req.SourceText, SegmentationStatus: "draft"})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建作品失败"})
		return
	}
	writeJSON(w, http.StatusCreated, project)
}

func (api *API) handleGetShuihuoProject(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	user, _ := currentUser(r)
	segments, err := shuihuostore.NewSegments(api.deps.DB).ListByProject(r.Context(), user.ID, project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取分段失败"})
		return
	}
	assets, err := shuihuostore.NewAssets(api.deps.DB).ListByProject(r.Context(), user.ID, project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取资产失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"project": project, "segments": segments, "assets": assets})
}

func (api *API) handleListShuihuoAssets(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	user, _ := currentUser(r)
	assets, err := shuihuostore.NewAssets(api.deps.DB).ListByProject(r.Context(), user.ID, project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取资产失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"assets": assets})
}

func (api *API) handleCreateShuihuoAsset(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	var req shuihuoAssetRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产名称不能为空"})
		return
	}
	user, _ := currentUser(r)
	asset, err := shuihuostore.NewAssets(api.deps.DB).Create(r.Context(), user.ID, project.ID, domain.Asset{Name: strings.TrimSpace(req.Name), Prompt: req.Prompt, Source: firstNonEmpty(req.Source, "manual"), ReferenceObjectKey: req.ReferenceObjectKey, ManuallyEdited: req.ManuallyEdited})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建资产失败"})
		return
	}
	writeJSON(w, http.StatusCreated, asset)
}

func (api *API) requireShuihuoDatabase(w http.ResponseWriter) bool {
	if api.deps.DB != nil {
		return true
	}
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "水货生产数据库未连接"})
	return false
}

func parseShuihuoID(r *http.Request, name string) (int64, error) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || id < 1 {
		return 0, sql.ErrNoRows
	}
	return id, nil
}

func isNotFound(err error) bool { return errors.Is(err, sql.ErrNoRows) }

func (api *API) handleListAdminModels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"models": []any{}})
}

func (api *API) handleListShuihuoModels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"models": []any{}})
}
