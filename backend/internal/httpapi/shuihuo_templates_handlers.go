package httpapi

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
	shuihuostore "qiantie/backend/internal/shuihuo/store"

	"github.com/go-chi/chi/v5"
)

type shuihuoAssetTypeRequest struct {
	Name     string `json:"name"`
	Category string `json:"category"`
}

type shuihuoAssetTemplateRequest struct {
	AssetTypeID        int64  `json:"assetTypeId"`
	Name               string `json:"name"`
	Prompt             string `json:"prompt"`
	ReferenceObjectKey string `json:"referenceObjectKey"`
	Source             string `json:"source"`
}

func validAssetCategory(category string) bool {
	return category == "character" || category == "scene" || category == "prop"
}

func parseTemplateID(r *http.Request, name string) (int64, error) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || id < 1 {
		return 0, sql.ErrNoRows
	}
	return id, nil
}

func (api *API) handleListShuihuoAssetTypes(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	user, _ := currentUser(r)
	items, err := shuihuostore.NewAssetTypes(api.deps.DB).List(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取角色类型失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"assetTypes": items})
}

func (api *API) handleCreateShuihuoAssetType(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	var req shuihuoAssetTypeRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || !validAssetCategory(req.Category) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "角色类型参数无效"})
		return
	}
	user, _ := currentUser(r)
	item, err := shuihuostore.NewAssetTypes(api.deps.DB).Create(r.Context(), user.ID, req.Name, req.Category)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "创建角色类型失败"})
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (api *API) handleUpdateShuihuoAssetType(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	id, err := parseTemplateID(r, "assetTypeId")
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "角色类型不存在"})
		return
	}
	var req shuihuoAssetTypeRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || !validAssetCategory(req.Category) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "角色类型参数无效"})
		return
	}
	user, _ := currentUser(r)
	item, err := shuihuostore.NewAssetTypes(api.deps.DB).Update(r.Context(), user.ID, id, req.Name, req.Category)
	if isNotFound(err) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "角色类型不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新角色类型失败"})
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (api *API) handleDeleteShuihuoAssetType(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	id, err := parseTemplateID(r, "assetTypeId")
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "角色类型不存在"})
		return
	}
	user, _ := currentUser(r)
	err = shuihuostore.NewAssetTypes(api.deps.DB).Delete(r.Context(), user.ID, id)
	if isNotFound(err) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "角色类型不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "删除角色类型失败"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (api *API) handleListShuihuoAssetTemplates(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	var typeID *int64
	if value := r.URL.Query().Get("assetTypeId"); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil || parsed < 1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "角色类型参数无效"})
			return
		}
		typeID = &parsed
	}
	user, _ := currentUser(r)
	items, err := shuihuostore.NewAssetTemplates(api.deps.DB).List(r.Context(), user.ID, typeID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取角色模板失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"assetTemplates": items})
}

func templateFromRequest(req shuihuoAssetTemplateRequest) (domain.AssetTemplate, bool) {
	input := domain.AssetTemplate{
		AssetTypeID:        req.AssetTypeID,
		Name:               strings.TrimSpace(req.Name),
		Prompt:             req.Prompt,
		ReferenceObjectKey: req.ReferenceObjectKey,
		Source:             strings.TrimSpace(req.Source),
	}
	if input.Source == "" {
		input.Source = "manual"
	}
	return input, input.AssetTypeID > 0 && input.Name != ""
}

func (api *API) handleCreateShuihuoAssetTemplate(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	var req shuihuoAssetTemplateRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	input, valid := templateFromRequest(req)
	if !valid {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "角色模板参数无效"})
		return
	}
	user, _ := currentUser(r)
	item, err := shuihuostore.NewAssetTemplates(api.deps.DB).Create(r.Context(), user.ID, input)
	if isNotFound(err) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "角色类型不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建角色模板失败"})
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (api *API) handleUpdateShuihuoAssetTemplate(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	id, err := parseTemplateID(r, "assetTemplateId")
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "角色模板不存在"})
		return
	}
	var req shuihuoAssetTemplateRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	input, valid := templateFromRequest(req)
	if !valid {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "角色模板参数无效"})
		return
	}
	user, _ := currentUser(r)
	item, err := shuihuostore.NewAssetTemplates(api.deps.DB).Update(r.Context(), user.ID, id, input)
	if isNotFound(err) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "角色模板或类型不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新角色模板失败"})
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (api *API) handleDeleteShuihuoAssetTemplate(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	id, err := parseTemplateID(r, "assetTemplateId")
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "角色模板不存在"})
		return
	}
	user, _ := currentUser(r)
	err = shuihuostore.NewAssetTemplates(api.deps.DB).Delete(r.Context(), user.ID, id)
	if isNotFound(err) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "角色模板不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "删除角色模板失败"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
