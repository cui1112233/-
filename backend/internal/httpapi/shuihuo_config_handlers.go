package httpapi

import (
	"net/http"

	"qiantie/backend/internal/shuihuo/domain"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
)

func (api *API) handleGetShuihuoProductionConfig(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	user, _ := currentUser(r)
	config, err := shuihuostore.NewProductionConfigs(api.deps.DB).Get(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取默认配置失败"})
		return
	}
	writeJSON(w, http.StatusOK, config)
}

func (api *API) handleSaveShuihuoProductionConfig(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	var config domain.UserProductionConfig
	if err := readJSON(r, &config); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	user, _ := currentUser(r)
	config.UserID = user.ID
	if _, err := domain.NormalizeVideoGenerationMode(config.VideoGenerationMode); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "视频生成模式无效"})
		return
	}
	if _, err := domain.NormalizeImageAspectRatio(config.ImageAspectRatio); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "图片比例无效"})
		return
	}
	if _, err := domain.NormalizeImageResolution(config.ImageResolution); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "图片分辨率无效"})
		return
	}
	if _, err := domain.NormalizeVideoAspectRatio(config.VideoAspectRatio); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "视频尺寸无效"})
		return
	}
	if _, err := domain.NormalizeVideoResolution(config.VideoResolution); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "视频分辨率无效"})
		return
	}
	config, err := shuihuostore.NewProductionConfigs(api.deps.DB).Save(r.Context(), config)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存默认配置失败"})
		return
	}
	writeJSON(w, http.StatusOK, config)
}
