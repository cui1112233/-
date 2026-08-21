package httpapi

import (
	"database/sql"
	"errors"
	"net/http"

	"qiantie/backend/internal/shuihuo/domain"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
)

type shuihuoSegmentVoiceSettingsRequest struct {
	VoiceAssetID *int64  `json:"voiceAssetId"`
	SpeechRate   float64 `json:"speechRate"`
	Pitch        float64 `json:"pitch"`
}

func (api *API) handleListShuihuoSegmentVoiceSettings(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	user, _ := currentUser(r)
	items, err := shuihuostore.NewSegmentVoiceSettings(api.deps.DB).ListByProject(r.Context(), user.ID, project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取配音设置失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": items})
}

func (api *API) handleSaveShuihuoSegmentVoiceSettings(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	segmentID, err := parseShuihuoID(r, "segmentId")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的分镜 ID"})
		return
	}
	var req shuihuoSegmentVoiceSettingsRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if req.SpeechRate < 0.5 || req.SpeechRate > 2 || req.Pitch < -50 || req.Pitch > 50 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "配音语速或音调超出范围"})
		return
	}
	user, _ := currentUser(r)
	settings, err := shuihuostore.NewSegmentVoiceSettings(api.deps.DB).Save(r.Context(), user.ID, segmentID, domain.SegmentVoiceSettings{VoiceAssetID: req.VoiceAssetID, SpeechRate: req.SpeechRate, Pitch: req.Pitch})
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "分镜不存在"})
		return
	}
	if errors.Is(err, shuihuostore.ErrSegmentVoiceSettingsUnavailable) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "旁白音色必须来自当前项目的音色库"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存配音设置失败"})
		return
	}
	writeJSON(w, http.StatusOK, settings)
}
