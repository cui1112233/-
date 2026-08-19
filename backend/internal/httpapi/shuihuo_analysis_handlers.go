package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
	"qiantie/backend/internal/shuihuo/prompts"
	"qiantie/backend/internal/shuihuo/providers"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
)

type assetAnalysisRequest struct {
	ModelID             int64  `json:"modelId"`
	Scope               string `json:"scope"`
	Text                string `json:"text"`
	OverwriteManual     bool   `json:"overwriteManual"`
	SystemPrompt        string `json:"systemPrompt"`
	SystemPromptID      string `json:"systemPromptId"`
	SystemPromptVersion int64  `json:"systemPromptVersion"`
}

type assetCandidateApplyRequest struct {
	Candidates []providers.AssetCandidate `json:"candidates"`
}

func (api *API) handleGetShuihuoAssetGenerationConfig(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	user, _ := currentUser(r)
	config, err := shuihuostore.NewAssets(api.deps.DB).GetGenerationConfig(r.Context(), user.ID, project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取预设生成配置失败"})
		return
	}
	if config.AspectRatio == "" {
		config.ProjectID = project.ID
		config.AspectRatio = "16:9"
	}
	writeJSON(w, http.StatusOK, config)
}

func (api *API) handleSaveShuihuoAssetGenerationConfig(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	var config domain.AssetGenerationConfig
	if err := readJSON(r, &config); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if strings.TrimSpace(config.AspectRatio) == "" {
		config.AspectRatio = "16:9"
	}
	user, _ := currentUser(r)
	if err := shuihuostore.NewAssets(api.deps.DB).SaveGenerationConfig(r.Context(), user.ID, project.ID, config); err != nil {
		if errors.Is(err, shuihuostore.ErrInvalidAssetGenerationAspectRatio) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "图片比例只支持 16:9、9:16 或 1:1"})
			return
		}
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "项目不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存预设生成配置失败"})
		return
	}
	saved, err := shuihuostore.NewAssets(api.deps.DB).GetGenerationConfig(r.Context(), user.ID, project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取预设生成配置失败"})
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (api *API) handleApplyShuihuoAssetCandidates(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	var req assetCandidateApplyRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if len(req.Candidates) == 0 || len(req.Candidates) > 50 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请提交 1 到 50 项资产候选"})
		return
	}
	raw, _ := json.Marshal(req.Candidates)
	candidates, err := providers.ParseAssetCandidates(string(raw))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产候选格式无效"})
		return
	}
	user, _ := currentUser(r)
	assets := shuihuostore.NewAssets(api.deps.DB)
	created := make([]domain.Asset, 0, len(candidates))
	for _, candidate := range candidates {
		asset, createErr := assets.Create(r.Context(), user.ID, project.ID, domain.Asset{Category: candidate.Category, Name: candidate.Name, Prompt: candidate.Prompt, Source: "ai_candidate", ManuallyEdited: false})
		if createErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "采纳资产候选失败"})
			return
		}
		created = append(created, asset)
	}
	writeJSON(w, http.StatusCreated, map[string]any{"created": created})
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
	if req.Scope == "" {
		req.Scope = "all"
	}
	if req.Scope != "all" && req.Scope != "character" && req.Scope != "scene" && req.Scope != "prop" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "分析范围必须是全部预设、角色、场景或道具"})
		return
	}
	model, ok := api.shuihuoTextModel(w, r, req.ModelID)
	if !ok {
		return
	}
	snapshot, candidates, snapshotID, err := api.completeAssetAnalysis(r, project, model, req.Text, req.SystemPrompt)
	if err != nil {
		api.writeAssetAnalysisError(w, err)
		return
	}
	if req.Scope != "all" {
		filtered := make([]providers.AssetCandidate, 0, len(candidates))
		for _, candidate := range candidates {
			if candidate.Category == req.Scope {
				filtered = append(filtered, candidate)
			}
		}
		candidates = filtered
	}
	user, _ := currentUser(r)
	assets := make([]domain.Asset, 0, len(candidates))
	for _, candidate := range candidates {
		assets = append(assets, domain.Asset{Category: candidate.Category, Name: candidate.Name, Prompt: candidate.Prompt})
	}
	created, err := shuihuostore.NewAssets(api.deps.DB).ReplaceCurrentAICandidates(r.Context(), user.ID, project.ID, assets)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存智能预设失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "saved", "assets": created, "analysisId": snapshotID,
		"prompt": snapshot.Public(), "scope": req.Scope, "overwriteManual": req.OverwriteManual,
	})
}

