package httpapi

import (
	"fmt"
	"net/http"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
	"qiantie/backend/internal/shuihuo/prompts"
	"qiantie/backend/internal/shuihuo/providers"
)

type assetAnalysisRequest struct {
	ModelID         int64  `json:"modelId"`
	Text            string `json:"text"`
	OverwriteManual bool   `json:"overwriteManual"`
}

func (api *API) handleShuihuoAssetAnalysis(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	var req assetAnalysisRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if req.ModelID < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请选择文本分析模型"})
		return
	}
	model, ok := api.shuihuoTextModel(w, r, req.ModelID)
	if !ok {
		return
	}
	snapshot, candidates, snapshotID, err := api.completeAssetAnalysis(r, project, model, req.Text)
	if err != nil {
		api.writeAssetAnalysisError(w, err)
		return
	}
	// overwriteManual is deliberately accepted only for a future explicit apply
	// endpoint. This request always returns candidates and never mutates assets.
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "candidate", "candidates": candidates, "analysisId": snapshotID,
		"prompt": snapshot.Public(), "overwriteManual": req.OverwriteManual,
	})
}

func (api *API) completeAssetAnalysis(r *http.Request, project domain.Project, modelText models.Definition, novelText string) (prompts.PromptSnapshot, []providers.AssetCandidate, int64, error) {
	text := strings.TrimSpace(novelText)
	if text == "" {
		text = project.SourceText
	}
	service := prompts.NewService(prompts.NewDatabaseRepository(api.deps.DB, "assets"), "shuihuo-production")
	snapshot, err := service.Assemble(r.Context(), prompts.Selection{}, prompts.AssembleInput{NovelText: text})
	if err != nil {
		return prompts.PromptSnapshot{}, nil, 0, err
	}
	raw, err := api.deps.TextCompletion.Complete(r.Context(), modelText, snapshot.Rendered)
	if err != nil {
		return prompts.PromptSnapshot{}, nil, 0, fmt.Errorf("text completion: %w", err)
	}
	candidates, err := providers.ParseAssetCandidates(raw)
	if err != nil {
		return prompts.PromptSnapshot{}, nil, 0, err
	}
	user, _ := currentUser(r)
	snapshotID, err := prompts.NewSnapshotStore(api.deps.DB).Save(r.Context(), user.ID, project.ID, modelText.ID, modelText.VersionID, "assets", snapshot)
	if err != nil {
		return prompts.PromptSnapshot{}, nil, 0, fmt.Errorf("save analysis snapshot: %w", err)
	}
	return snapshot, candidates, snapshotID, nil
}

func (api *API) writeAssetAnalysisError(w http.ResponseWriter, err error) {
	if strings.Contains(err.Error(), "asset candidates") {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "文本模型返回的资产候选格式无效"})
		return
	}
	if strings.Contains(err.Error(), "text completion") {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "文本模型调用失败，请检查管理员服务端配置"})
		return
	}
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存分析快照失败"})
}
