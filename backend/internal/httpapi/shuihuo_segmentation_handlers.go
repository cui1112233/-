package httpapi

import (
	"context"
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

const accountAPIConfigCredentialRef = "account_api_config"

type segmentationRequest struct {
	Text                string                          `json:"text"`
	LinesPerSegment     int                             `json:"linesPerSegment"`
	Candidates          []segmentation.CandidateSegment `json:"candidates"`
	ModelID             int64                           `json:"modelId"`
	SystemPrompt        string                          `json:"systemPrompt"`
	SystemPromptID      string                          `json:"systemPromptId"`
	SystemPromptVersion int64                           `json:"systemPromptVersion"`
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

func (api *API) handleParagraphSegmentation(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	var req segmentationRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	text := req.Text
	if text == "" {
		text = project.SourceText
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": segmentation.StatusCandidate, "candidates": segmentation.ParagraphSegments(text)})
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
	if req.SystemPromptID != "shuihuo-smart-segmentation" || req.SystemPromptVersion < 1 || strings.TrimSpace(req.SystemPrompt) == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "管理后台未发布“智能识别”预设词"})
		return
	}
	model, ok := api.shuihuoTextModel(w, r, req.ModelID)
	if !ok {
		return
	}
	snapshot, candidates, snapshotID, err := api.completeAnalysis(r, project, model, "segmentation", req.Text, req.SystemPrompt, req.SystemPromptVersion)
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
	if api.deps.DB == nil {
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
	if model.CredentialRef == accountAPIConfigCredentialRef {
		return model, true
	}
	if api.deps.TextCompletion == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "文本分析服务未配置"})
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

// Account-scoped API settings stay server-side. This deliberately creates a
// per-request provider so another account can never reuse its credential.
func (api *API) textCompletionForUser(ctx context.Context, userID int64, model models.Definition) (models.Definition, TextCompletionProvider, error) {
	if model.CredentialRef != accountAPIConfigCredentialRef {
		if api.deps.TextCompletion == nil {
			return models.Definition{}, nil, errors.New("text completion provider is not configured")
		}
		return model, api.deps.TextCompletion, nil
	}
	if api.deps.Configs == nil {
		return models.Definition{}, nil, errors.New("account AI configuration store is not configured")
	}
	config, err := api.deps.Configs.Get(ctx, userID)
	if err != nil {
		return models.Definition{}, nil, fmt.Errorf("read account AI configuration: %w", err)
	}
	if strings.TrimSpace(config.BaseURL) == "" || strings.TrimSpace(config.Model) == "" || strings.TrimSpace(config.APIKeyCiphertext) == "" {
		return models.Definition{}, nil, errors.New("account AI configuration is incomplete")
	}
	configured := model
	configured.Endpoint = strings.TrimSpace(config.BaseURL)
	configured.Name = strings.TrimSpace(config.Model)
	resolver := func(reference string) (string, error) {
		if reference != accountAPIConfigCredentialRef {
			return "", errors.New("unexpected account credential reference")
		}
		return config.APIKeyCiphertext, nil
	}
	return configured, providers.NewTextCompletion(nil, resolver), nil
}

func renderSmartSegmentationPrompt(template, novelText string) string {
	rendered := strings.NewReplacer("{{novel_text}}", novelText).Replace(template)
	return rendered + "\n\n返回 JSON 数组，每项必须包含 text 和 speaker：[{\"text\":\"分镜原文\",\"speaker\":\"角色名或旁白\"}]。speaker 不得为空。台词必须填写实际说话角色；同一角色连续台词沿用最近一次有明确依据的角色；叙述、环境和无法确认说话者的内容填写“旁白”。叙述与台词或不同角色台词混在一起时，必须按说话人拆成多个分段。"
}

func (api *API) completeAnalysis(r *http.Request, project domain.Project, model models.Definition, purpose, novelText, systemPrompt string, systemPromptVersion int64) (prompts.PromptSnapshot, []segmentation.CandidateSegment, int64, error) {
	if strings.TrimSpace(novelText) == "" {
		novelText = project.SourceText
	}
	snapshot := prompts.PromptSnapshot{BaseVersionID: systemPromptVersion, Rendered: renderSmartSegmentationPrompt(systemPrompt, novelText)}
	user, _ := currentUser(r)
	configuredModel, completion, err := api.textCompletionForUser(r.Context(), user.ID, model)
	if err != nil {
		return prompts.PromptSnapshot{}, nil, 0, fmt.Errorf("account text configuration: %w", err)
	}
	raw, err := completion.Complete(r.Context(), configuredModel, snapshot.Rendered)
	if err != nil {
		return prompts.PromptSnapshot{}, nil, 0, fmt.Errorf("text completion: %w", err)
	}
	candidates, err := providers.ParseSegmentCandidates(raw)
	if err != nil {
		return prompts.PromptSnapshot{}, nil, 0, err
	}
	snapshotID, err := prompts.NewSnapshotStore(api.deps.DB).Save(r.Context(), user.ID, project.ID, model.ID, model.VersionID, purpose, snapshot)
	if err != nil {
		return prompts.PromptSnapshot{}, nil, 0, fmt.Errorf("save analysis snapshot: %w", err)
	}
	return snapshot, candidates, snapshotID, nil
}

func (api *API) writeAnalysisError(w http.ResponseWriter, err error) {
	api.writeTextCompletionError(w, err)
}

func (api *API) writeTextCompletionError(w http.ResponseWriter, err error) {
	if strings.Contains(err.Error(), "account text configuration") {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "当前账号尚未完成 AI 配置，请在设置中保存 API 地址、模型名和密钥后重试"})
		return
	}
	if strings.Contains(err.Error(), "segment candidates") {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "文本模型返回的候选格式无效"})
		return
	}
	if strings.Contains(err.Error(), "text completion") {
		message := "文本模型连接失败，请检查当前账号的 API 地址、模型名和密钥"
		if strings.Contains(err.Error(), "HTTP 401") || strings.Contains(err.Error(), "HTTP 403") {
			message = "文本模型鉴权失败，请检查当前账号的密钥和模型权限"
		} else if strings.Contains(err.Error(), "HTTP 400") {
			message = "文本模型请求被拒绝，请检查模型名称和接口兼容性"
		} else if strings.Contains(err.Error(), "HTTP 404") {
			message = "文本模型地址或模型名称无效，请检查当前账号配置"
		} else if strings.Contains(err.Error(), "HTTP 429") {
			message = "文本模型请求过于频繁或额度不足，请稍后重试"
		} else if strings.Contains(err.Error(), "HTTP 5") {
			message = "文本模型服务暂时不可用，请稍后重试"
		}
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": message})
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
	for index, candidate := range req.Candidates {
		if strings.TrimSpace(candidate.Text) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("第 %d 个分段原文不能为空", index+1)})
			return
		}
		segments = append(segments, domain.Segment{SourceText: candidate.Text, Speaker: candidate.Speaker})
	}
	user, _ := currentUser(r)
	if err := shuihuostore.NewSegments(api.deps.DB).ReplaceConfirmed(r.Context(), user.ID, projectID, segments); err != nil {
		if errors.Is(err, shuihuostore.ErrStoryboardMutationHasActiveTasks) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "存在进行中的生成任务，请先取消或等待完成"})
			return
		}
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "项目不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "确认分段失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": segmentation.StatusConfirmed})
}