func (api *API) handleShuihuoAssetPlan(w http.ResponseWriter, r *http.Request) {
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
	user, _ := currentUser(r)
	segments, err := shuihuostore.NewSegments(api.deps.DB).ListByProject(r.Context(), user.ID, project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取分镜失败"})
		return
	}
	if len(segments) == 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "请先确认分镜后再智能预设"})
		return
	}
	plan, err := api.completeAssetPlan(r, project, segments, model, req.Text, req.SystemPrompt)
	if err != nil {
		api.writeAssetAnalysisError(w, err)
		return
	}
	if err := validateAssetPlanSegments(plan, segments); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "文本模型返回的分镜资产绑定无效"})
		return
	}
	if err := normalizeAssetPlanSceneContinuity(&plan, segments); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "文本模型返回的场景连续性无效"})
		return
	}
	assets := make([]domain.Asset, 0, len(plan.Assets))
	for _, candidate := range plan.Assets {
		assets = append(assets, domain.Asset{Category: candidate.Category, Name: candidate.Name, Prompt: candidate.Prompt})
	}
	store := shuihuostore.NewAssets(api.deps.DB)
	created, err := store.ReplaceCurrentAICandidates(r.Context(), user.ID, project.ID, assets)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存智能预设失败"})
		return
	}
	assetIDs := make(map[string]int64, len(created))
	for index, asset := range created {
		assetIDs[plan.Assets[index].Key] = asset.ID
	}
	for _, binding := range plan.Bindings {
		ids := make([]int64, 0, len(binding.AssetKeys))
		for _, key := range binding.AssetKeys {
			ids = append(ids, assetIDs[key])
		}
		if err := store.ReplaceSegmentAssets(r.Context(), user.ID, binding.SegmentID, ids); err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "保存分镜资产绑定失败"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "saved", "assets": created, "boundSegments": len(plan.Bindings)})
}

func (api *API) completeAssetPlan(r *http.Request, project domain.Project, segments []domain.Segment, modelText models.Definition, novelText, systemPrompt string) (providers.AssetPlan, error) {
	text := strings.TrimSpace(novelText)
	if text == "" {
		text = project.SourceText
	}
	segmentInput, err := json.Marshal(segments)
	if err != nil {
		return providers.AssetPlan{}, err
	}
	prompt := strings.NewReplacer(
		"{{novel_text}}", text,
		"{{segment_text}}", string(segmentInput),
		"{{project_note}}", "本次任务中 assets 数组返回的资产。",
	).Replace(systemPrompt)
	prompt += "\n\n本次必须一次完成资产提取和分镜绑定。最终只返回 JSON 对象：{\"assets\":[{\"key\":\"唯一英文键\",\"category\":\"character|scene|prop\",\"name\":\"名称\",\"prompt\":\"视觉描述\"}],\"bindings\":[{\"segmentId\":分镜ID,\"sceneMode\":\"start|continue|switch\",\"assetKeys\":[\"assets 中的 key\"]}]}。必须为输入中的每个分镜返回一条 bindings；第一段 sceneMode 必须为 start；没有明确地点变化时必须为 continue，并沿用上一段的 scene 资产；只有原文明确切换地点时才使用 switch，并绑定新的 scene 资产。人物和道具按当前分镜独立判断。未出现任何资产时 assetKeys 返回 []。bindings 只能引用本次 assets 的 key，不得创建或猜测资产。"
	user, _ := currentUser(r)
	configuredModel, completion, err := api.textCompletionForUser(r.Context(), user.ID, modelText)
	if err != nil {
		return providers.AssetPlan{}, fmt.Errorf("account text configuration: %w", err)
	}
	raw, err := completion.Complete(r.Context(), configuredModel, prompt)
	if err != nil {
		return providers.AssetPlan{}, fmt.Errorf("text completion: %w", err)
	}
	plan, err := providers.ParseAssetPlan(raw)
	if err != nil {
		return providers.AssetPlan{}, err
	}
	return plan, nil
}

func validateAssetPlanSegments(plan providers.AssetPlan, segments []domain.Segment) error {
	expected := make(map[int64]struct{}, len(segments))
	for _, segment := range segments {
		expected[segment.ID] = struct{}{}
	}
	if len(plan.Bindings) != len(expected) {
		return errors.New("binding count does not match confirmed segments")
	}
	for _, binding := range plan.Bindings {
		if _, ok := expected[binding.SegmentID]; !ok {
			return errors.New("binding references an unknown segment")
		}
	}
	return nil
}

