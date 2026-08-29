package httpapi

import (
	"net/http"
	"strings"

	"qiantie/backend/internal/shuihuo/batchfactory"
)

const maxBatchFactoryPresetHistoryRows = 1000

type batchFactoryConfigSnapshotsRequest struct {
	Presets []batchfactory.PresetVersion `json:"presets"`
}

type batchFactoryPresetResolveRequest struct {
	Presets []batchfactory.PresetVersion `json:"presets"`
	ID      string                       `json:"id"`
	Version int                          `json:"version"`
}

func (api *API) handleResolveBatchFactoryConfigSnapshots(w http.ResponseWriter, r *http.Request) {
	var req batchFactoryConfigSnapshotsRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if len(req.Presets) > maxBatchFactoryPresetHistoryRows {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "批量工厂配置历史过大"})
		return
	}
	catalog := batchfactory.ResolveConfigSnapshots(req.Presets)
	writeJSON(w, http.StatusOK, catalog)
}

func (api *API) handleResolveBatchFactoryPreset(w http.ResponseWriter, r *http.Request) {
	var req batchFactoryPresetResolveRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if len(req.Presets) > maxBatchFactoryPresetHistoryRows {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "批量工厂配置历史过大"})
		return
	}
	id := strings.TrimSpace(req.ID)
	if id == "" || len(id) > 64 || req.Version < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "配置 preset 请求无效"})
		return
	}
	preset, ok := batchfactory.ResolveVersionedPreset(req.Presets, id, req.Version)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "批量工厂 preset 不存在"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"preset": preset})
}
