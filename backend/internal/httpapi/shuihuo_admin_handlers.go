package httpapi

import (
	"net/http"
	"strings"

	"qiantie/backend/internal/shuihuo/models"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
)

type shuihuoAdminModelRequest struct {
	ModelID         string      `json:"modelId"`
	Name            string      `json:"name"`
	Kind            models.Kind `json:"kind"`
	AdapterKind     string      `json:"adapterKind"`
	Enabled         bool        `json:"enabled"`
	ParameterSchema string      `json:"parameterSchema"`
	CredentialRef   string      `json:"credentialRef"`
	Endpoint        string      `json:"endpoint"`
	RequestTemplate string      `json:"requestTemplate"`
	ResponseMapping string      `json:"responseMapping"`
}

func (req shuihuoAdminModelRequest) definition() models.Definition {
	return models.Definition{
		ModelID: strings.TrimSpace(req.ModelID), Name: strings.TrimSpace(req.Name), Kind: req.Kind, AdapterKind: req.AdapterKind, Enabled: req.Enabled,
		ParameterSchema: req.ParameterSchema, CredentialRef: strings.TrimSpace(req.CredentialRef),
		Endpoint: strings.TrimSpace(req.Endpoint), RequestTemplate: req.RequestTemplate, ResponseMapping: req.ResponseMapping,
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
	definition := req.definition()
	if err := models.ValidateDefinition(definition); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "模型配置无效"})
		return
	}
	user, _ := currentUser(r)
	model, err := shuihuostore.NewModels(api.deps.DB).Create(r.Context(), user.ID, definition)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "模型配置无效或名称重复"})
		return
	}
	writeJSON(w, http.StatusCreated, models.ToAdmin(model))
}
