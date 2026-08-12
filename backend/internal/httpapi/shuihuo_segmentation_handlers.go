package httpapi

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
	"qiantie/backend/internal/shuihuo/prompts"
	"qiantie/backend/internal/shuihuo/providers"
	"qiantie/backend/internal/shuihuo/segmentation"
	shuihuostore "qiantie/backend/internal/shuihuo/store"

	"github.com/go-chi/chi/v5"
)

type segmentationRequest struct {
	Text            string                          `json:"text"`
	LinesPerSegment int                             `json:"linesPerSegment"`
	Candidates      []segmentation.CandidateSegment `json:"candidates"`
	ModelID         int64                           `json:"modelId"`
}

func (api *API) handleFixedSegmentation(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	var req segmentationRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if req.LinesPerSegment < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "每段行数必须大于 0"})
		return
	}
	text := req.Text
	if text == "" {
		text = project.SourceText
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": segmentation.StatusCandidate, "candidates": segmentation.FixedLineSegments(text, req.LinesPerSegment)})
}

func (api *API) handleImportSegmentation(w http.ResponseWriter, r *http.Request) {
	if _, ok := api.shuihuoProjectForRequest(w, r); !ok {
		return
	}
	var req segmentationRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": segmentation.StatusCandidate, "candidates": segmentation.ParseImported(req.Text)})
}

func (api *API) shuihuoProjectForRequest(w http.ResponseWriter, r *http.Request) (domain.Project, bool) {
	projectID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || projectID < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的项目 ID"})
		return domain.Project{}, false
	}
	user, _ := currentUser(r)
	project, err := shuihuostore.NewProjects(api.deps.DB).GetProject(r.Context(), user.ID, projectID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "项目不存在"})
		return domain.Project{}, false
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取项目失败"})
		return domain.Project{}, false
	}
	return project, true
}

func (api *API) handleSmartSegmentation(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	var req segmentationRequest
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
	snapshot, candidates, snapshotID, err := api.completeAnalysis(r, project, model, "segmentation", req.Text)
	if err != nil {
		api.writeAnalysisError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "candidate", "candidates": candidates, "analysisId": snapshotID,
		"prompt": snapshot.Public(),
	})
}

func (api *API) shuihuoTextModel(w http.ResponseWriter, r *http.Request, modelID int64) (models.Definition, bool) {
	if api.deps.DB == nil || api.deps.TextCompletion == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "文本分析服务未配置"})
		return models.Definition{}, false
	}
	model, err := shuihuostore.NewModels(api.deps.DB).GetEnabled(r.Context(), modelID)
	if errors.Is(err, sql.ErrNoRows) || model.Kind != models.KindText || model.AdapterKind != models.AdapterTextCompletion {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "所选文本模型未启用或不受支持"})
		return models.Definition{}, false
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取文本模型失败"})
		return models.Definition{}, false
	}
	if !model.ProviderConfigured() {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "所选文本模型尚未完成服务端配置"})
		return models.Definition{}, false
	}
	if strings.TrimSpace(model.Endpoint) == "" && api.deps.TextModelEndpoint != nil {
		model.Endpoint = api.deps.TextModelEndpoint(model.CredentialRef)
	}
	if strings.TrimSpace(model.Endpoint) == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "所选文本模型尚未完成服务端地址配置"})
		return models.Definition{}, false
	}
	return model, true
}

func (api *API) completeAnalysis(r *http.Request, project domain.Project, model models.Definition, purpose, novelText string) (prompts.PromptSnapshot, []segmentation.CandidateSegment, int64, error) {
	if strings.TrimSpace(novelText) == "" {
		novelText = project.SourceText
	}
	service := prompts.NewService(prompts.NewDatabaseRepository(api.deps.DB, purpose), "shuihuo-production")
	snapshot, err := service.Assemble(r.Context(), prompts.Selection{}, prompts.AssembleInput{NovelText: novelText})
	if err != nil {
		return prompts.PromptSnapshot{}, nil, 0, err
	}
	raw, err := api.deps.TextCompletion.Complete(r.Context(), model, snapshot.Rendered)
	if err != nil {
		return prompts.PromptSnapshot{}, nil, 0, fmt.Errorf("text completion: %w", err)
	}
	candidates, err := providers.ParseSegmentCandidates(raw)
	if err != nil {
		return prompts.PromptSnapshot{}, nil, 0, err
	}
	user, _ := currentUser(r)
	snapshotID, err := prompts.NewSnapshotStore(api.deps.DB).Save(r.Context(), user.ID, project.ID, model.ID, model.VersionID, purpose, snapshot)
	if err != nil {
		return prompts.PromptSnapshot{}, nil, 0, fmt.Errorf("save analysis snapshot: %w", err)
	}
	return snapshot, candidates, snapshotID, nil
}

func (api *API) writeAnalysisError(w http.ResponseWriter, err error) {
	if strings.Contains(err.Error(), "segment candidates") {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "文本模型返回的候选格式无效"})
		return
	}
	if strings.Contains(err.Error(), "text completion") {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "文本模型调用失败，请检查管理员服务端配置"})
		return
	}
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存分析快照失败"})
}

func (api *API) handleConfirmSegmentation(w http.ResponseWriter, r *http.Request) {
	projectID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || projectID < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的项目 ID"})
		return
	}
	var req segmentationRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if len(req.Candidates) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请至少确认一个分段"})
		return
	}
	segments := make([]domain.Segment, 0, len(req.Candidates))
	for _, candidate := range req.Candidates {
		segments = append(segments, domain.Segment{SourceText: candidate.Text})
	}
	user, _ := currentUser(r)
	if err := shuihuostore.NewSegments(api.deps.DB).ReplaceConfirmed(r.Context(), user.ID, projectID, segments); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "项目不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "确认分段失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": segmentation.StatusConfirmed})
}