func normalizeAssetPlanSceneContinuity(plan *providers.AssetPlan, segments []domain.Segment) error {
	if plan == nil {
		return errors.New("asset plan is required")
	}
	categoryByKey := make(map[string]string, len(plan.Assets))
	for _, asset := range plan.Assets {
		categoryByKey[asset.Key] = asset.Category
	}
	bindingBySegment := make(map[int64]providers.AssetPlanBinding, len(plan.Bindings))
	for _, binding := range plan.Bindings {
		bindingBySegment[binding.SegmentID] = binding
	}
	activeSceneKeys := []string{}
	ordered := make([]providers.AssetPlanBinding, 0, len(segments))
	for index, segment := range segments {
		binding, ok := bindingBySegment[segment.ID]
		if !ok {
			return fmt.Errorf("missing binding for segment %d", segment.ID)
		}
		mode := strings.ToLower(strings.TrimSpace(binding.SceneMode))
		if mode == "" {
			if len(activeSceneKeys) > 0 {
				mode = "continue"
			} else {
				mode = "start"
			}
		}
		if index == 0 && mode == "switch" {
			mode = "start"
		}
		if index > 0 && mode == "start" {
			mode = "switch"
		}
		nonSceneKeys := make([]string, 0, len(binding.AssetKeys))
		sceneKeys := make([]string, 0, 1)
		for _, key := range binding.AssetKeys {
			if categoryByKey[key] == "scene" {
				sceneKeys = append(sceneKeys, key)
			} else {
				nonSceneKeys = append(nonSceneKeys, key)
			}
		}
		switch mode {
		case "start":
			activeSceneKeys = sceneKeys
		case "continue":
			if len(activeSceneKeys) > 0 {
				sceneKeys = append([]string(nil), activeSceneKeys...)
			} else {
				activeSceneKeys = sceneKeys
			}
		case "switch":
			if len(sceneKeys) == 0 {
				return fmt.Errorf("segment %d switches scene without a scene asset", segment.ID)
			}
			activeSceneKeys = sceneKeys
		default:
			return fmt.Errorf("segment %d has invalid scene mode %q", segment.ID, mode)
		}
		binding.SceneMode = mode
		binding.AssetKeys = append(nonSceneKeys, sceneKeys...)
		ordered = append(ordered, binding)
	}
	plan.Bindings = ordered
	return nil
}

func (api *API) completeAssetAnalysis(r *http.Request, project domain.Project, modelText models.Definition, novelText, systemPrompt string) (prompts.PromptSnapshot, []providers.AssetCandidate, int64, error) {
	text := strings.TrimSpace(novelText)
	if text == "" {
		text = project.SourceText
	}
	externalPrompt := strings.TrimSpace(systemPrompt)
	var snapshot prompts.PromptSnapshot
	if externalPrompt != "" {
		snapshot = prompts.PromptSnapshot{Rendered: renderSmartSegmentationPrompt(externalPrompt, text)}
	} else {
		service := prompts.NewService(prompts.NewDatabaseRepository(api.deps.DB, "assets"), "shuihuo-production")
		var err error
		snapshot, err = service.Assemble(r.Context(), prompts.Selection{}, prompts.AssembleInput{NovelText: text})
		if err != nil {
			return prompts.PromptSnapshot{}, nil, 0, err
		}
	}
	user, _ := currentUser(r)
	configuredModel, completion, err := api.textCompletionForUser(r.Context(), user.ID, modelText)
	if err != nil {
		return prompts.PromptSnapshot{}, nil, 0, fmt.Errorf("account text configuration: %w", err)
	}
	raw, err := completion.Complete(r.Context(), configuredModel, snapshot.Rendered)
	if err != nil {
		return prompts.PromptSnapshot{}, nil, 0, fmt.Errorf("text completion: %w", err)
	}
	candidates, err := providers.ParseAssetCandidates(raw)
	if err != nil {
		return prompts.PromptSnapshot{}, nil, 0, err
	}
	snapshotID := int64(0)
	if externalPrompt == "" {
		var err error
		snapshotID, err = prompts.NewSnapshotStore(api.deps.DB).Save(r.Context(), user.ID, project.ID, modelText.ID, modelText.VersionID, "assets", snapshot)
		if err != nil {
			return prompts.PromptSnapshot{}, nil, 0, fmt.Errorf("save analysis snapshot: %w", err)
		}
	}
	return snapshot, candidates, snapshotID, nil
}

func (api *API) writeAssetAnalysisError(w http.ResponseWriter, err error) {
	if strings.Contains(err.Error(), "asset candidates") {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "文本模型返回的资产候选格式无效"})
		return
	}
	api.writeTextCompletionError(w, err)
}
