package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"qiantie/backend/internal/shuihuo/batchfactory"
	"qiantie/backend/internal/shuihuo/models"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
	"qiantie/backend/internal/store"

	"github.com/go-chi/chi/v5"
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

type batchFactorySettingsBootstrapRequest struct {
	State batchfactory.PersistedSettingsState `json:"state"`
}

func batchFactorySettingInteger(value any) (int, bool) {
	switch number := value.(type) {
	case int:
		return number, true
	case int64:
		converted := int(number)
		return converted, int64(converted) == number
	case float64:
		converted := int(number)
		return converted, float64(converted) == number
	default:
		return 0, false
	}
}

func batchFactoryDirectorRegenerationRequired(previous, next batchfactory.Settings) bool {
	previousModel, previousModelOK := batchFactorySettingInteger(previous["videoModelId"])
	if !previousModelOK || previousModel < 1 {
		return false
	}
	nextModel, nextModelOK := batchFactorySettingInteger(next["videoModelId"])
	if !nextModelOK || nextModel < 1 || previousModel != nextModel {
		return true
	}
	previousMax, previousMaxOK := batchFactorySettingInteger(previous["maxVideoDuration"])
	nextMax, nextMaxOK := batchFactorySettingInteger(next["maxVideoDuration"])
	return previousMaxOK && nextMaxOK && previousMax != nextMax
}

func (api *API) canonicalizeBatchFactorySettings(r *http.Request, user store.User, input, previous batchfactory.Settings) (batchfactory.Settings, int, string) {
	normalized := batchfactory.NormalizeSettings(input, previous)
	modelID, ok := normalized["videoModelId"].(int)
	if !ok || modelID < 1 {
		return nil, http.StatusBadRequest, "请选择已配置时长能力的文生视频模型"
	}
	if api.deps.DB == nil {
		return nil, http.StatusServiceUnavailable, "生产数据库未配置"
	}

	model, err := shuihuostore.NewModels(api.deps.DB).GetEnabled(r.Context(), int64(modelID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, http.StatusConflict, "所选视频模型当前未启用或不存在"
	}
	if err != nil {
		return nil, http.StatusInternalServerError, "读取视频模型失败"
	}
	if !model.PubliclySelectable() {
		return nil, http.StatusConflict, "所选视频模型当前不可选择"
	}
	if model.Kind != models.KindVideo || model.RequiresImageInput() {
		return nil, http.StatusConflict, "所选模型当前不是可用的文生视频模型"
	}
	if !model.AvailableTo(shuihuoModelRole(user), false) {
		return nil, http.StatusForbidden, "当前账号不能使用所选视频模型"
	}
	if !model.ProviderConfigured() {
		return nil, http.StatusConflict, "所选视频模型尚未完成运行配置，请先配置对应密钥和提供方参数"
	}
	maxDuration := model.MaxVideoDuration()
	if maxDuration < 1 || maxDuration > 60 {
		return nil, http.StatusConflict, "所选视频模型未配置单次最大生成时长"
	}

	normalized["videoModelId"] = int(model.ID)
	normalized["videoModelVersionId"] = int(model.VersionID)
	normalized["videoModelName"] = model.Name
	normalized["maxVideoDuration"] = maxDuration
	return batchfactory.NormalizeSettings(normalized, nil), http.StatusOK, ""
}

func (api *API) handleCanonicalizeBatchFactorySettings(w http.ResponseWriter, r *http.Request) {
	var req batchFactorySettingsCanonicalizeRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if !api.requireShuihuoDatabase(w) {
		return
	}
	user, _ := currentUser(r)
	settings, status, message := api.canonicalizeBatchFactorySettings(r, user, req.Settings, req.Previous)
	if message != "" {
		writeJSON(w, status, map[string]string{"error": message})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": settings})
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

func (api *API) handleSaveBatchFactorySettings(w http.ResponseWriter, r *http.Request) {
	var req batchFactorySettingsCanonicalizeRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if !api.requireShuihuoDatabase(w) {
		return
	}
	batchID := strings.TrimSpace(chi.URLParam(r, "batchId"))
	if batchID == "" || len(batchID) > 96 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "批次ID无效"})
		return
	}
	user, _ := currentUser(r)
	settingsStore := batchfactory.NewSettingsStore(api.deps.DB)
	previous := req.Previous
	if stored, exists, err := settingsStore.LoadBatch(r.Context(), user.ID, batchID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取生产统一设置失败"})
		return
	} else if exists {
		previous = stored
	}
	settings, status, message := api.canonicalizeBatchFactorySettings(r, user, req.Settings, previous)
	if message != "" {
		writeJSON(w, status, map[string]string{"error": message})
		return
	}
	directorRegenerationRequired := batchFactoryDirectorRegenerationRequired(previous, settings)
	if err := settingsStore.SaveBatchAndClearVideoOverrides(r.Context(), user.ID, batchID, settings, directorRegenerationRequired); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存生产统一设置失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"settings": settings,
		"directorRegenerationRequired": directorRegenerationRequired,
	})
}

