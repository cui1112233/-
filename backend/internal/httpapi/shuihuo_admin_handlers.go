package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"qiantie/backend/internal/shuihuo/models"
	shuihuostore "qiantie/backend/internal/shuihuo/store"

	"github.com/go-chi/chi/v5"
)

type shuihuoAdminModelRequest struct {
	ModelID           string      `json:"modelId"`
	Name              string      `json:"name"`
	Kind              models.Kind `json:"kind"`
	AdapterKind       string      `json:"adapterKind"`
	Enabled           bool        `json:"enabled"`
	Hidden            bool        `json:"hidden"`
	SortOrder         int         `json:"sortOrder"`
	AdminNote         string      `json:"adminNote"`
	AllowedRoles      []string    `json:"allowedRoles"`
	ParameterSchema   string      `json:"parameterSchema"`
	CredentialRef     string      `json:"credentialRef"`
	Endpoint          string      `json:"endpoint"`
	BaseDomain        string      `json:"baseDomain"`
	BasePath          string      `json:"basePath"`
	RequestTemplate   string      `json:"requestTemplate"`
	ResponseMapping   string      `json:"responseMapping"`
	PollingTemplate   string      `json:"pollingTemplate"`
	ImageInputFormat  string      `json:"imageInputFormat"`
	ImageRequestMode  string      `json:"imageRequestMode"`
	RuntimePolicyJSON string      `json:"runtimePolicyJson"`
}

func adminModelDefinition(req shuihuoAdminModelRequest) models.Definition {
	return models.Definition{
		ModelID: strings.TrimSpace(req.ModelID), Name: strings.TrimSpace(req.Name), Kind: req.Kind, AdapterKind: req.AdapterKind,
		Enabled: req.Enabled, Hidden: req.Hidden, SortOrder: req.SortOrder, AdminNote: strings.TrimSpace(req.AdminNote),
		AllowedRoles: append([]string(nil), req.AllowedRoles...), ParameterSchema: req.ParameterSchema,
		CredentialRef: strings.TrimSpace(req.CredentialRef), Endpoint: strings.TrimSpace(req.Endpoint),
		BaseDomain: strings.TrimSpace(req.BaseDomain), BasePath: strings.TrimSpace(req.BasePath), RequestTemplate: req.RequestTemplate,
		ResponseMapping: req.ResponseMapping, PollingTemplate: req.PollingTemplate, ImageInputFormat: strings.TrimSpace(req.ImageInputFormat),
		ImageRequestMode: strings.TrimSpace(req.ImageRequestMode), RuntimePolicyJSON: req.RuntimePolicyJSON,
	}
}

func (api *API) handleAdminModelList(w http.ResponseWriter, r *http.Request) {
	if api.deps.DB == nil {
		writeJSON(w, http.StatusOK, map[string]any{"models": []any{}})
		return
	}
	items, err := shuihuostore.NewModels(api.deps.DB).ListAll(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取模型失败"})
		return
	}
	public := make([]models.AdminModel, 0, len(items))
	for _, item := range items {
		public = append(public, models.ToAdmin(item))
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": public})
}

func (api *API) handleCreateAdminModel(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	var req shuihuoAdminModelRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	definition := adminModelDefinition(req)
	if err := models.ValidateDefinition(definition); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "模型配置无效：" + err.Error()})
		return
	}
	user, _ := currentUser(r)
	model, err := shuihuostore.NewModels(api.deps.DB).Create(r.Context(), user.ID, definition)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "模型配置无效或模型标识/名称重复"})
		return
	}
	writeJSON(w, http.StatusCreated, models.ToAdmin(model))
}

func (api *API) handleUpdateAdminModel(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	modelID, err := strconv.ParseInt(chi.URLParam(r, "modelId"), 10, 64)
	if err != nil || modelID < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "模型ID无效"})
		return
	}
	var req shuihuoAdminModelRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	definition := adminModelDefinition(req)
	definition.ID = modelID
	user, _ := currentUser(r)
	updated, err := shuihuostore.NewModels(api.deps.DB).Update(r.Context(), user.ID, modelID, definition)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "模型不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "模型配置无效：" + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, models.ToAdmin(updated))
}
