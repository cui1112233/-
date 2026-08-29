package httpapi

import (
	"database/sql"
	"errors"
	"net/http"

	"qiantie/backend/internal/shuihuo/batchfactory"
	"qiantie/backend/internal/shuihuo/models"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
)

type batchFactorySettingsCanonicalizeRequest struct {
	Settings batchfactory.Settings `json:"settings"`
	Previous batchfactory.Settings `json:"previous"`
}

type batchFactoryOverrideCanonicalizeRequest struct {
	Settings    batchfactory.Settings `json:"settings"`
	Previous    batchfactory.Settings `json:"previous"`
	InheritKeys []string              `json:"inheritKeys"`
}

func (api *API) handleCanonicalizeBatchFactorySettings(w http.ResponseWriter, r *http.Request) {
	var req batchFactorySettingsCanonicalizeRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}

	normalized := batchfactory.NormalizeSettings(req.Settings, req.Previous)
	modelID, ok := normalized["videoModelId"].(int)
	if !ok || modelID < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请选择已配置时长能力的文生视频模型"})
		return
	}
	if !api.requireShuihuoDatabase(w) {
		return
	}

	model, err := shuihuostore.NewModels(api.deps.DB).GetEnabled(r.Context(), int64(modelID))
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "所选视频模型当前未启用或不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取视频模型失败"})
		return
	}
	if !model.PubliclySelectable() {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "所选视频模型当前不可选择"})
		return
	}
	if model.Kind != models.KindVideo || model.RequiresImageInput() {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "所选模型当前不是可用的文生视频模型"})
		return
	}
	user, _ := currentUser(r)
	if !model.AvailableTo(shuihuoModelRole(user), false) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "当前账号不能使用所选视频模型"})
		return
	}
	if !model.ProviderConfigured() {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "所选视频模型尚未完成运行配置，请先配置对应密钥和提供方参数"})
		return
	}
	maxDuration := model.MaxVideoDuration()
	if maxDuration < 1 || maxDuration > 60 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "所选视频模型未配置单次最大生成时长"})
		return
	}

	// The browser selects only the logical model row. Version/name/capability are
	// authoritative server-side snapshot fields and must never be trusted from
	// the request body.
	normalized["videoModelId"] = int(model.ID)
	normalized["videoModelVersionId"] = int(model.VersionID)
	normalized["videoModelName"] = model.Name
	normalized["maxVideoDuration"] = maxDuration
	// Re-normalize after replacing maxVideoDuration so exactDuration follows the
	// selected model when fixed-single-VIDEO is enabled.
	normalized = batchfactory.NormalizeSettings(normalized, nil)
	writeJSON(w, http.StatusOK, map[string]any{"settings": normalized})
}

func (api *API) handleCanonicalizeBatchFactoryOverride(w http.ResponseWriter, r *http.Request) {
	var req batchFactoryOverrideCanonicalizeRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	settings := batchfactory.NormalizeSparseOverride(req.Settings, req.Previous, req.InheritKeys)
	writeJSON(w, http.StatusOK, map[string]any{"settings": settings})
}
