package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"qiantie/backend/internal/shuihuo/assets"
	"qiantie/backend/internal/shuihuo/domain"
	shuihuostore "qiantie/backend/internal/shuihuo/store"

	"github.com/go-chi/chi/v5"
)

type shuihuoProjectRequest struct {
	Name       string `json:"name"`
	SourceText string `json:"sourceText"`
}
type shuihuoAssetRequest struct {
	Category           string `json:"category"`
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

func (api *API) handleListShuihuoProjectFiles(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	user, _ := currentUser(r)
	media, err := shuihuostore.NewMedia(api.deps.DB).ListByProject(r.Context(), user.ID, project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取作品文件失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hasSourceFile": project.SourceObjectKey != "",
		"media":         media,
	})
}

func (api *API) handleDeleteShuihuoProject(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	user, _ := currentUser(r)
	media, err := shuihuostore.NewMedia(api.deps.DB).ListByProject(r.Context(), user.ID, project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取作品素材失败"})
		return
	}
	if err := shuihuostore.NewProjects(api.deps.DB).Delete(r.Context(), user.ID, project.ID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "作品不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "删除作品失败"})
		return
	}
	if api.deps.Objects != nil {
		for _, item := range media {
			_ = api.deps.Objects.Delete(r.Context(), item.ObjectKey)
		}
		if project.SourceObjectKey != "" {
			_ = api.deps.Objects.Delete(r.Context(), project.SourceObjectKey)
		}
	}
	w.WriteHeader(http.StatusNoContent)
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
	media, err := shuihuostore.NewMedia(api.deps.DB).ListByProject(r.Context(), user.ID, project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取素材失败"})
		return
	}
	bindings := make(map[int64][]int64, len(segments))
	segmentAssets := shuihuostore.NewSegmentAssets(api.deps.DB)
	for _, segment := range segments {
		assetIDs, err := segmentAssets.ListAssetIDs(r.Context(), user.ID, segment.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取分段资产失败"})
			return
		}
		bindings[segment.ID] = assetIDs
	}
	mediaResponses := make([]map[string]any, 0, len(media))
	for _, item := range media {
		mediaResponses = append(mediaResponses, api.shuihuoMediaResponse(r, item))
	}
	writeJSON(w, http.StatusOK, map[string]any{"project": project, "segments": segments, "assets": assets, "segmentAssetIDs": bindings, "media": mediaResponses})
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
	category, err := assets.NormalizeCategory(firstNonEmpty(req.Category, "character"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产类型无效"})
		return
	}
	asset, err := shuihuostore.NewAssets(api.deps.DB).Create(r.Context(), user.ID, project.ID, domain.Asset{Category: category, Name: strings.TrimSpace(req.Name), Prompt: req.Prompt, Source: firstNonEmpty(req.Source, "manual"), ReferenceObjectKey: req.ReferenceObjectKey, ManuallyEdited: req.ManuallyEdited})
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