func (api *API) handleSaveBatchFactoryItemOverride(w http.ResponseWriter, r *http.Request) {
	api.handleSaveBatchFactoryOverride(w, r, false)
}

func (api *API) handleSaveBatchFactoryVideoOverride(w http.ResponseWriter, r *http.Request) {
	api.handleSaveBatchFactoryOverride(w, r, true)
}

func (api *API) handleSaveBatchFactoryOverride(w http.ResponseWriter, r *http.Request, videoScope bool) {
	var req batchFactoryOverrideCanonicalizeRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if !api.requireShuihuoDatabase(w) {
		return
	}
	batchID := strings.TrimSpace(chi.URLParam(r, "batchId"))
	itemID := strings.TrimSpace(chi.URLParam(r, "itemId"))
	videoID := strings.TrimSpace(chi.URLParam(r, "videoId"))
	if batchID == "" || itemID == "" || len(batchID) > 96 || len(itemID) > 96 || len(videoID) > 96 || (videoScope && videoID == "") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "设置范围ID无效"})
		return
	}
	user, _ := currentUser(r)
	settingsStore := batchfactory.NewSettingsStore(api.deps.DB)
	owned, err := settingsStore.BatchExists(r.Context(), user.ID, batchID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取批次设置归属失败"})
		return
	}
	if !owned {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "批次设置尚未迁移或不存在"})
		return
	}
	previous := req.Previous
	var (
		stored batchfactory.Settings
		exists bool
	)
	if videoScope {
		stored, exists, err = settingsStore.LoadVideoOverride(r.Context(), user.ID, batchID, itemID, videoID)
	} else {
		stored, exists, err = settingsStore.LoadItemOverride(r.Context(), user.ID, batchID, itemID)
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取覆盖设置失败"})
		return
	}
	if exists {
		previous = stored
	}
	next := batchfactory.NormalizeSparseOverride(req.Settings, previous, req.InheritKeys)
	if videoScope {
		err = settingsStore.SaveVideoOverride(r.Context(), user.ID, batchID, itemID, videoID, next)
	} else {
		err = settingsStore.SaveItemOverride(r.Context(), user.ID, batchID, itemID, next)
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存覆盖设置失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": next})
}

func (api *API) handleGetBatchFactorySettingsState(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	batchID := strings.TrimSpace(chi.URLParam(r, "batchId"))
	if batchID == "" || len(batchID) > 96 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "批次ID无效"})
		return
	}
	user, _ := currentUser(r)
	state, err := batchfactory.NewSettingsStore(api.deps.DB).LoadBatchState(r.Context(), user.ID, batchID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取批量工厂设置失败"})
		return
	}
	persisted := state.Batch != nil
	writeJSON(w, http.StatusOK, map[string]any{"persisted": persisted, "state": state})
}

func (api *API) handleBootstrapBatchFactorySettingsState(w http.ResponseWriter, r *http.Request) {
	var req batchFactorySettingsBootstrapRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if !api.requireShuihuoDatabase(w) {
		return
	}
	batchID := strings.TrimSpace(chi.URLParam(r, "batchId"))
	if batchID == "" || len(batchID) > 96 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "批次ID无效"})
		return
	}
	user, _ := currentUser(r)
	settingsStore := batchfactory.NewSettingsStore(api.deps.DB)
	if _, exists, err := settingsStore.LoadBatch(r.Context(), user.ID, batchID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取批量工厂设置失败"})
		return
	} else if !exists {
		normalizedLegacy := batchfactory.NormalizeSettings(req.State.Batch, nil)
		if modelID, ok := batchFactorySettingInteger(normalizedLegacy["videoModelId"]); ok && modelID > 0 {
			canonical, status, message := api.canonicalizeBatchFactorySettings(r, user, normalizedLegacy, nil)
			if message != "" {
				writeJSON(w, status, map[string]string{"error": message})
				return
			}
			req.State.Batch = canonical
		} else {
			// Very old batches may predate video-model selection. Import their
			// settings so the user can still open the batch and choose a valid
			// model later; never invent model metadata during bootstrap.
			req.State.Batch = normalizedLegacy
		}
	}
	state, err := settingsStore.BootstrapBatchState(r.Context(), user.ID, batchID, req.State)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "迁移批量工厂设置失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"persisted": state.Batch != nil, "state": state})
}
