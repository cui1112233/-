package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"

	"qiantie/backend/internal/shuihuo/batchfactory"
)

type batchFactoryDirectorNormalizeRequest struct {
	Output   json.RawMessage              `json:"output"`
	Settings batchfactory.DirectorSettings `json:"settings"`
}

func batchFactoryDirectorRequestStatus(err error) int {
	if err == nil {
		return http.StatusOK
	}
	if strings.Contains(err.Error(), "preset 不存在") {
		return http.StatusNotFound
	}
	return http.StatusBadRequest
}

func (api *API) handleBuildBatchFactoryDirectorContract(w http.ResponseWriter, r *http.Request) {
	var req batchfactory.DirectorPromptRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if len(req.Presets) > maxBatchFactoryPresetHistoryRows {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "批量工厂配置历史过大"})
		return
	}
	contract, err := batchfactory.BuildDirectorPromptContract(req)
	if err != nil {
		writeJSON(w, batchFactoryDirectorRequestStatus(err), map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, contract)
}

func (api *API) handleBuildBatchFactoryHookContract(w http.ResponseWriter, r *http.Request) {
	var req batchfactory.HookPromptRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if len(req.Presets) > maxBatchFactoryPresetHistoryRows {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "批量工厂配置历史过大"})
		return
	}
	contract, err := batchfactory.BuildHookPromptContract(req)
	if err != nil {
		writeJSON(w, batchFactoryDirectorRequestStatus(err), map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, contract)
}

func (api *API) handleNormalizeBatchFactoryDirectorOutput(w http.ResponseWriter, r *http.Request) {
	var req batchFactoryDirectorNormalizeRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	trimmed := bytes.TrimSpace(req.Output)
	if len(trimmed) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "导演模型返回为空"})
		return
	}
	raw := json.RawMessage(trimmed)
	if trimmed[0] == '"' {
		var text string
		if err := json.Unmarshal(trimmed, &text); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "导演模型没有返回合法 JSON"})
			return
		}
		parsed, err := batchfactory.ParseDirectorJSON(text)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		raw = parsed
	}
	result, err := batchfactory.NormalizeDirectorOutput(raw, req.Settings)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}
